#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  asNum,
  ensureDir,
  latestFile,
  n,
  parseCsv,
  pct,
  readCsv,
  readJson,
  toCsv,
  todayDate,
} from '../scripts/lib.mjs';

const root = process.cwd();
const altDir = path.join(root, 'trading', 'data', 'alt');
const configDir = path.join(root, 'trading', 'nowcast', 'config');
const outputDir = path.join(root, 'trading', 'output');

const SOURCE_FILES = {
  website_traffic: 'website_traffic.csv',
  app_rank: 'app_rank.csv',
  search_trends: 'search_trends.csv',
  news_mentions: 'news_mentions.csv',
  price_promo: 'price_promo.csv',
  foot_traffic: 'foot_traffic.csv',
  market_price_proxy: 'market_price_proxy.csv',
  market_volume_proxy: 'market_volume_proxy.csv',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  const varSum = arr.reduce((a, b) => a + ((b - m) ** 2), 0) / (arr.length - 1);
  return Math.sqrt(varSum);
}

function daysBetween(a, b) {
  return Math.abs((a.getTime() - b.getTime()) / DAY_MS);
}

function nearestRecord(records, targetDate, maxDistanceDays) {
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const r of records) {
    const dist = daysBetween(r.date, targetDate);
    if (dist <= maxDistanceDays && dist < bestDist) {
      best = r;
      bestDist = dist;
    }
  }
  return best;
}

function recordsBefore(records, asOfDate) {
  return records.filter((r) => r.date <= asOfDate);
}

function inHolidayWindow(asOfDate, holidays, windowDays) {
  return holidays.some((h) => daysBetween(asOfDate, h) <= windowDays);
}

function normalizeHolidayAdjusted(yoy, asOfDate, holidays, windowDays) {
  if (yoy == null) return null;
  if (!inHolidayWindow(asOfDate, holidays, windowDays)) return yoy;
  // Mild dampening around holidays to avoid overreacting to holiday spikes.
  return yoy * 0.85;
}

function computeSeriesFeatures(records, asOfDate, holidays, holidayWindowDays) {
  const hist = recordsBefore(records, asOfDate).sort((a, b) => a.date - b.date);
  if (!hist.length) {
    return {
      yoy: null,
      accel: null,
      zscore: null,
      historyDepth: 0,
    };
  }

  const current = hist[hist.length - 1];
  const currentValue = current.value;

  const yoyRefDate = new Date(asOfDate.getTime() - 364 * DAY_MS);
  const fourWeekDate = new Date(asOfDate.getTime() - 28 * DAY_MS);
  const yoyRef = nearestRecord(hist, yoyRefDate, 21);
  const fourWeekRef = nearestRecord(hist, fourWeekDate, 10);

  const yoyRaw = yoyRef && yoyRef.value > 0 ? (currentValue / yoyRef.value) - 1 : null;
  const yoy = normalizeHolidayAdjusted(yoyRaw, asOfDate, holidays, holidayWindowDays);

  let yoy4w = null;
  if (fourWeekRef && yoyRef && fourWeekRef.value > 0) {
    const fourWeekYoyRefDate = new Date(fourWeekRef.date.getTime() - 364 * DAY_MS);
    const fourWeekYoyRef = nearestRecord(hist, fourWeekYoyRefDate, 21);
    if (fourWeekYoyRef && fourWeekYoyRef.value > 0) {
      yoy4w = (fourWeekRef.value / fourWeekYoyRef.value) - 1;
    }
  }

  const accel = (yoy != null && yoy4w != null) ? (yoy - yoy4w) : null;

  const rollingWindowStart = new Date(asOfDate.getTime() - 56 * DAY_MS);
  const rolling = hist.filter((r) => r.date >= rollingWindowStart).map((r) => r.value);
  const rollingMean = mean(rolling);
  const rollingStd = std(rolling);
  const zscore = (rollingMean != null && rollingStd != null && rollingStd > 0)
    ? (currentValue - rollingMean) / rollingStd
    : null;

  return {
    yoy,
    accel,
    zscore,
    historyDepth: hist.length,
  };
}

function avgNonNull(arr) {
  const vals = arr.filter((v) => v != null);
  return vals.length ? mean(vals) : null;
}

