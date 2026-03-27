import fs from 'node:fs/promises';
import path from 'node:path';
import { asNum, ensureDir, readCsv, readJson, toCsv, todayDate } from './lib.mjs';

const root = process.cwd();
const tradingDir = path.join(root, 'trading');

function isEligible(row) {
  return String(row.eligible || '').toLowerCase() !== 'false';
}

function normalizedMix(row) {
  return String(row.nowcast_source_mix || row.source_mix || '').trim().toLowerCase() || 'none';
}

function variantDefinition(mode) {
  if (mode === 'direct_only') {
    return {
      mode,
      label: 'Direct Only',
      coverage: (row) => ['direct', 'hybrid'].includes(normalizedMix(row)),
      score: (row, weights) =>
        ((weights.quality ?? 0) * (asNum(row.quality_score) ?? 0)) +
        ((weights.growth ?? 0) * (asNum(row.growth_score) ?? 0)) +
        ((weights.value ?? 0) * (asNum(row.value_score) ?? 0)) +
        ((weights.alt_momentum ?? 0) * (asNum(row.alt_momentum_score) ?? 0)) +
        ((weights.peer_relative ?? 0) * (asNum(row.peer_relative_score) ?? 0)) -
        (asNum(row.risk_penalty) ?? 0) -
        (asNum(row.liquidity_penalty) ?? 0),
    };
  }

  if (mode === 'proxy_only') {
    return {
      mode,
      label: 'Proxy Only',
      coverage: (row) => ['proxy_only', 'hybrid'].includes(normalizedMix(row)),
      score: (row, weights) =>
        ((weights.quality ?? 0) * (asNum(row.quality_score) ?? 0)) +
        ((weights.growth ?? 0) * (asNum(row.growth_score) ?? 0)) +
        ((weights.value ?? 0) * (asNum(row.value_score) ?? 0)) +
        ((weights.proxy_inferred ?? 0) * (asNum(row.proxy_inferred_score) ?? 0)) -
        (asNum(row.risk_penalty) ?? 0) -
        (asNum(row.liquidity_penalty) ?? 0),
    };
  }

  return {
    mode: 'hybrid',
    label: 'Hybrid',
    coverage: (row) => normalizedMix(row) === 'hybrid',
    score: (row, weights) =>
      ((weights.quality ?? 0) * (asNum(row.quality_score) ?? 0)) +
      ((weights.growth ?? 0) * (asNum(row.growth_score) ?? 0)) +
      ((weights.value ?? 0) * (asNum(row.value_score) ?? 0)) +
      ((weights.alt_momentum ?? 0) * (asNum(row.alt_momentum_score) ?? 0)) +
      ((weights.peer_relative ?? 0) * (asNum(row.peer_relative_score) ?? 0)) +
      ((weights.proxy_inferred ?? 0) * (asNum(row.proxy_inferred_score) ?? 0)) -
      (asNum(row.risk_penalty) ?? 0) -
      (asNum(row.liquidity_penalty) ?? 0),
  };
}

function summarizeVariant(rows, label, mode) {
  const covered = rows.filter((row) => row.coverage_ok);
  const eligible = covered.filter((row) => row.eligible);
  const avgScore = eligible.length
    ? eligible.reduce((acc, row) => acc + (row.variant_score ?? 0), 0) / eligible.length
    : null;
  const avgConfidence = eligible.length
    ? eligible.reduce((acc, row) => acc + (row.confidence ?? 0), 0) / eligible.length
    : null;
  const avgAlpha20 = eligible.length
    ? eligible.reduce((acc, row) => acc + (row.expected_alpha_20d ?? 0), 0) / eligible.length
    : null;
  const top = eligible.slice(0, 10);

  return {
    mode,
    label,
    coverage_count: covered.length,
    eligible_count: eligible.length,
    avg_variant_score: avgScore == null ? null : Number(avgScore.toFixed(4)),
    avg_confidence: avgConfidence == null ? null : Number(avgConfidence.toFixed(4)),
    avg_expected_alpha_20d: avgAlpha20 == null ? null : Number(avgAlpha20.toFixed(2)),
    top_symbols: top.slice(0, 5).map((row) => row.ticker),
    rows: top.map((row, index) => ({
      rank: index + 1,
      ticker: row.ticker,
      source_mix: row.source_mix,
      variant_score: Number((row.variant_score ?? 0).toFixed(4)),
      baseline_score: row.baseline_score == null ? null : Number(row.baseline_score.toFixed(4)),
      score_delta_vs_baseline: row.score_delta_vs_baseline == null ? null : Number(row.score_delta_vs_baseline.toFixed(4)),
      confidence: row.confidence == null ? null : Number(row.confidence.toFixed(4)),
      expected_alpha_20d: row.expected_alpha_20d == null ? null : Number(row.expected_alpha_20d.toFixed(2)),
    })),
  };
}

