#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { asNum, ensureDir, latestFile, parseCsv, readCsv, readJson, toCsv } from '../scripts/lib.mjs';
import { clamp, requireColumns, truthyBool } from '../pipeline/validate_data_contracts.mjs';
import { normalizeSector, normalizeSubIndustry } from '../scripts/sector_utils.mjs';

const root = process.cwd();

const DEFAULT_CONSTRAINTS = {
  max_positions: 5,
  max_single_name_weight: 0.12,
  max_sector_weight: 0.35,
  max_beta_exposure: 1.15,
  min_cash_buffer: 0.2,
  max_turnover_per_day: 0.35,
  sector_map: {},
};

const DEFAULT_REGIME_MULTIPLIERS = {
  risk_off: 0.85,
  high_vol: 0.75,
  risk_on: 1.0,
  trend_growth: 1.1,
};

const DEFAULT_FACTOR_TILTS = {
  risk_off: {
    quality: 1.2,
    growth: 0.8,
    alt_momentum: 0.75,
    peer_relative: 0.95,
    value: 1.15,
  },
  high_vol: {
    quality: 1.1,
    growth: 0.85,
    alt_momentum: 0.7,
    peer_relative: 0.9,
    value: 1.05,
  },
  risk_on: {
    quality: 1.0,
    growth: 1.0,
    alt_momentum: 1.0,
    peer_relative: 1.0,
    value: 1.0,
  },
  trend_growth: {
    quality: 0.95,
    growth: 1.2,
    alt_momentum: 1.15,
    peer_relative: 1.05,
    value: 0.9,
  },
};

const DEFAULT_LEADERSHIP_FACTOR_TILTS = {
  growth_led: {
    quality: 0.96,
    growth: 1.12,
    alt_momentum: 1.08,
    peer_relative: 1.05,
    value: 0.94,
  },
  defensive_led: {
    quality: 1.12,
    growth: 0.92,
    alt_momentum: 0.9,
    peer_relative: 0.97,
    value: 1.08,
  },
  cyclical_led: {
    quality: 1.02,
    growth: 1.04,
    alt_momentum: 1.02,
    peer_relative: 1.06,
    value: 0.98,
  },
  mixed_sector_leadership: {
    quality: 1.02,
    growth: 1.0,
    alt_momentum: 0.98,
    peer_relative: 1.0,
    value: 1.0,
  },
  unknown: {
    quality: 1.0,
    growth: 1.0,
    alt_momentum: 1.0,
    peer_relative: 1.0,
    value: 1.0,
  },
};

const DEFAULT_SECTOR_ALIGNMENT = {
  leader_bonus: 1.08,
  laggard_penalty: 0.92,
  neutral: 1.0,
};

async function loadConstraints(tradingDir) {
  try {
    const cfg = await readJson(path.join(tradingDir, 'config', 'portfolio_constraints.json'));
    return {
      ...DEFAULT_CONSTRAINTS,
      ...cfg,
      sector_map: { ...DEFAULT_CONSTRAINTS.sector_map, ...(cfg?.sector_map || {}) },
    };
  } catch {
    return DEFAULT_CONSTRAINTS;
  }
}

async function loadRegimeMultipliers(tradingDir) {
  try {
    const cfg = await readJson(path.join(tradingDir, 'config', 'regime_policy.json'));
    return { ...DEFAULT_REGIME_MULTIPLIERS, ...(cfg?.regime_multipliers || {}) };
  } catch {
    return DEFAULT_REGIME_MULTIPLIERS;
  }
}

async function loadFactorTilts(tradingDir) {
  try {
    const cfg = await readJson(path.join(tradingDir, 'config', 'regime_policy.json'));
    const merged = { ...DEFAULT_FACTOR_TILTS };
    for (const key of Object.keys(DEFAULT_FACTOR_TILTS)) {
      merged[key] = { ...DEFAULT_FACTOR_TILTS[key], ...(cfg?.factor_tilts?.[key] || {}) };
    }
    return merged;
  } catch {
    return DEFAULT_FACTOR_TILTS;
  }
}

async function loadLeadershipConfig(tradingDir) {
  try {
    const cfg = await readJson(path.join(tradingDir, 'config', 'regime_policy.json'));
    const tilts = { ...DEFAULT_LEADERSHIP_FACTOR_TILTS };
    for (const key of Object.keys(DEFAULT_LEADERSHIP_FACTOR_TILTS)) {
      tilts[key] = { ...DEFAULT_LEADERSHIP_FACTOR_TILTS[key], ...(cfg?.sector_leadership_factor_tilts?.[key] || {}) };
    }
    return {
      tilts,
      alignment: { ...DEFAULT_SECTOR_ALIGNMENT, ...(cfg?.sector_alignment || {}) },
    };
  } catch {
    return {
      tilts: DEFAULT_LEADERSHIP_FACTOR_TILTS,
      alignment: DEFAULT_SECTOR_ALIGNMENT,
    };
  }
}

