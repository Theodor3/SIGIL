#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { asNum, ensureDir, n, pct, readCsv, readJson, toCsv, todayDate } from './lib.mjs';

const root = process.cwd();

function roundToIncrement(value, increment) {
  return Math.floor(value / increment) * increment;
}

function nextTrimPct(gainPct, rules) {
  if (gainPct >= 1.2) return rules.gain_120_pct;
  if (gainPct >= 0.75) return rules.gain_75_pct;
  if (gainPct >= 0.4) return rules.gain_40_pct;
  if (gainPct >= 0.2) return rules.gain_20_pct;
  return 0;
}

export async function run() {
  const profile = await readJson(path.join(root, 'trading', 'config', 'profile.json'));
  const rows = await readCsv(path.join(root, 'trading', 'data', 'positions.csv'));
  const rules = profile.trim_rules;

  const plans = rows.map((r) => {
    const shares = asNum(r.shares) ?? 0;
    const price = asNum(r.price);
    const avg = asNum(r.average_cost);
    const gainPct = avg && avg > 0 && price != null ? (price / avg) - 1 : null;

    const trimPct = gainPct == null ? 0 : Math.min(nextTrimPct(gainPct, rules), rules.max_single_trim_pct);
    let sharesToTrim = roundToIncrement(shares * trimPct, rules.min_share_increment);
    if (trimPct > 0 && sharesToTrim <= 0 && shares > 0) {
      sharesToTrim = rules.min_share_increment;
    }

    const estCash = price == null ? null : sharesToTrim * price;
    const action = trimPct > 0 ? 'TRIM' : 'HOLD';

    let reason = 'No trim threshold hit';
    if (action === 'TRIM') {
      reason = `Gain ${pct(gainPct)} reached threshold; trim ${pct(trimPct)}`;
    }

    return {
      symbol: (r.symbol || '').toUpperCase(),
      shares: n(shares, 3),
      price: n(price, 2),
      average_cost: n(avg, 2),
      gain_pct: pct(gainPct, 2),
      action,
      trim_pct: pct(trimPct, 1),
      shares_to_trim: n(sharesToTrim, 3),
      est_cash_out: n(estCash, 2),
      reason,
    };
  });

  const trimOnly = plans
    .filter((p) => p.action === 'TRIM')
    .sort((a, b) => Number(b.gain_pct.replace('%', '')) - Number(a.gain_pct.replace('%', '')));

  const holdOnly = plans.filter((p) => p.action === 'HOLD');
  const totalCashOut = trimOnly.reduce((sum, x) => sum + (asNum(x.est_cash_out) ?? 0), 0);

  const reportsDir = path.join(root, 'trading', 'reports');
  await ensureDir(reportsDir);
  const date = todayDate(profile.timezone);
  const csvOut = path.join(reportsDir, `${date}-trim-plan.csv`);
  const mdOut = path.join(reportsDir, `${date}-trim-plan.md`);

  await fs.writeFile(
    csvOut,
    toCsv(plans, [
      'symbol', 'shares', 'price', 'average_cost', 'gain_pct', 'action',
      'trim_pct', 'shares_to_trim', 'est_cash_out', 'reason',
    ]),
    'utf8'
  );

  const md = [
    `# Trim Plan - ${date}`,
    '',
    `- Trim candidates: ${trimOnly.length}`,
    `- Hold only: ${holdOnly.length}`,
    `- Estimated cash from suggested trims: $${n(totalCashOut, 2)}`,
    '',
    '## Trim Candidates',
    '',
    '| Ticker | Gain | Trim % | Shares to Trim | Est Cash | Reason |',
    '|---|---:|---:|---:|---:|---|',
    ...trimOnly.map((r) => `| ${r.symbol} | ${r.gain_pct} | ${r.trim_pct} | ${r.shares_to_trim} | $${r.est_cash_out} | ${r.reason} |`),
    '',
    '## Hold List',
    '',
    holdOnly.length ? holdOnly.map((r) => `- ${r.symbol}: ${r.reason}`).join('\n') : '- none',
    '',
    '## Rule Set',
    '',
    '- >=20% gain: trim 10%',
    '- >=40% gain: trim 10%',
    '- >=75% gain: trim 15%',
    '- >=120% gain: trim 20%',
  ].join('\n');

  await fs.writeFile(mdOut, md, 'utf8');

  console.log(`Wrote: ${csvOut}`);
  console.log(`Wrote: ${mdOut}`);
  console.log(`Trim tickers: ${trimOnly.map((x) => x.symbol).join(', ')}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}