function describeCoverage(sourceFeatures) {
  const directSources = ['website_traffic', 'app_rank', 'search_trends', 'news_mentions', 'price_promo', 'foot_traffic'];
  const proxySources = ['market_price_proxy', 'market_volume_proxy'];

  const directCount = directSources.filter((source) => sourceFeatures[source]?.yoy != null).length;
  const proxyCount = proxySources.filter((source) => sourceFeatures[source]?.yoy != null).length;
  const totalCount = directCount + proxyCount;

  let coverageLabel = 'none';
  if (directCount > 0 && proxyCount > 0) coverageLabel = 'hybrid';
  else if (directCount > 0) coverageLabel = 'direct';
  else if (proxyCount > 0) coverageLabel = 'proxy_only';

  return {
    direct_count: directCount,
    proxy_count: proxyCount,
    total_count: totalCount,
    coverage_label: coverageLabel,
    proxy_share: totalCount > 0 ? proxyCount / totalCount : 0,
  };
}

function parseSourceRows(rows) {
  return rows
    .map((r) => ({
      date: toDate(r.date),
      ticker: (r.ticker || '').toUpperCase(),
      value: asNum(r.value),
    }))
    .filter((r) => r.date && r.ticker && r.value != null);
}

function defaultSourceProvenance(source) {
  const labels = {
    website_traffic: 'local_csv',
    app_rank: 'local_csv',
    search_trends: 'wikimedia',
    news_mentions: 'unknown',
    price_promo: 'local_csv',
    foot_traffic: 'local_csv',
    market_price_proxy: 'market_proxy',
    market_volume_proxy: 'market_proxy',
  };
  return labels[source] || 'unknown';
}

function featureVector(entry) {
  return [
    entry.yoy_mean,
    entry.accel_mean,
    entry.relative_strength_mean,
    entry.search_trends_yoy,
    entry.news_mentions_yoy,
    entry.website_traffic_yoy,
    entry.app_rank_yoy,
    entry.price_promo_yoy,
    entry.foot_traffic_yoy,
    entry.market_price_proxy_yoy,
    entry.market_volume_proxy_yoy,
  ].map((x) => (x == null ? 0 : x));
}

function euclidean(a, b) {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    s += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(s);
}

function topContributors(features, weights) {
  const contributors = [];
  for (const [k, w] of Object.entries(weights)) {
    const v = features[k];
    if (v == null) continue;
    contributors.push({
      key: k,
      contribution: v * w,
    });
  }
  contributors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return contributors.slice(0, 3);
}

async function loadInput() {
  const modelConfig = await readJson(path.join(configDir, 'model_config.json'));
  const peerGroups = await readJson(path.join(configDir, 'peer_groups.json'));

  const sourceData = {};
  for (const [source, filename] of Object.entries(SOURCE_FILES)) {
    const rows = await readCsv(path.join(altDir, filename));
    sourceData[source] = parseSourceRows(rows);
  }

  const consensus = await readCsv(path.join(altDir, 'consensus_estimates.csv'));
  const earningsCalendar = await readCsv(path.join(altDir, 'earnings_calendar.csv'));
  const holidaysRows = await readCsv(path.join(altDir, 'us_holidays.csv'));
  const outcomes = await readCsv(path.join(altDir, 'earnings_outcomes.csv'));
  const newsProvenanceRows = await readCsv(path.join(altDir, 'news_mentions_provenance.csv')).catch(() => []);

  const holidays = holidaysRows
    .map((r) => toDate(r.holiday_date))
    .filter(Boolean);

  return {
    modelConfig,
    peerGroups,
    sourceData,
    consensus,
    earningsCalendar,
    holidays,
    outcomes,
    newsProvenanceRows,
  };
}

function chooseAsOfDate(modelConfig, sourceData) {
  if (modelConfig?.run?.as_of_date && modelConfig.run.as_of_date !== 'auto') {
    const d = toDate(modelConfig.run.as_of_date);
    if (d) return d;
  }

  let maxDate = null;
  for (const rows of Object.values(sourceData)) {
    for (const r of rows) {
      if (!maxDate || r.date > maxDate) maxDate = r.date;
    }
  }
  return maxDate || new Date();
}