function regimeAdjustedScore(row, tilt) {
  const quality = asNum(row.quality_score) ?? 0;
  const growth = asNum(row.growth_score) ?? 0;
  const altMomentum = asNum(row.alt_momentum_score) ?? 0;
  const peerRelative = asNum(row.peer_relative_score) ?? 0;
  const value = asNum(row.value_score) ?? 0;

  return (
    quality * Number(tilt.quality ?? 1) +
    growth * Number(tilt.growth ?? 1) +
    altMomentum * Number(tilt.alt_momentum ?? 1) +
    peerRelative * Number(tilt.peer_relative ?? 1) +
    value * Number(tilt.value ?? 1)
  ) / 5;
}

function combineTilts(baseTilt, leadershipTilt) {
  return {
    quality: Number(baseTilt.quality ?? 1) * Number(leadershipTilt.quality ?? 1),
    growth: Number(baseTilt.growth ?? 1) * Number(leadershipTilt.growth ?? 1),
    alt_momentum: Number(baseTilt.alt_momentum ?? 1) * Number(leadershipTilt.alt_momentum ?? 1),
    peer_relative: Number(baseTilt.peer_relative ?? 1) * Number(leadershipTilt.peer_relative ?? 1),
    value: Number(baseTilt.value ?? 1) * Number(leadershipTilt.value ?? 1),
  };
}

function parseSectorList(text) {
  return new Set(
    String(text || '')
      .split('|')
      .map((entry) => entry.split(':')[0]?.trim())
      .filter(Boolean)
  );
}

