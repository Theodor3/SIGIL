#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { asNum, ensureDir, latestFile, parseCsv, readJson, toCsv, todayDate } from '../scripts/lib.mjs';

const root = process.cwd();
const tradingDir = path.join(root, 'trading');

const DEFAULT_ALPHA_MODEL = {
  weights: {
    quality: 0.30,
    growth: 0.25,
    alt_momentum: 0.15,
    peer_relative: 0.12,
    value: 0.10,
    proxy_inferred: 0.08,
  },
  gates: {
    min_confidence: 0.58,
    max_debt_to_ebitda: 3.0,
    earnings_event_window_days: 10,
    weak_signal_confidence: 0.64,
  },
};

function clamp(v, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, v));
}

function mean(vals, fallback = null) {
  const clean = vals.filter((v) => v != null && Number.isFinite(v));
  if (!clean.length) return fallback;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function cappedPositive(v, cap = 1.5) {
  if (v == null || !Number.isFinite(v)) return null;
  return clamp(v, 0, cap);
}

function centeredProbability(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return clamp((v - 0.5) * 2, -1, 1);
}

function pctToDecimal(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.endsWith('%')) {
    const n = Number(s.replace('%', ''));
    return Number.isFinite(n) ? n / 100 : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function weightedMean(pairs, fallback = 0) {
  const clean = pairs.filter(([value, weight]) => value != null && Number.isFinite(value) && weight != null && Number.isFinite(weight) && weight > 0);
  if (!clean.length) return fallback;
  const weightSum = clean.reduce((sum, [, weight]) => sum + weight, 0);
  if (weightSum <= 0) return fallback;
  return clean.reduce((sum, [value, weight]) => sum + (value * weight), 0) / weightSum;
}

function structuralPenalty({ sector, industry, roic, fcfMargin, assetTurnover, debt }) {
  const sec = String(sector || '').toUpperCase();
  const ind = String(industry || '').toUpperCase();
  let penalty = 0;

  if (roic != null) {
    if (roic > 2.0) penalty += 0.28;
    else if (roic > 1.0) penalty += 0.16;
    else if (roic > 0.75) penalty += 0.08;
  }

  if (fcfMargin != null) {
    if (fcfMargin > 1.2) penalty += 0.28;
    else if (fcfMargin > 0.7) penalty += 0.16;
    else if (fcfMargin > 0.45) penalty += 0.06;
  }

  if (assetTurnover != null) {
    if (assetTurnover > 2.5) penalty += 0.12;
    else if (assetTurnover < 0.08) penalty += 0.10;
  }

  if (debt != null && debt < 0) penalty += 0.08;

  const isFinancial = sec.includes('FINANCIAL') || ind.includes('BANK') || ind.includes('CAPITAL MARKETS') || ind.includes('INSURANCE');
  if (isFinancial) {
    if (roic != null && roic > 0.5) penalty += 0.18;
    if (fcfMargin != null && fcfMargin > 0.5) penalty += 0.18;
    if (assetTurnover != null && assetTurnover < 0.1) penalty += 0.08;
  }

  return clamp(penalty, 0, 0.55);
}

function valuationContextStrength(context) {
  const value = String(context || '').toLowerCase();
  if (!value) return 0.35;
  if (value.startsWith('industry:')) return 1.0;
  if (value.startsWith('sector:')) return 0.78;
  if (value.startsWith('global')) return 0.5;
  return 0.55;
}

function valuationMethodStrength(method) {
  const value = String(method || '').toLowerCase();
  if (value === 'financial_multiples') return 0.82;
  if (value === 'enterprise_multiples') return 0.92;
  return 0.45;
}

function normalizeScores(rows, key) {
  const vals = rows
    .map((r) => {
      const raw = r[key];
      if (raw == null || raw === '') return null;
      return asNum(raw);
    })
    .filter((v) => v != null);
  if (!vals.length) {
    rows.forEach((r) => { r[`${key}_norm`] = 0.5; });
    return;
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (max === min) {
    rows.forEach((r) => { r[`${key}_norm`] = 0.5; });
    return;
  }
  rows.forEach((r) => {
    const raw = r[key];
    const v = raw == null || raw === '' ? null : asNum(raw);
    r[`${key}_norm`] = v == null ? 0.5 : clamp((v - min) / (max - min), 0, 1);
  });
}

function strongestDrivers(row) {
  const parts = [
    ['quality', row.quality_score],
    ['growth', row.growth_score],
    ['alt_momentum', row.alt_momentum_score],
    ['peer_relative', row.peer_relative_score],
    ['value', row.value_score],
    ['proxy_inferred', row.proxy_inferred_score],
  ];

  return parts
    .sort((a, b) => (asNum(b[1]) ?? 0) - (asNum(a[1]) ?? 0))
    .slice(0, 3)
    .map(([k, v]) => `${k}(${Number(v).toFixed(2)})`)
    .join('; ');
}

function daysBetweenUtc(fromDate, toDate) {
  if (!fromDate || !toDate) return null;
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf())) return null;
  return Math.round((to - from) / 86400000);
}

async function loadLatestCsvRows(dir, pattern) {
  const file = await latestFile(dir, pattern);
  if (!file) return { file: null, rows: [] };
  const text = await fs.readFile(file, 'utf8');
  return { file, rows: parseCsv(text) };
}

async function runModule(relPath) {
  const full = path.join(root, relPath);
  const mod = await import(`${pathToFileURL(full).href}?v=${Date.now()}-${Math.random()}`);
  if (typeof mod.run !== 'function') {
    throw new Error(`Module missing run(): ${relPath}`);
  }
  await mod.run();
}

async function loadAlphaModelConfig() {
  const cfgPath = path.join(tradingDir, 'config', 'alpha_model.json');
  try {
    const cfg = await readJson(cfgPath);
    return {
      ...DEFAULT_ALPHA_MODEL,
      ...cfg,
      weights: { ...DEFAULT_ALPHA_MODEL.weights, ...(cfg?.weights || {}) },
      gates: { ...DEFAULT_ALPHA_MODEL.gates, ...(cfg?.gates || {}) },
      source: cfgPath,
    };
  } catch {
    return {
      ...DEFAULT_ALPHA_MODEL,
      source: null,
    };
  }
}

export async function run() {
  const prior = process.env.TRADING_EMBEDDED;
  process.env.TRADING_EMBEDDED = '1';

  try {
    await runModule('scripts/run_growth_scan.mjs');
    await runModule('trading/providers/build_event_data.mjs');
    await runModule('trading/nowcast/build_direct_alt_sources.mjs');
    await runModule('trading/nowcast/build_market_proxy_sources.mjs');
    await runModule('trading/nowcast/run_alt_nowcast.mjs');
    await runModule('trading/scripts/run_risk_board.mjs');
    await runModule('trading/scripts/run_crypto_alerts.mjs');
    await runModule('trading/regime/run_daily_market_context.mjs');

    const profile = await readJson(path.join(tradingDir, 'config', 'profile.json'));
    const alphaModel = await loadAlphaModelConfig();
    const targetTopN = Number(profile?.investor_profile?.target_new_ideas_per_day ?? 5);
    const asOfDate = todayDate(profile?.timezone || 'America/New_York');

    const bucket = await loadLatestCsvRows(path.join(tradingDir, 'buckets'), /-growth-bucket\.csv$/);
    if (!bucket.rows.length) {
      throw new Error('No growth bucket rows available for alpha pipeline.');
    }

    const nowcast = await loadLatestCsvRows(path.join(tradingDir, 'output'), /-alt-nowcast-top20\.csv$/);
    const nowcastByTicker = new Map(
      nowcast.rows.map((r) => [
        (r.ticker || '').toUpperCase(),
        {
          confidence: asNum(r.confidence_score),
          kpiSurprise: pctToDecimal(r.expected_kpi_surprise),
          deviation: asNum(r.deviation_vs_consensus),
          probabilityOutperform: pctToDecimal(r.probability_post_earnings_outperform),
          sourceMix: String(r.source_mix || '').toLowerCase(),
          directSourceCount: asNum(r.direct_source_count),
          proxySourceCount: asNum(r.proxy_source_count),
          proxyShare: pctToDecimal(r.proxy_share),
          reaction: r.expected_stock_reaction || '',
          backtest: r.historical_backtest || '',
        },
      ])
    );

    let earningsCalendar = [];
    try {
      earningsCalendar = parseCsv(await fs.readFile(path.join(tradingDir, 'data', 'alt', 'earnings_calendar.csv'), 'utf8'));
    } catch {
      earningsCalendar = [];
    }
    const earningsByTicker = new Map(earningsCalendar.map((r) => [(r.ticker || '').toUpperCase(), r.report_date || '']));

    let cryptoAlertText = '';
    try {
      const latestCryptoAlerts = await latestFile(path.join(tradingDir, 'reports'), /-crypto-alerts\.md$/);
      if (latestCryptoAlerts) cryptoAlertText = await fs.readFile(latestCryptoAlerts, 'utf8');
    } catch {
      cryptoAlertText = '';
    }
    const alertHigh = Number((cryptoAlertText.match(/- HIGH alerts:\s*(\d+)/) || [])[1] || 0);
    const alertMedium = Number((cryptoAlertText.match(/- MEDIUM alerts:\s*(\d+)/) || [])[1] || 0);
    const marketStressPenalty = clamp(alertHigh * 0.03 + alertMedium * 0.015, 0, 0.2);

    const baseRows = bucket.rows.map((r) => {
      const ticker = (r.symbol || '').toUpperCase();
      const rev = asNum(r.revenue_cagr_3y);
      const fcf = asNum(r.fcf_cagr_3y);
      const roic = asNum(r.roic);
      const fcfMargin = asNum(r.fcf_margin);
      const debt = asNum(r.debt_to_ebitda);
      const assetTurnover = asNum(r.asset_turnover);
      const valuationScore = asNum(r.valuation_score);
      const valuationMethod = String(r.valuation_method || '');
      const valuationContext = String(r.valuation_context || '');
      const sector = String(r.sector || '');
      const industry = String(r.industry || '');

      const now = nowcastByTicker.get(ticker);
      const sourceMix = now?.sourceMix || 'none';
      const hasDirectAlt = sourceMix === 'direct' || sourceMix === 'hybrid';
      const hasProxySignal = sourceMix === 'proxy_only' || sourceMix === 'hybrid';
      const balanceSheetScore = debt == null ? null : clamp(1 / (1 + Math.max(0, debt)), 0, 1);
      const qualityRaw = mean([
        cappedPositive(roic, 1.0),
        cappedPositive(fcfMargin, 0.75),
        cappedPositive(assetTurnover, 1.5),
        balanceSheetScore,
      ], asNum(r.quality_score) ?? 0);
      const growthRaw = mean([
        cappedPositive(rev, 1.0),
        cappedPositive(fcf, 1.5),
      ], 0);
      const altRaw = hasDirectAlt
        ? mean([
          now?.kpiSurprise ?? null,
          centeredProbability(now?.probabilityOutperform),
        ], null)
        : null;
      const peerRaw = hasDirectAlt
        ? mean([
          now?.deviation ?? null,
          centeredProbability(now?.probabilityOutperform),
        ], null)
        : null;
      const proxyInferredRaw = hasProxySignal
        ? mean([
          now?.kpiSurprise ?? null,
          now?.deviation ?? null,
          centeredProbability(now?.probabilityOutperform),
        ], null)
        : null;
      const valueRaw = valuationScore ?? 0.5;

      const fundamentalCoverage = [rev, fcf, roic, fcfMargin, assetTurnover, debt].filter((v) => v != null).length / 6;
      const profitabilityCoverage = [roic, fcfMargin, assetTurnover].filter((v) => v != null).length / 3;
      const valueCoverage = [valuationScore].filter((v) => v != null).length;
      const directAltCoverage = Math.min((now?.directSourceCount ?? 0) / 3, 1);
      const proxyCoverage = Math.min((now?.proxySourceCount ?? 0) / 2, 1);
      const nowcastConfidence = now?.confidence ?? 0;
      const structuralAnomalyPenalty = structuralPenalty({
        sector,
        industry,
        roic,
        fcfMargin,
        assetTurnover,
        debt,
      });

      const fundamentalConfidence = clamp(
        (
          0.45 * fundamentalCoverage +
          0.20 * profitabilityCoverage +
          0.10 * (debt != null ? 1 : 0.5) +
          0.25 * (1 - structuralAnomalyPenalty)
        ) * (1 - structuralAnomalyPenalty * 0.65),
        0,
        1,
      );
      const contextStrength = valuationContextStrength(valuationContext);
      const methodStrength = valuationMethodStrength(valuationMethod);
      const valuationDataDepth = clamp(
        (valuationScore != null ? 0.6 : 0) +
        (valuationContext ? 0.2 : 0) +
        (valuationMethod ? 0.2 : 0),
        0,
        1,
      );
      const valueConfidence = clamp(
        (
          0.30 * (valueCoverage ? 1 : 0.35) +
          0.25 * contextStrength +
          0.20 * methodStrength +
          0.15 * valuationDataDepth +
          0.10 * fundamentalConfidence
        ),
        0,
        1,
      );
      const altConfidence = hasDirectAlt
        ? clamp(
          0.55 * directAltCoverage +
          0.45 * nowcastConfidence,
          0,
          1,
        )
        : 0;
      const peerConfidence = hasDirectAlt
        ? clamp(
          0.45 * directAltCoverage +
          0.35 * nowcastConfidence +
          0.20 * (now?.deviation != null ? 1 : 0.5),
          0,
          1,
        )
        : 0;
      const proxyConfidence = hasProxySignal
        ? clamp(
          (0.55 * proxyCoverage + 0.45 * nowcastConfidence) * (sourceMix === 'proxy_only' ? 0.82 : 0.92),
          0,
          1,
        )
        : 0;

      const riskPenalty = clamp(
        (debt != null && debt > 1.5 ? (debt - 1.5) * 0.1 : 0) +
        (fcfMargin != null && fcfMargin < 0.10 ? 0.08 : 0) +
        marketStressPenalty,
        0,
        0.35,
      );

      const confidence = clamp(weightedMean([
        [fundamentalConfidence, (alphaModel.weights.quality ?? 0) + (alphaModel.weights.growth ?? 0)],
        [valueConfidence, alphaModel.weights.value ?? 0],
        [altConfidence, alphaModel.weights.alt_momentum ?? 0],
        [peerConfidence, alphaModel.weights.peer_relative ?? 0],
        [proxyConfidence, alphaModel.weights.proxy_inferred ?? 0],
      ], 0.5), 0, 1);

      const nextEarningsDate = earningsByTicker.get(ticker) || '';
      const daysToEarnings = daysBetweenUtc(asOfDate, nextEarningsDate);

      return {
        as_of_date: asOfDate,
        ticker,
        quality_raw: qualityRaw,
        growth_raw: growthRaw,
        alt_raw: altRaw,
        peer_raw: peerRaw,
        proxy_inferred_raw: proxyInferredRaw,
        value_raw: valueRaw,
        risk_penalty: riskPenalty,
        liquidity_penalty: 0,
        confidence,
        fundamental_confidence: fundamentalConfidence,
        value_confidence: valueConfidence,
        alt_confidence: altConfidence,
        peer_confidence: peerConfidence,
        proxy_confidence: proxyConfidence,
        structural_anomaly_penalty: structuralAnomalyPenalty,
        valuation_context_strength: contextStrength,
        valuation_method_strength: methodStrength,
        nowcast_source_mix: sourceMix,
        nowcast_direct_source_count: now?.directSourceCount ?? null,
        nowcast_proxy_source_count: now?.proxySourceCount ?? null,
        nowcast_proxy_share: now?.proxyShare ?? null,
        revenue_cagr_3y: rev,
        fcf_cagr_3y: fcf,
        roic,
        fcf_margin: fcfMargin,
        asset_turnover: assetTurnover,
        debt_to_ebitda: debt,
        valuation_score_raw: valuationScore,
        expected_kpi_surprise: now?.kpiSurprise ?? null,
        probability_post_earnings_outperform: now?.probabilityOutperform ?? null,
        deviation_vs_consensus: now?.deviation ?? null,
        expected_stock_reaction: now?.reaction || '',
        historical_backtest: now?.backtest || 'No setup history in nowcast output',
        next_earnings_date: nextEarningsDate,
        days_to_earnings: daysToEarnings,
      };
    });

    normalizeScores(baseRows, 'quality_raw');
    normalizeScores(baseRows, 'growth_raw');
    normalizeScores(baseRows, 'alt_raw');
    normalizeScores(baseRows, 'peer_raw');
    normalizeScores(baseRows, 'proxy_inferred_raw');
    normalizeScores(baseRows, 'value_raw');

    const w = alphaModel.weights;
    const g = alphaModel.gates;

    for (const r of baseRows) {
      r.quality_score = r.quality_raw_norm;
      r.growth_score = r.growth_raw_norm;
      r.alt_momentum_score = r.alt_raw_norm;
      r.peer_relative_score = r.peer_raw_norm;
      r.proxy_inferred_score = r.proxy_inferred_raw_norm;
      r.value_score = r.value_raw_norm;

      if (r.nowcast_source_mix !== 'direct' && r.nowcast_source_mix !== 'hybrid') {
        r.alt_momentum_score = 0;
        r.peer_relative_score = 0;
      }
      if (r.nowcast_source_mix !== 'proxy_only' && r.nowcast_source_mix !== 'hybrid') {
        r.proxy_inferred_score = 0;
      }

      r.final_alpha_score =
        (w.quality * r.quality_score) +
        (w.growth * r.growth_score) +
        (w.alt_momentum * r.alt_momentum_score) +
        (w.peer_relative * r.peer_relative_score) +
        ((w.proxy_inferred ?? 0) * r.proxy_inferred_score) +
        (w.value * r.value_score) -
        (r.risk_penalty ?? 0) -
        (r.liquidity_penalty ?? 0);

      const gateConfidence = (r.confidence ?? 0) >= Number(g.min_confidence);
      const gateLeverage = r.debt_to_ebitda == null || r.debt_to_ebitda <= Number(g.max_debt_to_ebitda);
      const isNearEarnings = r.days_to_earnings != null && r.days_to_earnings >= 0 && r.days_to_earnings <= Number(g.earnings_event_window_days);
      const gateEventRisk = !(isNearEarnings && (r.confidence ?? 0) < Number(g.weak_signal_confidence));

      r.gate_confidence = gateConfidence;
      r.gate_leverage = gateLeverage;
      r.gate_event_risk = gateEventRisk;
      r.eligible = gateConfidence && gateLeverage && gateEventRisk;

      const reasons = [];
      if (!gateConfidence) reasons.push('LOW_CONFIDENCE');
      if (!gateLeverage) reasons.push('HIGH_LEVERAGE');
      if (!gateEventRisk) reasons.push('WEAK_PRE_EARNINGS');
      r.gate_reason = reasons.join(';');

      r.strongest_drivers = strongestDrivers(r);
    }

    const eligibleRows = baseRows.filter((r) => r.eligible);
    const rankingPool = eligibleRows.length ? eligibleRows : baseRows;
    rankingPool.sort((a, b) => b.final_alpha_score - a.final_alpha_score);
    const ranks = rankingPool.map((r, idx) => ({ rank: idx + 1, ...r }));

    await ensureDir(path.join(tradingDir, 'data', 'features'));
    await ensureDir(path.join(tradingDir, 'data', 'ranks'));

    const featuresPath = path.join(tradingDir, 'data', 'features', 'latest_features.csv');
    const ranksPath = path.join(tradingDir, 'data', 'ranks', 'latest_ranks.csv');

    const featureHeaders = [
      'as_of_date', 'ticker', 'value_score', 'quality_score', 'growth_score',
      'alt_momentum_score', 'peer_relative_score', 'proxy_inferred_score', 'risk_penalty', 'liquidity_penalty',
      'final_alpha_score', 'confidence', 'fundamental_confidence', 'value_confidence', 'alt_confidence', 'peer_confidence', 'proxy_confidence', 'structural_anomaly_penalty', 'valuation_context_strength', 'valuation_method_strength', 'strongest_drivers', 'revenue_cagr_3y',
      'fcf_cagr_3y', 'roic', 'fcf_margin', 'asset_turnover', 'debt_to_ebitda',
      'valuation_score_raw', 'nowcast_source_mix', 'nowcast_direct_source_count', 'nowcast_proxy_source_count', 'nowcast_proxy_share',
      'expected_kpi_surprise', 'probability_post_earnings_outperform', 'deviation_vs_consensus', 'expected_stock_reaction',
      'historical_backtest', 'next_earnings_date', 'days_to_earnings', 'gate_confidence',
      'gate_leverage', 'gate_event_risk', 'eligible', 'gate_reason',
    ];

    const rankHeaders = ['rank', ...featureHeaders];

    await fs.writeFile(featuresPath, toCsv(baseRows, featureHeaders), 'utf8');
    await fs.writeFile(ranksPath, toCsv(ranks, rankHeaders), 'utf8');

    await runModule('trading/regime/run_regime_model.mjs');
    await runModule('trading/quality/run_signal_quality.mjs');
    await runModule('trading/portfolio/run_portfolio_constructor.mjs');

    await runModule('trading/scripts/run_daily_top5.mjs');
    await runModule('trading/execution/run_execution_playbook.mjs');
    await runModule('trading/execution/run_execution_simulator.mjs');
    await runModule('trading/forward/run_forward_monitor.mjs');
    await runModule('trading/backtest/run_benchmark_returns.mjs');
    await runModule('trading/backtest/run_alpha_backtest.mjs');
    await runModule('trading/governance/run_governance_checks.mjs');
    await runModule('trading/governance/run_model_scorecard.mjs');
    await runModule('trading/dashboard/generate_dashboard_data.mjs');

    const preview = ranks.slice(0, targetTopN).map((r) => r.ticker).join(', ');
    console.log(`Wrote: ${featuresPath}`);
    console.log(`Wrote: ${ranksPath}`);
    console.log(`Eligible names: ${eligibleRows.length}/${baseRows.length}`);
    console.log(`Alpha top ${targetTopN}: ${preview}`);
    if (!alphaModel.source) console.log('Alpha model config: using defaults (trading/config/alpha_model.json not found).');
  } finally {
    if (prior == null) delete process.env.TRADING_EMBEDDED;
    else process.env.TRADING_EMBEDDED = prior;
  }
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
