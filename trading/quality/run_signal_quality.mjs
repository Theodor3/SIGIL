#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { asNum, ensureDir, readCsv, toCsv, todayDate } from '../scripts/lib.mjs';
import { clamp, requireColumns } from '../pipeline/validate_data_contracts.mjs';

const root = process.cwd();

function daysBetweenUtc(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf())) return 0;
  return Math.round((to - from) / 86400000);
}

function weightedMean(values) {
  const clean = values.filter((entry) => entry.value != null && entry.weight != null && entry.weight > 0);
  if (!clean.length) return null;
  const totalWeight = clean.reduce((sum, entry) => sum + entry.weight, 0);
  return totalWeight > 0
    ? clean.reduce((sum, entry) => sum + (entry.value * entry.weight), 0) / totalWeight
    : null;
}

function activeFactorEntries(row) {
  const mix = String(row.nowcast_source_mix || 'none').toLowerCase();
  const entries = [
    { value: asNum(row.quality_score), weight: Math.max(0.15, asNum(row.fundamental_confidence) ?? 0.5) },
    { value: asNum(row.growth_score), weight: Math.max(0.15, asNum(row.fundamental_confidence) ?? 0.5) },
    { value: asNum(row.value_score), weight: Math.max(0.10, asNum(row.value_confidence) ?? 0.5) },
  ];

  const altConfidence = asNum(row.alt_confidence) ?? 0;
  const peerConfidence = asNum(row.peer_confidence) ?? 0;
  const proxyConfidence = asNum(row.proxy_confidence) ?? 0;

  if ((mix === 'direct' || mix === 'hybrid') && altConfidence > 0.05) {
    entries.push({ value: asNum(row.alt_momentum_score), weight: altConfidence });
  }
  if ((mix === 'direct' || mix === 'hybrid') && peerConfidence > 0.05) {
    entries.push({ value: asNum(row.peer_relative_score), weight: peerConfidence });
  }
  if ((mix === 'proxy_only' || mix === 'hybrid') && proxyConfidence > 0.05) {
    entries.push({ value: asNum(row.proxy_inferred_score), weight: proxyConfidence });
  }

  return entries.filter((entry) => entry.value != null);
}

function agreementScore(row) {
  const entries = activeFactorEntries(row);
  if (entries.length < 2) return 55;

  const mean = weightedMean(entries);
  if (mean == null) return 55;

  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return 55;

  const variance = entries.reduce((sum, entry) => sum + (entry.weight * ((entry.value - mean) ** 2)), 0) / totalWeight;
  const std = Math.sqrt(variance);
  return clamp((1 - std / 0.38) * 100, 0, 100);
}

function coverageScore(row) {
  const fundamentalPresence = [
    'revenue_cagr_3y',
    'fcf_cagr_3y',
    'roic',
    'fcf_margin',
    'asset_turnover',
    'debt_to_ebitda',
  ].filter((k) => {
    const v = row[k];
    return v != null && String(v).trim() !== '';
  }).length / 6;

  const factorPresence = [
    'value_score',
    'quality_score',
    'growth_score',
    'alt_momentum_score',
    'peer_relative_score',
    'proxy_inferred_score',
  ].filter((k) => {
    const v = row[k];
    return v != null && String(v).trim() !== '';
  }).length / 6;

  const componentPresence = [
    'fundamental_confidence',
    'value_confidence',
    'alt_confidence',
    'peer_confidence',
    'proxy_confidence',
  ].filter((k) => {
    const v = row[k];
    return v != null && String(v).trim() !== '';
  }).length / 5;

  const mix = String(row.nowcast_source_mix || 'none').toLowerCase();
  const directCount = asNum(row.nowcast_direct_source_count) ?? 0;
  const proxyCount = asNum(row.nowcast_proxy_source_count) ?? 0;

  let altCoverage = 0;
  if (mix === 'direct') altCoverage = clamp(0.75 + 0.125 * Math.min(directCount, 2), 0, 1);
  else if (mix === 'hybrid') altCoverage = clamp(0.60 + 0.10 * Math.min(directCount, 2) + 0.05 * Math.min(proxyCount, 2), 0, 1);
  else if (mix === 'proxy_only') altCoverage = clamp(0.22 + 0.12 * Math.min(proxyCount, 2), 0, 0.5);
  else altCoverage = 0.08;

  return (
    0.42 * fundamentalPresence +
    0.18 * factorPresence +
    0.14 * componentPresence +
    0.26 * altCoverage
  ) * 100;
}