export function buildNowcastAblation({ featuresRows, ranksRows, weights, asOfDate }) {
  const rankByTicker = new Map(
    (ranksRows || []).map((row) => [String(row.ticker || '').toUpperCase(), row]).filter(([ticker]) => ticker)
  );

  const baseRows = (featuresRows || []).map((row) => {
    const ticker = String(row.ticker || '').toUpperCase();
    const rank = rankByTicker.get(ticker) || {};
    return {
      ticker,
      source_mix: normalizedMix(row),
      quality_score: asNum(row.quality_score),
      growth_score: asNum(row.growth_score),
      value_score: asNum(row.value_score),
      alt_momentum_score: asNum(row.alt_momentum_score),
      peer_relative_score: asNum(row.peer_relative_score),
      proxy_inferred_score: asNum(row.proxy_inferred_score),
      risk_penalty: asNum(row.risk_penalty),
      liquidity_penalty: asNum(row.liquidity_penalty),
      baseline_score: asNum(rank.final_alpha_score) ?? asNum(row.final_alpha_score),
      confidence: asNum(rank.confidence) ?? asNum(row.confidence),
      expected_alpha_20d: asNum(row.expected_alpha_20d),
      eligible: isEligible(rank.ticker ? rank : row),
    };
  }).filter((row) => row.ticker);

  const variants = ['direct_only', 'proxy_only', 'hybrid'].map((mode) => {
    const definition = variantDefinition(mode);
    const rows = baseRows
      .map((row) => {
        const coverageOk = definition.coverage(row);
        const variantScore = definition.score(row, weights);
        return {
          ...row,
          coverage_ok: coverageOk,
          variant_score: variantScore,
          score_delta_vs_baseline: row.baseline_score == null ? null : variantScore - row.baseline_score,
        };
      })
      .filter((row) => row.coverage_ok)
      .sort((a, b) => {
        const scoreDiff = (b.variant_score ?? -Infinity) - (a.variant_score ?? -Infinity);
        if (scoreDiff !== 0) return scoreDiff;
        return String(a.ticker).localeCompare(String(b.ticker));
      });

    return summarizeVariant(rows, definition.label, mode);
  });

  const allRows = variants.flatMap((variant) => variant.rows.map((row) => ({
    mode: variant.mode,
    label: variant.label,
    ...row,
  })));

  const winner = variants
    .slice()
    .sort((a, b) => {
      const scoreDiff = (b.avg_variant_score ?? -Infinity) - (a.avg_variant_score ?? -Infinity);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.eligible_count ?? 0) - (a.eligible_count ?? 0);
    })[0] || null;

  return {
    as_of_date: asOfDate,
    weights,
    winner: winner ? {
      mode: winner.mode,
      label: winner.label,
      avg_variant_score: winner.avg_variant_score,
      eligible_count: winner.eligible_count,
      top_symbols: winner.top_symbols,
    } : null,
    variants,
    rows: allRows,
  };
}

export async function run() {
  const featuresPath = path.join(tradingDir, 'data', 'features', 'latest_features.csv');
  const ranksPath = path.join(tradingDir, 'data', 'ranks', 'latest_ranks.csv');
  const configPath = path.join(tradingDir, 'config', 'alpha_model.json');
  const outDir = path.join(tradingDir, 'data', 'alpha_lab');

  const [featuresRows, ranksRows, config] = await Promise.all([
    readCsv(featuresPath),
    readCsv(ranksPath),
    readJson(configPath),
  ]);

  const payload = buildNowcastAblation({
    featuresRows,
    ranksRows,
    weights: config?.weights || {},
    asOfDate: todayDate('America/New_York'),
  });

  await ensureDir(outDir);
  const jsonPath = path.join(outDir, 'latest_nowcast_ablation.json');
  const csvPath = path.join(outDir, 'latest_nowcast_ablation.csv');

  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  await fs.writeFile(csvPath, toCsv(payload.rows, [
    'mode',
    'label',
    'rank',
    'ticker',
    'source_mix',
    'variant_score',
    'baseline_score',
    'score_delta_vs_baseline',
    'confidence',
    'expected_alpha_20d',
  ]), 'utf8');

  console.log(`Wrote: ${jsonPath}`);
  console.log(`Wrote: ${csvPath}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