function tickerSetFromData(sourceData, earningsCalendar, consensus) {
  const s = new Set();
  for (const rows of Object.values(sourceData)) {
    rows.forEach((r) => s.add(r.ticker));
  }
  earningsCalendar.forEach((r) => s.add((r.ticker || '').toUpperCase()));
  consensus.forEach((r) => s.add((r.ticker || '').toUpperCase()));
  return [...s].filter(Boolean);
}

function buildTickerFeatures({
  ticker,
  asOfDate,
  sourceData,
  peerGroups,
  holidays,
  modelConfig,
  precomputed,
}) {
  const holidayWindowDays = Number(modelConfig?.holiday_window_days ?? 3);

  const sourceFeatures = {};
  for (const [source, rows] of Object.entries(sourceData)) {
    const series = rows.filter((r) => r.ticker === ticker);
    sourceFeatures[source] = computeSeriesFeatures(series, asOfDate, holidays, holidayWindowDays);
  }

  const peers = peerGroups[ticker] || [];
  const peerSourceYoy = {};
  for (const source of Object.keys(sourceData)) {
    const peerVals = peers
      .map((p) => precomputed?.[p]?.sourceFeatures?.[source]?.yoy)
      .filter((v) => v != null);
    peerSourceYoy[source] = peerVals.length ? mean(peerVals) : null;
  }

  const relativeBySource = {};
  for (const source of Object.keys(sourceData)) {
    const selfYoy = sourceFeatures[source].yoy;
    const peerY = peerSourceYoy[source];
    relativeBySource[source] = (selfYoy != null && peerY != null) ? (selfYoy - peerY) : null;
  }

  const yoyMean = avgNonNull(Object.values(sourceFeatures).map((x) => x.yoy));
  const accelMean = avgNonNull(Object.values(sourceFeatures).map((x) => x.accel));
  const relMean = avgNonNull(Object.values(relativeBySource));

  const coverage = Object.values(sourceFeatures).filter((x) => x.yoy != null).length;
  const historyDepthMean = avgNonNull(Object.values(sourceFeatures).map((x) => x.historyDepth)) ?? 0;
  const peerQuality = peers.length
    ? peers.filter((p) => precomputed?.[p]).length / peers.length
    : 0;
  const coverageMeta = describeCoverage(sourceFeatures);

  const confCfg = modelConfig.model.confidence;
  const baseConfidence = clamp(
    (coverage / Object.keys(SOURCE_FILES).length) * confCfg.source_coverage_weight +
      clamp(historyDepthMean / 52, 0, 1) * confCfg.history_depth_weight +
      peerQuality * confCfg.peer_quality_weight,
    0,
    1,
  );
  const proxyCoverageFloor = Number(confCfg.proxy_coverage_floor ?? 0.8);
  const proxyOnlyPenalty = Number(confCfg.proxy_only_penalty ?? 0.12);
  const proxyAdjustedConfidence = coverageMeta.direct_count === 0 && coverageMeta.proxy_count > 0
    ? Math.max(baseConfidence * proxyCoverageFloor, baseConfidence - proxyOnlyPenalty)
    : baseConfidence;
  const confidence = clamp(proxyAdjustedConfidence, 0, 1);
  const newsProvenanceRow = (precomputed?.__newsProvenanceIndex || new Map()).get(ticker) || null;
  const sourceProvenance = {
    website_traffic: defaultSourceProvenance('website_traffic'),
    app_rank: defaultSourceProvenance('app_rank'),
    search_trends: defaultSourceProvenance('search_trends'),
    news_mentions: newsProvenanceRow?.primary_source || defaultSourceProvenance('news_mentions'),
    price_promo: defaultSourceProvenance('price_promo'),
    foot_traffic: defaultSourceProvenance('foot_traffic'),
    market_price_proxy: defaultSourceProvenance('market_price_proxy'),
    market_volume_proxy: defaultSourceProvenance('market_volume_proxy'),
  };

  return {
    ticker,
    asOfDate,
    sourceFeatures,
    relativeBySource,
    yoy_mean: yoyMean,
    accel_mean: accelMean,
    relative_strength_mean: relMean,
    website_traffic_yoy: sourceFeatures.website_traffic.yoy,
    app_rank_yoy: sourceFeatures.app_rank.yoy,
    search_trends_yoy: sourceFeatures.search_trends.yoy,
    news_mentions_yoy: sourceFeatures.news_mentions.yoy,
    price_promo_yoy: sourceFeatures.price_promo.yoy,
    foot_traffic_yoy: sourceFeatures.foot_traffic.yoy,
    market_price_proxy_yoy: sourceFeatures.market_price_proxy.yoy,
    market_volume_proxy_yoy: sourceFeatures.market_volume_proxy.yoy,
    source_coverage: coverage,
    direct_source_count: coverageMeta.direct_count,
    proxy_source_count: coverageMeta.proxy_count,
    source_mix: coverageMeta.coverage_label,
    proxy_share: coverageMeta.proxy_share,
    confidence_score: confidence,
    source_provenance: sourceProvenance,
    peer_group: peers,
    peer_quality: peerQuality,
    history_depth: historyDepthMean,
  };
}

