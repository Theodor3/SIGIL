#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { asNum, n, parseCsv, pct, readJson, toCsv, todayDate } from '../scripts/lib.mjs';

const root = process.cwd();
const tradingDir = path.join(root, 'trading');

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

async function readCsvSafe(filePath, fallback = []) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return parseCsv(text);
  } catch {
    return fallback;
  }
}

function modelScore(row, weights) {
  let s = 0;
  for (const [k, w] of Object.entries(weights)) {
    s += (asNum(row[k]) ?? 0) * w;
  }
  return s;
}

function toHoldReturn(r5, holdDays) {
  if (r5 == null) return null;
  const base = 1 + r5;
  if (base <= 0) return -0.99;
  const scaled = Math.pow(base, holdDays / 5) - 1;
  return clamp(scaled, -0.80, 1.20);
}

function parseIsoDate(s) {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.valueOf()) ? null : d;
}

function stddev(values) {
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + ((b - mean) ** 2), 0) / values.length;
  return Math.sqrt(v);
}

function maxDrawdown(curve) {
  let peak = -Infinity;
  let mdd = 0;
  for (const x of curve) {
    peak = Math.max(peak, x);
    const dd = peak > 0 ? (x / peak) - 1 : 0;
    mdd = Math.min(mdd, dd);
  }
  return mdd;
}

function quantileBuckets(rows, scoreKey, alphaKey) {
  const sorted = [...rows].sort((a, b) => (asNum(a[scoreKey]) ?? 0) - (asNum(b[scoreKey]) ?? 0));
  if (!sorted.length) return [];

  const size = Math.ceil(sorted.length / 4);
  const out = [];
  for (let i = 0; i < 4; i += 1) {
    const chunk = sorted.slice(i * size, (i + 1) * size);
    if (!chunk.length) continue;
    const avgAlpha = chunk.reduce((a, b) => a + (asNum(b[alphaKey]) ?? 0), 0) / chunk.length;
    out.push({
      bucket: `Q${i + 1}`,
      sample_n: chunk.length,
      avg_alpha: avgAlpha,
      min_score: Math.min(...chunk.map((r) => asNum(r[scoreKey]) ?? 0)),
      max_score: Math.max(...chunk.map((r) => asNum(r[scoreKey]) ?? 0)),
    });
  }
  return out;
}

function yearsCovered(rows, holdDays) {
  if (!rows.length) return null;
  const dates = rows.map((r) => parseIsoDate(r.report_date)).filter(Boolean).sort((a, b) => a - b);
  if (!dates.length) return null;
  const start = dates[0];
  const end = dates[dates.length - 1];
  const days = Math.max(holdDays, Math.round((end - start) / 86400000) + holdDays);
  return days / 365.25;
}

