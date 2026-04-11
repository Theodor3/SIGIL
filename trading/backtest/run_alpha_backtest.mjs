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

// ── Point-in-time feature snapshots ──────────────────────────────────────────
// Each pipeline run saves `data/features/YYYY-MM-DD_features.csv`.
// For each earnings event, we look up the most recent snapshot that was
// produced BEFORE the event's report_date. This eliminates look-ahead bias:
// the model can only use information that existed on that date.
//
// Events with no prior snapshot are scored with latest_features.csv and
// flagged as `pit: false` (biased). As pipeline runs accumulate these events
// will naturally migrate to `pit: true`.

async function loadFeatureSnapshots(featuresDir) {
  let files;
  try {
    files = await fs.readdir(featuresDir);
  } catch {
    return [];
  }

  const snapshots = [];
  for (const f of files) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})_features\.csv$/);
    if (!m) continue;
    const snapshotDate = m[1];
    try {
      const text = await fs.readFile(path.join(featuresDir, f), 'utf8');
      const rows = parseCsv(text);
      const map = new Map(rows.map((r) => [(r.ticker || '').toUpperCase(), r]));
      snapshots.push({ date: snapshotDate, features: map });
    } catch {
      // skip unreadable snapshot
    }
  }

  // Sort ascending so we can binary-search for the most recent prior snapshot
  snapshots.sort((a, b) => a.date.localeCompare(b.date));
  return snapshots;
}

// Returns the features map from the most recent snapshot strictly before eventDate,
// or null if no prior snapshot exists.
function findPriorSnapshot(snapshots, eventDate) {
  // Walk backwards to find the latest snapshot whose date < eventDate
  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (snapshots[i].date < eventDate) {
      return snapshots[i].features;
    }
  }
  return null;
}

// ── PEAD point-in-time rolling backtest ──────────────────────────────────────
// Computes PEAD signal for each historical earnings event using ONLY prior
// events for that ticker (rolling window). This is the cleanest signal we have:
// no external features required, zero look-ahead bias by construction.
//
// Signal: pead_pit_score = max(avg_prior_return, 0) * hit_rate * beat_prob
// Same formula as the live PEAD signal, but trained on prior-only data.

function computePeadPitBacktest(outcomes, holdDays, benchmarkMap, benchmarkPref) {
  const sorted = [...outcomes]
    .map((o) => ({
      ticker: (o.ticker || '').toUpperCase(),
      report_date: o.report_date || '',
      r5: asNum(o.post_earnings_return_5d),
      rev_surprise: asNum(o.revenue_surprise_pct),
    }))
    .filter((o) => o.ticker && o.report_date && o.r5 != null)
    .sort((a, b) => a.report_date.localeCompare(b.report_date));

  const events = [];
  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i];
    const prior = sorted.slice(0, i).filter((e) => e.ticker === ev.ticker);
    if (prior.length < 2) continue; // need at least 2 prior samples

    const returns = prior.map((e) => e.r5);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const hitRate = returns.filter((r) => r > 0).length / returns.length;

    const beats = prior.map((e) => e.rev_surprise).filter((v) => v != null);
    const beatProb = beats.length ? beats.filter((b) => b > 0).length / beats.length : 0.5;

    const peadScore = Math.max(avgReturn, 0) * hitRate * beatProb;

    const bench = benchmarkMap.get(ev.report_date);
    const benchVal = (benchmarkPref === 'SPY' ? bench?.spy : bench?.qqq) ?? null;

    events.push({
      ticker: ev.ticker,
      report_date: ev.report_date,
      pead_pit_score: peadScore,
      prior_samples: prior.length,
      avg_prior_return: avgReturn,
      hit_rate: hitRate,
      beat_prob: beatProb,
      trade_return: toHoldReturn(ev.r5, holdDays),
      benchmark_return: benchVal,
      score: peadScore,
      selected: peadScore > 0,
    });
  }

  return events;
}

