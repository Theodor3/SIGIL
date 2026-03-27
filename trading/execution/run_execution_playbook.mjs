#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { asNum, ensureDir, n, pct, readCsv, readJson, toCsv, todayDate } from '../scripts/lib.mjs';
import { createReferenceDataClient } from '../providers/reference_data.mjs';

const root = process.cwd();

const DEFAULT_POLICY = {
  deployment: {
    cash_deploy_pct: 0.9,
    min_position_pct: 0.04,
    max_position_pct: 0.10,
    base_position_pct: 0.05,
    confidence_anchor: 0.55,
    confidence_boost_cap: 0.25,
    confidence_boost_multiplier: 0.18,
    alpha_boost_multiplier: 0.05,
  },
  entry: {
    zone_lower_buffer_pct: 0.02,
    zone_upper_buffer_pct: 0.02,
    stagger_weights: [0.4, 0.3, 0.3],
    pullback_steps_pct: [0, -3, -6],
  },
  invalidation: {
    leverage_cutoff: 3.0,
    thesis_break_rule: '2 weak KPI prints or -12% from blended entry',
  },
  trim_schedule: [
    { gain_pct: 20, trim_pct: 10 },
    { gain_pct: 40, trim_pct: 10 },
    { gain_pct: 75, trim_pct: 15 },
    { gain_pct: 120, trim_pct: 20 },
  ],
  expected_alpha: {
    scale_20d: 0.03,
    scale_90d: 0.07,
    min_pct: -8,
    max_pct: 15,
  },
  options_overlay: {
    enabled: true,
    min_confidence_long_call: 0.62,
    min_account_usd_for_long_call: 8000,
    min_price: 20,
    max_price: 500,
    max_debit_usd: 150,
    covered_call_min_shares: 100,
    liquidity: {
      min_avg_daily_volume: 1_000_000,
      min_market_cap_usd: 2_000_000_000,
    },
  },
};

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const [k, v] of Object.entries(source || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      out[k] = deepMerge(target[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function expectedAlpha(alphaScore, horizonDays, policy) {
  const cfg = policy.expected_alpha;
  const scale = horizonDays <= 20 ? cfg.scale_20d : cfg.scale_90d;
  const rawPct = (asNum(alphaScore) ?? 0) * 100 * scale;
  const clippedPct = clamp(rawPct, cfg.min_pct, cfg.max_pct);
  return clippedPct / 100;
}

function maxPositionPct(confidence, alphaScore, policy) {
  const d = policy.deployment;
  const base = d.base_position_pct;
  const confBoost = clamp((confidence ?? 0) - d.confidence_anchor, 0, d.confidence_boost_cap) * d.confidence_boost_multiplier;
  const alphaBoost = clamp((alphaScore ?? 0), 0, 1) * d.alpha_boost_multiplier;
  return clamp(base + confBoost + alphaBoost, d.min_position_pct, d.max_position_pct);
}

function trimScheduleText(policy) {
  return policy.trim_schedule
    .map((x) => `Trim ${x.trim_pct}% at +${x.gain_pct}%`)
    .join(', ');
}

function entryZone(price, policy) {
  const lower = policy.entry.zone_lower_buffer_pct;
  const upper = policy.entry.zone_upper_buffer_pct;
  const weights = (policy.entry.stagger_weights || [0.4, 0.3, 0.3]).map((w) => Math.round(w * 100)).join('/');

  if (price == null) {
    const steps = policy.entry.pullback_steps_pct || [0, -3, -6];
    return `Stagger entries (${weights}) at ${steps.map((s) => `${s}%`).join(', ')} pullback ladder`;
  }

  return `$${n(price * (1 - lower), 2)} - $${n(price * (1 + upper), 2)} (stagger ${weights})`;
}

function optionsOverlay(row, profile, currentShares, policy) {
  const o = policy.options_overlay;
  if (!o.enabled) return 'Options overlay disabled by policy';

  const price = asNum(row.price);
  const account = asNum(profile?.investor_profile?.account_size_usd) ?? 0;
  const confidence = asNum(row.confidence) ?? 0;
  const avgVol = asNum(row.avg_daily_volume);
  const marketCap = asNum(row.market_cap);

  const liquidityOk =
    (avgVol != null && avgVol >= Number(o.liquidity.min_avg_daily_volume)) &&
    (marketCap != null && marketCap >= Number(o.liquidity.min_market_cap_usd));

  if (!liquidityOk) {
    return 'No options overlay (liquidity gate failed)';
  }

  if (currentShares >= Number(o.covered_call_min_shares) && price != null && price >= 15) {
    return 'Covered call: 30-45 DTE, 0.20-0.30 delta, 1 contract per 100 shares';
  }

  if (
    account >= Number(o.min_account_usd_for_long_call) &&
    price != null &&
    price >= Number(o.min_price) &&
    price <= Number(o.max_price) &&
    confidence >= Number(o.min_confidence_long_call)
  ) {
    return `Optional long call: debit <= $${n(Number(o.max_debit_usd), 0)}, 45-90 DTE, 0.35-0.45 delta`;
  }

  return 'No options overlay (profile/price/confidence constraints)';
}

async function fetchQuoteMap(symbols) {
  const client = await createReferenceDataClient(root);
  const quoteMap = await client.getQuoteMap(symbols);
  const out = new Map();
  for (const [symbol, quote] of quoteMap.entries()) {
    out.set(symbol, {
      price: asNum(quote?.price),
      avg_daily_volume: asNum(quote?.avgDailyVolume),
      market_cap: asNum(quote?.marketCap),
      quote_provider: quote?.provider || '',
    });
  }
  return out;
}

export async function run() {
  const tradingDir = path.join(root, 'trading');
  const profile = await readJson(path.join(tradingDir, 'config', 'profile.json'));
  const positions = await readCsv(path.join(tradingDir, 'data', 'positions.csv'));
  const ranks = await readCsv(path.join(tradingDir, 'data', 'ranks', 'latest_ranks.csv'));

  let policy = { ...DEFAULT_POLICY };
  try {
    const cfg = await readJson(path.join(tradingDir, 'config', 'playbook_policy.json'));
    policy = deepMerge(DEFAULT_POLICY, cfg || {});
  } catch {
    policy = { ...DEFAULT_POLICY };
  }

  const heldByTicker = new Map(positions.map((p) => [(p.symbol || '').toUpperCase(), p]));

  const targetCount = Number(profile?.investor_profile?.target_new_ideas_per_day ?? 5);
  const accountSize = asNum(profile?.investor_profile?.account_size_usd) ?? 0;
  const cash = asNum(profile?.allocation?.cash_usd) ?? 0;
  const maxDeployable = clamp(cash * Number(policy.deployment.cash_deploy_pct), 0, Math.max(cash, 0));

  const eligible = ranks
    .filter((r) => String(r.eligible || '').toLowerCase() !== 'false')
    .filter((r) => !heldByTicker.has((r.ticker || '').toUpperCase()))
    .sort((a, b) => (asNum(b.final_alpha_score) ?? 0) - (asNum(a.final_alpha_score) ?? 0));

  const selected = eligible.slice(0, targetCount);
  const symbols = selected.map((r) => String(r.ticker || '').toUpperCase()).filter(Boolean);
  const quoteMap = await fetchQuoteMap(symbols);

  const perIdeaBudgetCap = selected.length > 0 ? maxDeployable / selected.length : 0;
  const date = todayDate(profile?.timezone || 'America/New_York');

  const rows = selected.map((r, i) => {
    const ticker = (r.ticker || '').toUpperCase();
    const q = quoteMap.get(ticker) || {};
    const price = asNum(q.price);
    const confidence = asNum(r.confidence);
    const alpha = asNum(r.final_alpha_score);
    const maxPct = maxPositionPct(confidence, alpha, policy);
    const maxUsd = Math.min(accountSize * maxPct, perIdeaBudgetCap || accountSize * maxPct);

    const debtCutoff = Number(policy.invalidation.leverage_cutoff);
    const invalidation = (asNum(r.debt_to_ebitda) ?? 0) > debtCutoff
      ? 'Invalidate if leverage worsens and closes < 50D MA'
      : `Invalidate if thesis breaks: ${policy.invalidation.thesis_break_rule}`;

    const currentShares = asNum(heldByTicker.get(ticker)?.shares) ?? 0;

    return {
      date,
      rank: i + 1,
      symbol: ticker,
      final_alpha_score: n(alpha, 4),
      confidence: n(confidence, 3),
      expected_alpha_20d: pct(expectedAlpha(alpha, 20, policy), 2),
      expected_alpha_90d: pct(expectedAlpha(alpha, 90, policy), 2),
      strongest_drivers: r.strongest_drivers || '',
      gate_reason: r.gate_reason || '',
      entry_zone: entryZone(price, policy),
      invalidation,
      trim_schedule: trimScheduleText(policy),
      max_position_size_pct: pct(maxPct, 2),
      max_position_size_usd: n(maxUsd, 2),
      avg_daily_volume: n(asNum(q.avg_daily_volume), 0),
      market_cap_usd: n(asNum(q.market_cap), 0),
      options_overlay: optionsOverlay({ ...r, ...q }, profile, currentShares, policy),
    };
  });

  const ideasDir = path.join(tradingDir, 'ideas');
  await ensureDir(ideasDir);

  const csvOut = path.join(ideasDir, `${date}-final-top${targetCount}.csv`);
  const mdOut = path.join(ideasDir, `${date}-final-top${targetCount}.md`);

  const headers = [
    'date', 'rank', 'symbol', 'final_alpha_score', 'confidence', 'expected_alpha_20d', 'expected_alpha_90d',
    'strongest_drivers', 'gate_reason', 'entry_zone', 'invalidation', 'trim_schedule', 'max_position_size_pct',
    'max_position_size_usd', 'avg_daily_volume', 'market_cap_usd', 'options_overlay', 'quote_provider',
  ];

  await fs.writeFile(csvOut, toCsv(rows, headers), 'utf8');

  const md = [
    `# Final Top ${targetCount} Execution Playbook - ${date}`,
    '',
    `- Account size: $${n(accountSize, 2)}`,
    `- Cash: $${n(cash, 2)}`,
    `- Deployable cash cap: $${n(maxDeployable, 2)} (${pct(Number(policy.deployment.cash_deploy_pct), 2)})`,
    '',
    '| Rank | Ticker | Alpha | Conf | Exp Alpha 20D | Entry Zone | Max Size | Liquidity | Options Overlay |',
    '|---:|---|---:|---:|---:|---|---:|---|---|',
    ...rows.map((r) => `| ${r.rank} | ${r.symbol} | ${r.final_alpha_score} | ${r.confidence} | ${r.expected_alpha_20d} | ${r.entry_zone} | $${r.max_position_size_usd} (${r.max_position_size_pct}) | Vol ${r.avg_daily_volume || 'n/a'} / MCap ${r.market_cap_usd || 'n/a'} | ${r.options_overlay} |`),
    '',
    '## Notes',
    '',
    '- Derived only from latest_ranks.csv + holdings + profile + playbook_policy constraints.',
    '- For research and planning only, not investment advice.',
  ].join('\n');

  await fs.writeFile(mdOut, md, 'utf8');

  console.log(`Wrote: ${csvOut}`);
  console.log(`Wrote: ${mdOut}`);
  console.log(`Selected: ${rows.map((r) => r.symbol).join(', ')}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
