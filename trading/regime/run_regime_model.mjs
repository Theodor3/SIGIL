#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { asNum, ensureDir, parseCsv, readJson, toCsv, todayDate } from '../scripts/lib.mjs';
import { clamp, requireColumns } from '../pipeline/validate_data_contracts.mjs';

const root = process.cwd();

const DEFAULT_POLICY = {
  thresholds: {
    risk_off_avg20d: -0.02,
    high_vol_5d_abs: 0.03,
    trend_growth_qqq20d: 0.05,
    trend_growth_spread_5d: 0.008,
    vix_high: 22,
    vix_risk_off: 28,
    vix_change_5d_high: 0.12,
    realized_vol_high: 0.24,
    realized_vol_risk_off: 0.3,
    trend_growth_vix_max: 20,
    trend_growth_realized_vol_max: 0.22,
    breadth_positive_ratio: 0.6,
    breadth_negative_ratio: 0.4,
    breadth_rsp_spy_positive: -0.005,
    breadth_rsp_spy_negative: -0.03,
  },
  exposure: {
    risk_off: 0.35,
    high_vol: 0.5,
    risk_on: 0.75,
    trend_growth: 0.9,
  },
};

async function loadPolicy(tradingDir) {
  try {
    const cfg = await readJson(path.join(tradingDir, 'config', 'regime_policy.json'));
    return {
      ...DEFAULT_POLICY,
      ...cfg,
      thresholds: { ...DEFAULT_POLICY.thresholds, ...(cfg?.thresholds || {}) },
      exposure: { ...DEFAULT_POLICY.exposure, ...(cfg?.exposure || {}) },
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

function parseLeadershipEntries(text) {
  return String(text || '')
    .split('|')
    .map((entry) => {
      const [sector, rawReturn] = entry.split(':');
      const return20d = Number(rawReturn);
      if (!sector || !Number.isFinite(return20d)) return null;
      return { sector: sector.trim(), return20d };
    })
    .filter(Boolean);
}

function leadershipFamilyForSector(sector) {
  const s = String(sector || '').toUpperCase();
  if (['TECH', 'COMMUNICATIONS', 'DISCRETIONARY'].includes(s)) return 'growth_led';
  if (['UTILITIES', 'STAPLES', 'HEALTHCARE', 'REAL_ESTATE'].includes(s)) return 'defensive_led';
  if (['ENERGY', 'MATERIALS', 'INDUSTRIALS', 'FINANCIALS'].includes(s)) return 'cyclical_led';
  return 'mixed_sector_leadership';
}

function classifySectorLeadership(topLeadersText) {
  const entries = parseLeadershipEntries(topLeadersText).filter((entry) => entry.return20d > 0);
  if (!entries.length) {
    return { state: 'unknown', familyScores: {} };
  }

  const familyScores = {};
  let total = 0;
  for (const entry of entries) {
    const family = leadershipFamilyForSector(entry.sector);
    familyScores[family] = (familyScores[family] || 0) + entry.return20d;
    total += entry.return20d;
  }

  const ranked = Object.entries(familyScores)
    .map(([family, score]) => ({ family, score, share: total > 0 ? score / total : 0 }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const second = ranked[1];
  if (!top) {
    return { state: 'unknown', familyScores };
  }

  const dominant = top.share >= 0.58;
  const clearGap = !second || (top.share - second.share) >= 0.16;
  return {
    state: dominant && clearGap ? top.family : 'mixed_sector_leadership',
    familyScores,
  };
}

function chooseRegime(last, policy) {
  const t = policy.thresholds;
  const spy5 = asNum(last.spy_return_5d) ?? 0;
  const qqq5 = asNum(last.qqq_return_5d) ?? 0;
  const spy20 = asNum(last.spy_return_20d) ?? 0;
  const qqq20 = asNum(last.qqq_return_20d) ?? 0;
  const rsp20 = asNum(last.rsp_return_20d);
  const rspSpyRelative20d = asNum(last.rsp_spy_relative_20d);
  const sectorPositiveRatio20d = asNum(last.sector_positive_ratio_20d);
  const topSectorLeaders20d = String(last.top_sector_leaders_20d || '');
  const topSectorLaggards20d = String(last.top_sector_laggards_20d || '');
  const vixClose = asNum(last.vix_close);
  const vixChange5d = asNum(last.vix_change_5d) ?? 0;
  const spyRealizedVol20d = asNum(last.spy_realized_vol_20d);
  const qqqRealizedVol20d = asNum(last.qqq_realized_vol_20d);

  const avg20 = (spy20 + qqq20) / 2;
  const abs5 = Math.max(Math.abs(spy5), Math.abs(qqq5));
  const spread5 = qqq5 - spy5;
  const realizedVol20d = Math.max(spyRealizedVol20d ?? 0, qqqRealizedVol20d ?? 0);
  const breadthPositive =
    (sectorPositiveRatio20d != null && sectorPositiveRatio20d >= Number(t.breadth_positive_ratio)) &&
    (rspSpyRelative20d == null || rspSpyRelative20d >= Number(t.breadth_rsp_spy_positive));
  const breadthNegative =
    (sectorPositiveRatio20d != null && sectorPositiveRatio20d <= Number(t.breadth_negative_ratio)) ||
    (rspSpyRelative20d != null && rspSpyRelative20d <= Number(t.breadth_rsp_spy_negative));
  const volElevated =
    abs5 >= Number(t.high_vol_5d_abs) ||
    (vixClose != null && vixClose >= Number(t.vix_high)) ||
    realizedVol20d >= Number(t.realized_vol_high) ||
    vixChange5d >= Number(t.vix_change_5d_high);
  const volRiskOff =
    (vixClose != null && vixClose >= Number(t.vix_risk_off)) ||
    realizedVol20d >= Number(t.realized_vol_risk_off);

  let regimeId = 'risk_on';
  if (avg20 <= Number(t.risk_off_avg20d) || (volRiskOff && avg20 < 0)) regimeId = 'risk_off';
  else if (volElevated && !breadthPositive) regimeId = 'high_vol';
  else if (
    qqq20 >= Number(t.trend_growth_qqq20d) &&
    spread5 >= Number(t.trend_growth_spread_5d) &&
    (vixClose == null || vixClose <= Number(t.trend_growth_vix_max)) &&
    realizedVol20d <= Number(t.trend_growth_realized_vol_max) &&
    !breadthNegative
  ) regimeId = 'trend_growth';

  const volState =
    volRiskOff ? 'stressed'
      : volElevated ? 'elevated'
        : 'normal';
  const breadthState = breadthPositive
    ? 'broad_positive'
    : breadthNegative
      ? 'broad_negative'
      : (spy20 >= 0 && qqq20 >= 0 ? 'mixed_positive' : (spy20 < 0 && qqq20 < 0 ? 'mixed_negative' : 'mixed'));
  const ratesState = qqq20 > spy20 ? 'growth_favored' : 'defensive_favored';
  const leadership = classifySectorLeadership(topSectorLeaders20d);
  const sectorLeadershipState = leadership.state;
  const whyThisRegime = [
    `Vol ${volRiskOff ? 'stressed' : volElevated ? 'elevated' : 'contained'} with VIX ${vixClose != null ? vixClose.toFixed(2) : 'n/a'}.`,
    `Breadth ${breadthState.replaceAll('_', ' ')} with sector participation ${sectorPositiveRatio20d != null ? `${(sectorPositiveRatio20d * 100).toFixed(1)}%` : 'n/a'}.`,
    `Leadership is ${sectorLeadershipState.replaceAll('_', ' ')}${topSectorLeaders20d ? ` with leaders ${topSectorLeaders20d}.` : '.'}`,
  ].join(' ');

  const vixSignal = vixClose != null ? Math.max(0, (vixClose - 15) / 20) : 0;
  const realizedVolSignal = Math.max(0, realizedVol20d / 0.35);
  const breadthSignal = breadthPositive ? 0.2 : breadthNegative ? 0.25 : 0.1;
  const confidenceBase = clamp(
    Math.abs(avg20) * 7 +
    Math.abs(spread5) * 6 +
    Math.abs(qqq5) * 4 +
    vixSignal * 0.8 +
    realizedVolSignal * 0.6 +
    breadthSignal,
    0.3,
    0.95,
  );

  return {
    regimeId,
    regimeConfidence: Number(confidenceBase.toFixed(3)),
    volState,
    ratesState,
    breadthState,
    sectorLeadershipState,
    recommendedGrossExposure: Number((policy.exposure[regimeId] ?? 0.75).toFixed(3)),
    vixLevel: vixClose != null ? vixClose.toFixed(2) : '',
    realizedVol20d: realizedVol20d.toFixed(3),
    rspSpyRelative20d: rspSpyRelative20d != null ? rspSpyRelative20d.toFixed(3) : '',
    sectorPositiveRatio20d: sectorPositiveRatio20d != null ? sectorPositiveRatio20d.toFixed(3) : '',
    topSectorLeaders20d,
    topSectorLaggards20d,
    whyThisRegime,
  };
}

export async function run() {
  const tradingDir = path.join(root, 'trading');
  const profile = await readJson(path.join(tradingDir, 'config', 'profile.json'));
  const marketContextPath = path.join(tradingDir, 'data', 'alt', 'daily_market_context.csv');
  const benchmarkPath = path.join(tradingDir, 'data', 'alt', 'benchmark_returns.csv');

  let rows = [];
  let sortKey = 'market_date';
  let label = 'daily_market_context.csv';

  try {
    const raw = await fs.readFile(marketContextPath, 'utf8');
    rows = parseCsv(raw);
    requireColumns(rows, ['market_date', 'spy_return_5d', 'qqq_return_5d', 'spy_return_20d', 'qqq_return_20d'], label);
  } catch {
    const raw = await fs.readFile(benchmarkPath, 'utf8');
    rows = parseCsv(raw);
    sortKey = 'report_date';
    label = 'benchmark_returns.csv';
    requireColumns(rows, ['report_date', 'spy_return_5d', 'qqq_return_5d', 'spy_return_20d', 'qqq_return_20d'], label);
  }

  const sorted = [...rows].sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])));
  const last = sorted[sorted.length - 1];
  const policy = await loadPolicy(tradingDir);
  const regime = chooseRegime(last, policy);
  const sourceMarketDate = String(last[sortKey] || '');

  const output = [{
    as_of_date: todayDate(profile?.timezone || 'America/New_York'),
    source_market_date: sourceMarketDate,
    regime_id: regime.regimeId,
    regime_confidence: regime.regimeConfidence,
    vol_state: regime.volState,
    rates_state: regime.ratesState,
    breadth_state: regime.breadthState,
    sector_leadership_state: regime.sectorLeadershipState,
    recommended_gross_exposure: regime.recommendedGrossExposure,
    vix_level: regime.vixLevel,
    realized_vol_20d: regime.realizedVol20d,
    rsp_spy_relative_20d: regime.rspSpyRelative20d,
    sector_positive_ratio_20d: regime.sectorPositiveRatio20d,
    top_sector_leaders_20d: regime.topSectorLeaders20d,
    top_sector_laggards_20d: regime.topSectorLaggards20d,
    why_this_regime: regime.whyThisRegime,
  }];

  const outDir = path.join(tradingDir, 'data', 'regime');
  await ensureDir(outDir);

  const outFile = path.join(outDir, 'latest_regime.csv');
  await fs.writeFile(outFile, toCsv(output, [
    'as_of_date',
    'source_market_date',
    'regime_id',
    'regime_confidence',
    'vol_state',
    'rates_state',
    'breadth_state',
    'sector_leadership_state',
    'recommended_gross_exposure',
    'vix_level',
    'realized_vol_20d',
    'rsp_spy_relative_20d',
    'sector_positive_ratio_20d',
    'top_sector_leaders_20d',
    'top_sector_laggards_20d',
    'why_this_regime',
  ]), 'utf8');

  console.log(`Wrote: ${outFile}`);
  console.log(`Regime source: ${label}`);
  console.log(`Regime: ${regime.regimeId} (conf ${regime.regimeConfidence})`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