export async function run() {
  const cfg = await readJson(path.join(tradingDir, 'backtest', 'config', 'model_variants.json'));
  const profile = await readJson(path.join(tradingDir, 'config', 'profile.json'));

  const featuresDir = path.join(tradingDir, 'data', 'features');
  const featuresPath = path.join(featuresDir, 'latest_features.csv');
  const outcomesPath = path.join(tradingDir, 'data', 'alt', 'earnings_outcomes.csv');
  const benchmarkPath = path.join(tradingDir, 'data', 'alt', 'benchmark_returns.csv');

  const latestFeatures = await readCsvSafe(featuresPath);
  const outcomes = await readCsvSafe(outcomesPath);
  const benchmarkRows = await readCsvSafe(benchmarkPath, []);

  // Load all dated feature snapshots for point-in-time scoring
  const snapshots = await loadFeatureSnapshots(featuresDir);
  const latestFeatureMap = new Map(latestFeatures.map((f) => [(f.ticker || '').toUpperCase(), f]));

  const threshold = asNum(cfg?.selection?.score_threshold) ?? 0.5;
  const minSample = Number(cfg?.selection?.min_sample_for_winner ?? 20);
  const holdDays = Number(cfg?.selection?.hold_days ?? 20);
  const benchmarkPref = String(cfg?.selection?.benchmark || 'QQQ').toUpperCase();

  const benchmarkMap = buildBenchmarkMap(benchmarkRows, holdDays);

  // Normalize challengers — support both old single-challenger and new array format
  const challengers = Array.isArray(cfg.challengers)
    ? cfg.challengers
    : cfg.challenger ? [cfg.challenger] : [];

  let pitCount = 0;
  let simulatedCount = 0;

  // Score each event for champion + all challengers.
  // For each event, use the most recent feature snapshot that predates the event.
  // If no prior snapshot exists, fall back to latest features and mark as simulated.
  const baseEvents = outcomes
    .map((o) => {
      const ticker = (o.ticker || '').toUpperCase();
      const reportDate = o.report_date || '';
      if (!ticker || !reportDate) return null;

      const r5 = asNum(o.post_earnings_return_5d);
      if (r5 == null) return null;
      const tradeReturn = toHoldReturn(r5, holdDays);

      // Point-in-time feature lookup
      const priorSnapshot = findPriorSnapshot(snapshots, reportDate);
      const featureMap = priorSnapshot ?? latestFeatureMap;
      const feat = featureMap.get(ticker);
      if (!feat) return null;

      const pit = priorSnapshot != null;
      if (pit) pitCount++; else simulatedCount++;

      const bench = benchmarkMap.get(reportDate);
      const benchPreferred = benchmarkPref === 'SPY' ? bench?.spy : bench?.qqq;

      const row = {
        ticker,
        report_date: reportDate,
        realized_return_5d: r5,
        trade_return: tradeReturn,
        benchmark_return: benchPreferred ?? null,
        pit, // true = point-in-time (clean), false = scored with latest features (biased)
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

  // Separate PIT events from simulated events for honest reporting
  const pitEventRows = eventRows.filter((r) => r.pit);
  const simEventRows = eventRows.filter((r) => !r.pit);

  // Group events by report_date period for rank-based selection.
  const topNPerPeriod = Number(cfg?.selection?.top_n_per_period ?? 5);

  function selectByRank(events, scoreKey) {
    const byPeriod = new Map();
    for (const r of events) {
      const period = (r.report_date || '').slice(0, 7); // YYYY-MM
      const arr = byPeriod.get(period) || [];
      arr.push(r);
      byPeriod.set(period, arr);
    }
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

  // Run multi-factor backtest on all events.
  // PIT events are clean; simulated events use today's features (look-ahead bias).
  // When we have enough PIT snapshots (6+ months of pipeline runs), we can
  // restrict to pitEventRows only. For now, all events are used and labeled.
  const eventsForBacktest = eventRows; // TODO: switch to pitEventRows once sufficient coverage

  // Champion metrics
  const championEvents = selectByRank(eventsForBacktest, 'champion_score');
  const championMetrics = computePortfolioMetrics(cfg.champion.name, championEvents, -Infinity, holdDays, benchmarkMode);

  // Per-challenger metrics
  const challengerResults = {};
  const challengerMetricsList = [];
  for (const ch of challengers) {
    const chEvents = selectByRank(eventsForBacktest, `score_${ch.id}`);
    const metrics = computePortfolioMetrics(ch.name, chEvents, -Infinity, holdDays, benchmarkMode);
    metrics._id = ch.id;
    challengerResults[ch.id] = metrics;
    challengerMetricsList.push(metrics);
  }

  const decision = pickWinner(championMetrics, challengerMetricsList, minSample);

  // PEAD point-in-time backtest — cleanest signal, zero look-ahead bias
  const peadPitEvents = computePeadPitBacktest(outcomes, holdDays, benchmarkMap, benchmarkPref);
  const peadPitMetrics = peadPitEvents.length >= 2
    ? computePortfolioMetrics('PEAD PIT', peadPitEvents, -Infinity, holdDays, benchmarkMode)
    : null;

  // Build output
  const bestChallengerId = decision.challenger_id || challengers[0]?.id;
  const bestChallengerMetrics = challengerResults[bestChallengerId] || challengerMetricsList[0] || null;

  const asOf = todayDate(profile?.timezone || 'America/New_York');
  const summary = {
    as_of_date: asOf,
    threshold,
    hold_days: holdDays,
    benchmark_mode: benchmarkMode,
    min_sample_for_winner: minSample,
    data_quality: {
      total_events: eventRows.length,
      pit_events: pitCount,
      simulated_events: simulatedCount,
      pit_coverage_pct: eventRows.length > 0 ? pitCount / eventRows.length : 0,
      snapshots_available: snapshots.length,
      note: pitCount === 0
        ? 'All events scored with current features (look-ahead bias). PIT coverage improves automatically as daily pipeline runs accumulate snapshots.'
        : `${pitCount}/${eventRows.length} events scored point-in-time (${Math.round(pitCount / eventRows.length * 100)}% clean).`,
    },
    champion: { ...championMetrics, id: cfg.champion.id },
    challenger: bestChallengerMetrics ? { ...bestChallengerMetrics, id: bestChallengerId } : null,
    challengers: challengerResults,
    decision,
    pead_pit: peadPitMetrics
      ? { ...peadPitMetrics, events_n: peadPitEvents.length, note: 'Rolling train/test split — zero look-ahead bias' }
      : { note: 'Insufficient data for PEAD PIT backtest' },
  };

  const outDir = path.join(tradingDir, 'backtest', 'results');
  await fs.mkdir(outDir, { recursive: true });

  const jsonOut = path.join(outDir, 'latest_backtest.json');
  const mdOut = path.join(outDir, `${asOf}-alpha-backtest.md`);
  const csvOut = path.join(outDir, `${asOf}-alpha-backtest-events.csv`);

  await fs.writeFile(jsonOut, JSON.stringify(summary, null, 2), 'utf8');

  // CSV: champion_score + one column per challenger + pit flag
  const csvHeaders = [
    'ticker',
    'report_date',
    'pit',
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
      pit: r.pit,
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

  const dq = summary.data_quality;
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
    '## Data Quality',
    '',
    `- PIT events (clean): ${dq.pit_events}`,
    `- Simulated events (look-ahead bias): ${dq.simulated_events}`,
    `- PIT coverage: ${pct(dq.pit_coverage_pct) || '0%'}`,
    `- Dated snapshots available: ${dq.snapshots_available}`,
    `- Note: ${dq.note}`,
    '',
    ...fmtMetrics('Champion', championMetrics),
    ...challengers.flatMap((ch) => fmtMetrics(`Challenger: ${ch.name}`, challengerResults[ch.id])),
    ...(peadPitMetrics ? fmtMetrics('PEAD Point-in-Time (Clean)', peadPitMetrics) : ['## PEAD PIT', '', `- ${summary.pead_pit.note}`, '']),
    '## Decision',
    '',
    `- Winner: ${decision.winner}`,
    `- Reason: ${decision.reason}`,
    '',
    '## Notes',
    '',
    '- Multi-factor backtest uses dated feature snapshots when available (PIT), falls back to latest features (simulated/biased) otherwise.',
    '- PEAD PIT backtest uses rolling train/test split on earnings_outcomes.csv — zero look-ahead bias by construction.',
    '- PIT coverage improves automatically as daily pipeline runs accumulate dated snapshots.',
  ].join('\n');

  await fs.writeFile(mdOut, md, 'utf8');

  console.log(`Wrote: ${jsonOut}`);
  console.log(`Wrote: ${csvOut}`);
  console.log(`Wrote: ${mdOut}`);
  console.log(`PIT coverage: ${pitCount}/${eventRows.length} events (${snapshots.length} snapshots available)`);
  console.log(`Decision: ${decision.winner} (${decision.reason})`);
  if (peadPitMetrics) {
    console.log(`PEAD PIT: ${peadPitEvents.length} events, CAGR=${pct(peadPitMetrics.cagr) || 'n/a'}, hit rate=${pct(peadPitMetrics.hit_rate) || 'n/a'}`);
  }
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