function computePortfolioMetrics(name, rows, threshold, holdDays, benchmarkMode) {
  const selected = rows.filter((r) => r.selected != null ? r.selected : r.score >= threshold);
  const sampleN = rows.length;
  const tradesN = selected.length;

  const hitRate = tradesN > 0
    ? selected.filter((r) => (asNum(r.trade_return) ?? 0) > 0).length / tradesN
    : null;

  const avgTrade = tradesN > 0
    ? selected.reduce((a, b) => a + (asNum(b.trade_return) ?? 0), 0) / tradesN
    : null;

  const avgBench = tradesN > 0
    ? selected.reduce((a, b) => a + (asNum(b.benchmark_return) ?? 0), 0) / tradesN
    : null;

  const tradeAlphas = selected.map((r) => (asNum(r.trade_return) ?? 0) - (asNum(r.benchmark_return) ?? 0));
  const avgAlphaPerTrade = tradeAlphas.length
    ? tradeAlphas.reduce((a, b) => a + b, 0) / tradeAlphas.length
    : null;

  const selectedSorted = [...selected].sort((a, b) => String(a.report_date).localeCompare(String(b.report_date)));
  const equityCurve = [1];
  const benchCurve = [1];
  for (const r of selectedSorted) {
    equityCurve.push(equityCurve[equityCurve.length - 1] * (1 + (asNum(r.trade_return) ?? 0)));
    benchCurve.push(benchCurve[benchCurve.length - 1] * (1 + (asNum(r.benchmark_return) ?? 0)));
  }

  const cumulative = equityCurve[equityCurve.length - 1] - 1;
  const benchmarkCumulative = benchCurve[benchCurve.length - 1] - 1;
  const years = yearsCovered(selectedSorted, holdDays);
  const cagr = years && years > 0 ? Math.pow(1 + cumulative, 1 / years) - 1 : null;
  const benchmarkCagr = years && years > 0 ? Math.pow(1 + benchmarkCumulative, 1 / years) - 1 : null;

  const periodScale = Math.sqrt(252 / Math.max(1, holdDays));
  const retStd = stddev(selectedSorted.map((r) => asNum(r.trade_return) ?? 0));
  const alphaStd = stddev(tradeAlphas);

  const sharpe = retStd && retStd > 0 && avgTrade != null ? (avgTrade / retStd) * periodScale : null;
  const infoRatio = alphaStd && alphaStd > 0 && avgAlphaPerTrade != null ? (avgAlphaPerTrade / alphaStd) * periodScale : null;

  const buckets = quantileBuckets(
    selectedSorted.map((r) => ({
      score: r.score,
      alpha: (asNum(r.trade_return) ?? 0) - (asNum(r.benchmark_return) ?? 0),
    })),
    'score',
    'alpha',
  );

  return {
    name,
    hold_days: holdDays,
    benchmark_mode: benchmarkMode,
    sample_n: sampleN,
    trades_n: tradesN,
    participation_rate: sampleN > 0 ? tradesN / sampleN : null,
    hit_rate: hitRate,
    avg_trade_return: avgTrade,
    avg_benchmark_return: avgBench,
    alpha_vs_benchmark: (avgTrade != null && avgBench != null) ? (avgTrade - avgBench) : null,
    avg_alpha_per_trade: avgAlphaPerTrade,
    cumulative_return: cumulative,
    benchmark_cumulative_return: benchmarkCumulative,
    cagr,
    benchmark_cagr: benchmarkCagr,
    sharpe,
    info_ratio: infoRatio,
    max_drawdown: maxDrawdown(equityCurve),
    benchmark_max_drawdown: maxDrawdown(benchCurve),
    alpha_buckets: buckets,
  };
}

function pickWinner(championMetrics, challengerMetricsList, minSample) {
  let bestChallenger = null;
  let bestChallengerCagr = -Infinity;

  for (const ch of challengerMetricsList) {
    if (ch.sample_n < minSample) continue;
    const cagr = ch.cagr ?? -Infinity;
    if (cagr > bestChallengerCagr) {
      bestChallengerCagr = cagr;
      bestChallenger = ch;
    }
  }

  if (!bestChallenger || championMetrics.sample_n < minSample) {
    return {
      winner: 'INSUFFICIENT_SAMPLE',
      reason: `Need >= ${minSample} matched events for robust promotion`,
    };
  }

  if (bestChallengerCagr > (championMetrics.cagr ?? -Infinity)) {
    return {
      winner: 'CHALLENGER',
      challenger_id: bestChallenger._id,
      reason: `${bestChallenger.name} has higher simulated CAGR on matched out-of-sample events`,
    };
  }

  if ((bestChallenger.avg_trade_return ?? -Infinity) > (championMetrics.avg_trade_return ?? -Infinity)) {
    return {
      winner: 'CHALLENGER',
      challenger_id: bestChallenger._id,
      reason: `${bestChallenger.name} has higher average trade return`,
    };
  }

  return {
    winner: 'CHAMPION',
    reason: 'Champion remains better on simulated portfolio returns',
  };
}

function buildBenchmarkMap(rows, holdDays) {
  const out = new Map();
  for (const r of rows) {
    const d = r.report_date || '';
    const spy = asNum(r.spy_return_20d);
    const qqq = asNum(r.qqq_return_20d);
    const spyAdj = spy != null ? spy : asNum(r.spy_return_5d) != null ? toHoldReturn(asNum(r.spy_return_5d), holdDays) : null;
    const qqqAdj = qqq != null ? qqq : asNum(r.qqq_return_5d) != null ? toHoldReturn(asNum(r.qqq_return_5d), holdDays) : null;
    if (!d) continue;
    out.set(d, { spy: spyAdj, qqq: qqqAdj });
  }
  return out;
}