function applyModels(features, modelConfig, consensusRow) {
  const revModel = modelConfig.model.revenue_surprise;
  const revWeights = revModel.weights;
  let predictedRevenueSurprise = revModel.intercept;
  for (const [k, w] of Object.entries(revWeights)) {
    predictedRevenueSurprise += (features[k] ?? 0) * w;
  }

  const probModel = modelConfig.model.outperformance_probability;
  let probScore = probModel.intercept;
  for (const [k, w] of Object.entries(probModel.weights)) {
    probScore += (k === 'predicted_revenue_surprise' ? predictedRevenueSurprise : (features[k] ?? 0)) * w;
  }

  const probability = clamp(sigmoid(probScore), 0.01, 0.99);
  const consensusSurprise = asNum(consensusRow?.consensus_revenue_surprise_pct) ?? 0;
  const deviationVsConsensus = predictedRevenueSurprise - consensusSurprise;

  let expectedReaction = 'Mixed / neutral expected reaction';
  if (probability >= 0.65 && predictedRevenueSurprise > 0) expectedReaction = 'Likely positive post-earnings drift';
  else if (probability <= 0.35 && predictedRevenueSurprise < 0) expectedReaction = 'Likely negative post-earnings drift';

  const drivers = topContributors(
    {
      ...features,
      predicted_revenue_surprise: predictedRevenueSurprise,
    },
    revWeights,
  );

  return {
    predicted_revenue_surprise: predictedRevenueSurprise,
    probability_outperform: probability,
    deviation_vs_consensus: deviationVsConsensus,
    expected_reaction: expectedReaction,
    strongest_drivers: drivers,
  };
}

function buildOutcomeIndex(outcomes) {
  return outcomes.map((r) => ({
    ticker: (r.ticker || '').toUpperCase(),
    report_date: toDate(r.report_date),
    revenue_surprise_pct: asNum(r.revenue_surprise_pct),
    post_earnings_return_5d: asNum(r.post_earnings_return_5d),
  })).filter((r) => r.ticker && r.report_date && r.post_earnings_return_5d != null);
}