function sourceIntegrityScore(row) {
  const mix = String(row.nowcast_source_mix || 'none').toLowerCase();
  const directCount = asNum(row.nowcast_direct_source_count) ?? 0;
  const proxyCount = asNum(row.nowcast_proxy_source_count) ?? 0;

  if (mix === 'direct') return clamp(88 + (directCount * 6), 88, 100);
  if (mix === 'hybrid') return clamp(72 + (directCount * 8) + Math.min(proxyCount, 2) * 2, 72, 92);
  if (mix === 'proxy_only') return clamp(38 + Math.min(proxyCount, 2) * 6, 38, 50);
  return 24;
}

function freshnessScore(row, today) {
  const asOf = row.as_of_date || today;
  const staleDays = Math.max(0, daysBetweenUtc(asOf, today));
  const dateFreshness = clamp(100 - staleDays * 8, 0, 100);

  const mix = String(row.nowcast_source_mix || 'none').toLowerCase();
  const evidenceFreshness = mix === 'direct'
    ? 100
    : mix === 'hybrid'
      ? 94
      : mix === 'proxy_only'
        ? 78
        : 62;

  const daysToEarnings = asNum(row.days_to_earnings);
  let eventFreshness = 78;
  if (daysToEarnings != null) {
    if (daysToEarnings >= -7 && daysToEarnings <= 45) eventFreshness = 100;
    else if (daysToEarnings >= -30 && daysToEarnings <= 75) eventFreshness = 92;
    else if (daysToEarnings > 75 || daysToEarnings < -30) eventFreshness = 82;
  }

  return Number((0.55 * dateFreshness + 0.25 * evidenceFreshness + 0.20 * eventFreshness).toFixed(2));
}

export async function run() {
  const tradingDir = path.join(root, 'trading');
  const features = await readCsv(path.join(tradingDir, 'data', 'features', 'latest_features.csv'));
  const regimeRows = await readCsv(path.join(tradingDir, 'data', 'regime', 'latest_regime.csv'));

  requireColumns(features, ['ticker', 'as_of_date', 'confidence', 'value_score', 'quality_score', 'growth_score', 'alt_momentum_score', 'peer_relative_score', 'proxy_inferred_score', 'fundamental_confidence', 'value_confidence', 'alt_confidence', 'peer_confidence', 'proxy_confidence'], 'latest_features.csv');
  requireColumns(regimeRows, ['regime_id'], 'latest_regime.csv');

  const regimeId = String(regimeRows[0].regime_id || 'risk_on');
  const regimeStress = regimeId === 'risk_off' ? 0.2 : regimeId === 'high_vol' ? 0.3 : 0;
  const today = todayDate('America/New_York');

  const rows = features.map((row) => {
    const asOf = row.as_of_date || today;
    const cov = coverageScore(row);
    const staleScore = freshnessScore(row, today);
    const agree = agreementScore(row);
    const sourceIntegrity = sourceIntegrityScore(row);

    const qualityBlend = 0.34 * cov + 0.18 * staleScore + 0.16 * agree + 0.32 * sourceIntegrity;
    const qualityPenalty = clamp(1 - qualityBlend / 100, 0, 1);

    const baseConfidence = asNum(row.confidence) ?? 0.5;
    const confidenceBlend = (
      0.35 * (asNum(row.fundamental_confidence) ?? baseConfidence) +
      0.15 * (asNum(row.value_confidence) ?? baseConfidence) +
      0.20 * (asNum(row.alt_confidence) ?? 0) +
      0.15 * (asNum(row.peer_confidence) ?? 0) +
      0.15 * (asNum(row.proxy_confidence) ?? 0)
    );
    const effectiveConfidence = clamp(confidenceBlend * (1 - qualityPenalty) * (1 - regimeStress), 0, 1);

    return {
      ticker: String(row.ticker || '').toUpperCase(),
      as_of_date: asOf,
      coverage_score: Number(cov.toFixed(2)),
      staleness_score: Number(staleScore.toFixed(2)),
      cross_source_agreement: Number(agree.toFixed(2)),
      source_integrity_score: Number(sourceIntegrity.toFixed(2)),
      quality_penalty: Number(qualityPenalty.toFixed(4)),
      effective_confidence: Number(effectiveConfidence.toFixed(4)),
    };
  });

  const outDir = path.join(tradingDir, 'data', 'quality');
  await ensureDir(outDir);
  const outFile = path.join(outDir, 'latest_signal_quality.csv');
  await fs.writeFile(outFile, toCsv(rows, [
    'ticker',
    'as_of_date',
    'coverage_score',
    'staleness_score',
    'cross_source_agreement',
    'source_integrity_score',
    'quality_penalty',
    'effective_confidence',
  ]), 'utf8');

  console.log(`Wrote: ${outFile}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