export async function run() {
  const tradingDir = path.join(root, 'trading');
  const ranks = await readCsv(path.join(tradingDir, 'data', 'ranks', 'latest_ranks.csv'));
  const quality = await readCsv(path.join(tradingDir, 'data', 'quality', 'latest_signal_quality.csv'));
  const regimeRows = await readCsv(path.join(tradingDir, 'data', 'regime', 'latest_regime.csv'));
  const latestBucketPath = await latestFile(path.join(tradingDir, 'buckets'), /-growth-bucket\.csv$/);
  const bucketRows = latestBucketPath ? parseCsv(await fs.readFile(latestBucketPath, 'utf8')) : [];

  requireColumns(ranks, ['ticker', 'as_of_date', 'final_alpha_score', 'confidence', 'risk_penalty', 'liquidity_penalty', 'eligible', 'quality_score', 'growth_score', 'alt_momentum_score', 'peer_relative_score', 'value_score'], 'latest_ranks.csv');
  requireColumns(quality, ['ticker', 'effective_confidence'], 'latest_signal_quality.csv');
  if (regimeRows.length > 0) {
    requireColumns(regimeRows, ['regime_id', 'recommended_gross_exposure'], 'latest_regime.csv');
  } else {
    console.warn('[portfolio] latest_regime.csv empty or missing — using safe defaults (risk_on, 0.75 gross).');
  }

  const constraints = await loadConstraints(tradingDir);
  const multipliers = await loadRegimeMultipliers(tradingDir);
  const factorTilts = await loadFactorTilts(tradingDir);
  const leadershipConfig = await loadLeadershipConfig(tradingDir);

  const qualityMap = new Map(quality.map((r) => [String(r.ticker || '').toUpperCase(), r]));
  const bucketMap = new Map(bucketRows.map((r) => [String(r.symbol || '').toUpperCase(), r]));

  const regimeRow = regimeRows.length > 0 ? regimeRows[0] : {
    regime_id: 'risk_on',
    recommended_gross_exposure: 0.75,
    sector_leadership_state: 'unknown',
    top_sector_leaders_20d: '',
    top_sector_laggards_20d: '',
  };
  const regimeId = String(regimeRow.regime_id || 'risk_on');
  const sectorLeadershipState = String(regimeRow.sector_leadership_state || 'unknown');
  const regimeMultiplier = Number(multipliers[regimeId] ?? 1);
  const activeTilt = factorTilts[regimeId] || DEFAULT_FACTOR_TILTS.risk_on;
  const activeLeadershipTilt = leadershipConfig.tilts[sectorLeadershipState] || DEFAULT_LEADERSHIP_FACTOR_TILTS.unknown;
  const combinedTilt = combineTilts(activeTilt, activeLeadershipTilt);
  const leaderSectors = parseSectorList(regimeRow.top_sector_leaders_20d);
  const laggardSectors = parseSectorList(regimeRow.top_sector_laggards_20d);
  const recommendedGross = clamp(asNum(regimeRow.recommended_gross_exposure) ?? 0.75, 0.2, 1);
  const investableWeight = clamp((1 - Number(constraints.min_cash_buffer)) * recommendedGross, 0.1, 0.95);

  const pool = ranks
    .filter((r) => truthyBool(r.eligible))
    .map((r) => {
      const ticker = String(r.ticker || '').toUpperCase();
      const q = qualityMap.get(ticker) || {};
      const bucketRow = bucketMap.get(ticker) || {};
      const effectiveConfidence = clamp(asNum(q.effective_confidence) ?? asNum(r.confidence) ?? 0.5, 0, 1);
      const finalAlpha = asNum(r.final_alpha_score) ?? 0;
      const sectorBucket = normalizeSector(ticker, bucketRow.name || bucketRow.company || '', constraints.sector_map);
      const subIndustry = normalizeSubIndustry(ticker, bucketRow.name || bucketRow.company || '', constraints.sector_map);
      const regimeTiltScore = regimeAdjustedScore(r, combinedTilt);
      const sectorAlignmentMultiplier = leaderSectors.has(sectorBucket)
        ? Number(leadershipConfig.alignment.leader_bonus)
        : laggardSectors.has(sectorBucket)
          ? Number(leadershipConfig.alignment.laggard_penalty)
          : Number(leadershipConfig.alignment.neutral);
      const executionPenalty = (asNum(r.liquidity_penalty) ?? 0) + ((asNum(r.risk_penalty) ?? 0) * 0.25);
      const riskAdjusted = ((((finalAlpha * 0.6) + (regimeTiltScore * 0.4)) * sectorAlignmentMultiplier) * effectiveConfidence * regimeMultiplier) - executionPenalty;

      return {
        ticker,
        as_of_date: r.as_of_date,
        final_alpha_score: finalAlpha,
        regime_tilt_score: regimeTiltScore,
        sector_alignment_multiplier: sectorAlignmentMultiplier,
        risk_adjusted_score: riskAdjusted,
        confidence: asNum(r.confidence) ?? 0,
        effective_confidence: effectiveConfidence,
        risk_penalty: asNum(r.risk_penalty) ?? 0,
        liquidity_penalty: asNum(r.liquidity_penalty) ?? 0,
        sector_bucket: sectorBucket,
        sub_industry: subIndustry,
      };
    })
    .filter((r) => r.risk_adjusted_score > 0)
    .sort((a, b) => b.risk_adjusted_score - a.risk_adjusted_score)
    .slice(0, Number(constraints.max_positions));

  const totalScore = pool.reduce((a, b) => a + b.risk_adjusted_score, 0);
  const sectorSums = new Map();

  const rows = pool.map((row) => {
    const unconstrained = totalScore > 0 ? (row.risk_adjusted_score / totalScore) * investableWeight : 0;
    const currentSector = sectorSums.get(row.sector_bucket) || 0;
    const sectorRoom = Math.max(0, Number(constraints.max_sector_weight) - currentSector);

    const maxAllowed = Math.min(Number(constraints.max_single_name_weight), sectorRoom);
    const targetWeight = clamp(unconstrained, 0, maxAllowed);

    sectorSums.set(row.sector_bucket, currentSector + targetWeight);

    const flags = [];
    if (targetWeight < unconstrained) flags.push('CAPPED');
    if (sectorRoom <= 0) flags.push('SECTOR_LIMIT');

    return {
      ticker: row.ticker,
      as_of_date: row.as_of_date,
      final_alpha_score: Number(row.final_alpha_score.toFixed(4)),
      regime_tilt_score: Number(row.regime_tilt_score.toFixed(4)),
      sector_alignment_multiplier: Number(row.sector_alignment_multiplier.toFixed(3)),
      risk_adjusted_score: Number(row.risk_adjusted_score.toFixed(4)),
      target_weight: Number(targetWeight.toFixed(4)),
      max_weight_allowed: Number(maxAllowed.toFixed(4)),
      sector_bucket: row.sector_bucket,
      sub_industry: row.sub_industry,
      constraint_flags: flags.join(';'),
      effective_confidence: Number(row.effective_confidence.toFixed(4)),
      risk_penalty: Number(row.risk_penalty.toFixed(4)),
      liquidity_penalty: Number(row.liquidity_penalty.toFixed(4)),
    };
  });

  const outDir = path.join(tradingDir, 'data', 'portfolio');
  await ensureDir(outDir);
  const outFile = path.join(outDir, 'latest_target_weights.csv');

  await fs.writeFile(outFile, toCsv(rows, [
    'ticker',
    'as_of_date',
    'final_alpha_score',
    'regime_tilt_score',
    'sector_alignment_multiplier',
    'risk_adjusted_score',
    'target_weight',
    'max_weight_allowed',
    'sector_bucket',
    'sub_industry',
    'constraint_flags',
    'effective_confidence',
    'risk_penalty',
    'liquidity_penalty',
  ]), 'utf8');

  console.log(`Wrote: ${outFile}`);
  console.log(`Constructed weights for ${rows.length} tickers (regime=${regimeId}).`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