export async function run() {
  const cfg = await readJson(path.join(tradingDir, 'backtest', 'config', 'model_variants.json'));
  const profile = await readJson(path.join(tradingDir, 'config', 'profile.json'));

  const featuresPath = path.join(tradingDir, 'data', 'features', 'latest_features.csv');
  const outcomesPath = path.join(tradingDir, 'data', 'alt', 'earnings_outcomes.csv');
  const benchmarkPath = path.join(tradingDir, 'data', 'alt', 'benchmark_returns.csv');

  const features = await readCsvSafe(featuresPath);
  const outcomes = await readCsvSafe(outcomesPath);
  const benchmarkRows = await readCsvSafe(benchmarkPath, []);

  const featureByTicker = new Map(features.map((f) => [(f.ticker || '').toUpperCase(), f]));

  const threshold = asNum(cfg?.selection?.score_threshold) ?? 0.5;
  const minSample = Number(cfg?.selection?.min_sample_for_winner ?? 20);
  const holdDays = Number(cfg?.selection?.hold_days ?? 20);
  const benchmarkPref = String(cfg?.selection?.benchmark || 'QQQ').toUpperCase();

  const benchmarkMap = buildBenchmarkMap(benchmarkRows, holdDays);

  // Normalize challengers — support both old single-challenger and new array format
  const challengers = Array.isArray(cfg.challengers)
    ? cfg.challengers
    : cfg.challenger ? [cfg.challenger] : [];

  // Score each event for champion + all challengers
  const baseEvents = outcomes
    .map((o) => {
      const ticker = (o.ticker || '').toUpperCase();
      const feat = featureByTicker.get(ticker);
      if (!feat) return null;

      const r5 = asNum(o.post_earnings_return_5d);
      if (r5 == null) return null;
      const tradeReturn = toHoldReturn(r5, holdDays);

      const bench = benchmarkMap.get(o.report_date || '');
      const benchPreferred = benchmarkPref === 'SPY' ? bench?.spy : bench?.qqq;
      const benchmarkReturn = benchPreferred ?? null;

      const row = {
        ticker,
        report_date: o.report_date || '',
        realized_return_5d: r5,
        trade_return: tradeReturn,
        benchmark_return: benchmarkReturn,
        champion_score: modelScore(feat, cfg.champion.weights),
      };

      for (const ch of challengers) {
        row[`score_${ch.id}`] = modelScore(feat, ch.weights);
      }

      return row;
    })
    .filter(Boolean);

  const crossSectionBench = baseEvents.length
    ? baseEvents.reduce((a, b) => a + (asNum(b.trade_return) ?? 0), 0) / baseEvents.length
    : 0;

  const benchmarkMode = benchmarkMap.size ? benchmarkPref : 'CROSS_SECTIONAL_PROXY';

  const eventRows = baseEvents.map((r) => ({
    ...r,
    benchmark_return: r.benchmark_return ?? crossSectionBench,
  }));

  // Group events by report_date period for rank-based selection.
  // Each model selects its top-N per period by score, so weight differences
  // actually change which trades get picked (unlike a flat threshold that
  // can select identical trades when scores cluster above the cutoff).
  const topNPerPeriod = Number(cfg?.selection?.top_n_per_period ?? 5);

  function selectByRank(events, scoreKey) {
    // Group by report_date (quarterly period)
    const byPeriod = new Map();
    for (const r of events) {
      const period = (r.report_date || '').slice(0, 7); // YYYY-MM
      const arr = byPeriod.get(period) || [];
      arr.push(r);
      byPeriod.set(period, arr);
    }
    // Within each period, rank by score and select top N
    const selected = new Set();
    for (const [, group] of byPeriod) {
      const sorted = [...group].sort((a, b) => (b[scoreKey] ?? 0) - (a[scoreKey] ?? 0));
      for (let i = 0; i < Math.min(topNPerPeriod, sorted.length); i++) {
        selected.add(sorted[i]);
      }
    }
    return events.map((r) => ({
      ...r,
      score: r[scoreKey] ?? 0,
      selected: selected.has(r),
    }));
  }

  // Champion metrics
  const championEvents = selectByRank(eventRows, 'champion_score');
  const championMetrics = computePortfolioMetrics(cfg.champion.name, championEvents, -Infinity, holdDays, benchmarkMode);

  // Per-challenger metrics
  const challengerResults = {};
  const challengerMetricsList = [];
  for (const ch of challengers) {
    const chEvents = selectByRank(eventRows, `score_${ch.id}`);
    const metrics = computePortfolioMetrics(ch.name, chEvents, -Infinity, holdDays, benchmarkMode);
    metrics._id = ch.id;
    challengerResults[ch.id] = metrics;
    challengerMetricsList.push(metrics);
  }

  const decision = pickWinner(championMetrics, challengerMetricsList, minSample);

  // Build output — backward-compatible: keep top-level `champion` and `challenger` (best challenger)
  const bestChallengerId = decision.challenger_id || challengers[0]?.id;
  const bestChallengerMetrics = challengerResults[bestChallengerId] || challengerMetricsList[0] || null;

  const asOf = todayDate(profile?.timezone || 'America/New_York');
  const summary = {
    as_of_date: asOf,
    threshold,
    hold_days: holdDays,
    benchmark_mode: benchmarkMode,
    min_sample_for_winner: minSample,
    champion: { ...championMetrics, id: cfg.champion.id },
    challenger: bestChallengerMetrics ? { ...bestChallengerMetrics, id: bestChallengerId } : null,
    challengers: challengerResults,
    decision,
  };

  const outDir = path.join(tradingDir, 'backtest', 'results');
  await fs.mkdir(outDir, { recursive: true });

  const jsonOut = path.join(outDir, 'latest_backtest.json');
  const mdOut = path.join(outDir, `${asOf}-alpha-backtest.md`);
  const csvOut = path.join(outDir, `${asOf}-alpha-backtest-events.csv`);

  await fs.writeFile(jsonOut, JSON.stringify(summary, null, 2), 'utf8');

  // CSV: champion_score + one column per challenger
  const csvHeaders = [
    'ticker',
    'report_date',
    'realized_return_5d',
    'simulated_return_hold',
    'benchmark_return_hold',
    'champion_score',
    'champion_selected',
    ...challengers.flatMap((ch) => [`${ch.id}_score`, `${ch.id}_selected`]),
  ];

  const detailRows = eventRows.map((r) => {
    const row = {
      ticker: r.ticker,
      report_date: r.report_date,
      realized_return_5d: n(r.realized_return_5d, 4),
      simulated_return_hold: n(r.trade_return, 4),
      benchmark_return_hold: n(r.benchmark_return, 4),
      champion_score: n(r.champion_score, 4),
      champion_selected: r.champion_score >= threshold,
    };
    for (const ch of challengers) {
      row[`${ch.id}_score`] = n(r[`score_${ch.id}`], 4);
      row[`${ch.id}_selected`] = r[`score_${ch.id}`] >= threshold;
    }
    return row;
  });

  await fs.writeFile(csvOut, toCsv(detailRows, csvHeaders), 'utf8');

  // Markdown report
  const fmtBuckets = (buckets) => {
    if (!buckets?.length) return ['- n/a'];
    return buckets.map((b) => `- ${b.bucket}: n=${b.sample_n}, avg alpha=${pct(b.avg_alpha) || 'n/a'}, score range=${n(b.min_score, 3)}..${n(b.max_score, 3)}`);
  };

  const fmtMetrics = (label, m) => [
    `## ${label}`,
    '',
    `- Name: ${m.name}`,
    `- Trades: ${m.trades_n}/${m.sample_n} (${pct(m.participation_rate) || 'n/a'})`,
    `- Hit rate: ${pct(m.hit_rate) || 'n/a'}`,
    `- CAGR: ${pct(m.cagr) || 'n/a'}`,
    `- Sharpe: ${n(m.sharpe, 3) || 'n/a'}`,
    `- Max drawdown: ${pct(m.max_drawdown) || 'n/a'}`,
    `- Avg trade return (${holdDays}d): ${pct(m.avg_trade_return) || 'n/a'}`,
    `- Avg benchmark return (${holdDays}d): ${pct(m.avg_benchmark_return) || 'n/a'}`,
    `- Avg alpha per trade: ${pct(m.avg_alpha_per_trade) || 'n/a'}`,
    '',
    `### ${label} Alpha Buckets`,
    ...fmtBuckets(m.alpha_buckets),
    '',
  ];

  const md = [
    `# Alpha Backtest - ${asOf}`,
    '',
    `- Threshold: ${threshold}`,
    `- Hold days: ${holdDays}`,
    `- Benchmark mode: ${benchmarkMode}`,
    `- Min sample for promotion: ${minSample}`,
    `- Matched events: ${eventRows.length}`,
    `- Models tested: 1 champion + ${challengers.length} challengers`,
    '',
    ...fmtMetrics('Champion', championMetrics),
    ...challengers.flatMap((ch) => fmtMetrics(`Challenger: ${ch.name}`, challengerResults[ch.id])),
    '## Decision',
    '',
    `- Winner: ${decision.winner}`,
    `- Reason: ${decision.reason}`,
    '',
    '## Notes',
    '',
    '- Uses event-based out-of-sample simulation with configurable hold period.',
    '- If benchmark_returns.csv is absent, benchmark falls back to cross-sectional proxy.',
  ].join('\n');

  await fs.writeFile(mdOut, md, 'utf8');

  console.log(`Wrote: ${jsonOut}`);
  console.log(`Wrote: ${csvOut}`);
  console.log(`Wrote: ${mdOut}`);
  console.log(`Decision: ${decision.winner} (${decision.reason})`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