function summarizeBacktest(current, setups) {
  if (!setups.length) {
    return {
      sample_n: 0,
      hit_rate: null,
      avg_return: null,
      similar_setup_avg_return: null,
      text: 'Insufficient historical setups (need outcomes + historical alt data).',
    };
  }

  let hits = 0;
  let total = 0;
  const returns = [];

  for (const s of setups) {
    const predSign = Math.sign(s.predicted_revenue_surprise);
    const retSign = Math.sign(s.post_earnings_return_5d);
    if (predSign !== 0 && retSign !== 0) {
      total += 1;
      if (predSign === retSign) hits += 1;
    }
    returns.push(s.post_earnings_return_5d);
  }

  const currVec = featureVector(current);
  const nearest = setups
    .map((s) => ({
      ...s,
      dist: euclidean(currVec, featureVector(s.features)),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5);

  const similarAvg = mean(nearest.map((x) => x.post_earnings_return_5d));
  const hitRate = total > 0 ? hits / total : null;
  const avgRet = mean(returns);

  const txt = `n=${setups.length}, hit_rate=${hitRate == null ? 'n/a' : pct(hitRate)}, avg_5d=${avgRet == null ? 'n/a' : pct(avgRet)}, similar5_avg_5d=${similarAvg == null ? 'n/a' : pct(similarAvg)}`;

  return {
    sample_n: setups.length,
    hit_rate: hitRate,
    avg_return: avgRet,
    similar_setup_avg_return: similarAvg,
    text: txt,
  };
}

export async function run() {
  const input = await loadInput();
  const asOfDate = chooseAsOfDate(input.modelConfig, input.sourceData);
  const asOfStr = asOfDate.toISOString().slice(0, 10);

  const tickers = tickerSetFromData(input.sourceData, input.earningsCalendar, input.consensus);
  const consensusIndex = new Map(
    input.consensus.map((r) => [
      (r.ticker || '').toUpperCase(),
      r,
    ])
  );

  const newsProvenanceIndex = new Map(
    input.newsProvenanceRows.map((row) => [
      String(row.ticker || '').toUpperCase(),
      {
        primary_source: String(row.primary_source || ''),
        gdelt_rows: asNum(row.gdelt_rows),
        finnhub_backfill_rows: asNum(row.finnhub_backfill_rows),
        total_rows: asNum(row.total_rows),
      },
    ])
  );

  // Precompute base features first pass for peer-relative comparisons.
  const pass1 = {};
  for (const t of tickers) {
    pass1[t] = buildTickerFeatures({
      ticker: t,
      asOfDate,
      sourceData: input.sourceData,
      peerGroups: input.peerGroups,
      holidays: input.holidays,
      modelConfig: input.modelConfig,
      precomputed: { __newsProvenanceIndex: newsProvenanceIndex },
    });
  }

  const pass2 = {};
  for (const t of tickers) {
    pass2[t] = buildTickerFeatures({
      ticker: t,
      asOfDate,
      sourceData: input.sourceData,
      peerGroups: input.peerGroups,
      holidays: input.holidays,
      modelConfig: input.modelConfig,
      precomputed: { ...pass1, __newsProvenanceIndex: newsProvenanceIndex },
    });
  }

  const outcomes = buildOutcomeIndex(input.outcomes);

  const rows = [];
  for (const t of tickers) {
    const features = pass2[t];
    const coverageMin = Number(input.modelConfig.run.minimum_source_coverage ?? 2);

    const consensusRow = consensusIndex.get(t);
    const modeled = applyModels(features, input.modelConfig, consensusRow);

    // Backtest setups for this ticker from historical outcomes.
    const tickerOutcomes = outcomes.filter((o) => o.ticker === t);
    const setups = [];

    for (const o of tickerOutcomes) {
      const setupDate = new Date(o.report_date.getTime() - 7 * DAY_MS);
      const histFeat = buildTickerFeatures({
        ticker: t,
        asOfDate: setupDate,
        sourceData: input.sourceData,
        peerGroups: input.peerGroups,
        holidays: input.holidays,
        modelConfig: input.modelConfig,
        precomputed: pass1,
      });

      if (histFeat.source_coverage < coverageMin) continue;
      const histModeled = applyModels(histFeat, input.modelConfig, consensusRow);

      setups.push({
        ...o,
        features: histFeat,
        predicted_revenue_surprise: histModeled.predicted_revenue_surprise,
      });
    }

    const backtest = summarizeBacktest(features, setups);

    rows.push({
      ticker: t,
      company: t,
      strongest_drivers: modeled.strongest_drivers.map((d) => `${d.key} (${pct(d.contribution)})`).join('; '),
      source_provenance_summary: [
        `search:${features.source_provenance.search_trends}`,
        `news:${features.source_provenance.news_mentions}`,
        `price_proxy:${features.source_provenance.market_price_proxy}`,
        `volume_proxy:${features.source_provenance.market_volume_proxy}`,
      ].join(' | '),
      confidence_score: n(features.confidence_score, 3),
      source_mix: features.source_mix,
      direct_source_count: features.direct_source_count,
      proxy_source_count: features.proxy_source_count,
      proxy_share: pct(features.proxy_share),
      website_traffic_yoy: pct(features.website_traffic_yoy),
      app_rank_yoy: pct(features.app_rank_yoy),
      search_trends_yoy: pct(features.search_trends_yoy),
      search_trends_provenance: features.source_provenance.search_trends,
      news_mentions_yoy: pct(features.news_mentions_yoy),
      news_mentions_provenance: features.source_provenance.news_mentions,
      price_promo_yoy: pct(features.price_promo_yoy),
      price_promo_provenance: features.source_provenance.price_promo,
      foot_traffic_yoy: pct(features.foot_traffic_yoy),
      foot_traffic_provenance: features.source_provenance.foot_traffic,
      website_traffic_provenance: features.source_provenance.website_traffic,
      app_rank_provenance: features.source_provenance.app_rank,
      market_price_proxy_yoy: pct(features.market_price_proxy_yoy),
      market_price_proxy_provenance: features.source_provenance.market_price_proxy,
      market_volume_proxy_yoy: pct(features.market_volume_proxy_yoy),
      market_volume_proxy_provenance: features.source_provenance.market_volume_proxy,
      expected_kpi_surprise: pct(modeled.predicted_revenue_surprise),
      expected_stock_reaction: modeled.expected_reaction,
      probability_post_earnings_outperform: pct(modeled.probability_outperform),
      deviation_vs_consensus: n(modeled.deviation_vs_consensus, 4),
      signal_strength: Math.abs(modeled.deviation_vs_consensus) * features.confidence_score,
      historical_backtest: backtest.text,
      report_date: consensusRow?.report_date || '',
    });
  }

  rows.sort((a, b) => b.signal_strength - a.signal_strength);
  const topN = Number(input.modelConfig.run.top_n ?? 20);
  const top = rows.slice(0, topN);

  await ensureDir(outputDir);
  const outCsv = path.join(outputDir, `${asOfStr}-alt-nowcast-top20.csv`);
  const outMd = path.join(outputDir, `${asOfStr}-alt-nowcast-top20.md`);

  const headers = [
    'company',
    'ticker',
    'strongest_drivers',
    'source_provenance_summary',
    'confidence_score',
    'source_mix',
    'direct_source_count',
    'proxy_source_count',
    'proxy_share',
    'website_traffic_yoy',
    'app_rank_yoy',
    'search_trends_yoy',
    'search_trends_provenance',
    'news_mentions_yoy',
    'news_mentions_provenance',
    'price_promo_yoy',
    'price_promo_provenance',
    'foot_traffic_yoy',
    'foot_traffic_provenance',
    'website_traffic_provenance',
    'app_rank_provenance',
    'market_price_proxy_yoy',
    'market_price_proxy_provenance',
    'market_volume_proxy_yoy',
    'market_volume_proxy_provenance',
    'expected_kpi_surprise',
    'expected_stock_reaction',
    'probability_post_earnings_outperform',
    'deviation_vs_consensus',
    'historical_backtest',
    'report_date',
  ];

  await fs.writeFile(outCsv, toCsv(top, headers), 'utf8');

  const md = [
    `# Alternative Data Earnings Nowcast - ${asOfStr}`,
    '',
    `- Universe processed: ${rows.length}`,
    `- Top ranked: ${top.length}`,
    `- Ranking basis: |predicted revenue surprise - consensus surprise| * confidence`,
    '',
    '| Company | Strongest Drivers | Confidence | Source Mix | Expected KPI Surprise | Expected Stock Reaction | Backtest |',
    '|---|---|---:|---|---:|---|---|',
    ...top.map((r) => `| ${r.company} | ${r.strongest_drivers || 'n/a'} | ${r.confidence_score} | ${r.source_mix || 'n/a'} | ${r.expected_kpi_surprise} | ${r.expected_stock_reaction} | ${r.historical_backtest} |`),
    '',
    '## Notes',
    '',
    '- Ensure each source CSV has dense historical history for reliable seasonality normalization and backtests.',
    '- Add more earnings outcomes to improve historical setup matching quality.',
  ].join('\n');

  await fs.writeFile(outMd, md, 'utf8');

  console.log(`Wrote: ${outCsv}`);
  console.log(`Wrote: ${outMd}`);
  console.log(`Top tickers: ${top.map((x) => x.ticker).join(', ')}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}

