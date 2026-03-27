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

function sleeveDefinitions(weights) {
  return [
    { id: 'quality', label: 'Quality', field: 'quality_score', weight: weights.quality ?? 0, coverage: () => true },
    { id: 'growth', label: 'Growth', field: 'growth_score', weight: weights.growth ?? 0, coverage: () => true },
    { id: 'value', label: 'Value', field: 'value_score', weight: weights.value ?? 0, coverage: () => true },
    {
      id: 'alt_momentum',
      label: 'Alt Momentum',
      field: 'alt_momentum_score',
      weight: weights.alt_momentum ?? 0,
      coverage: (row) => ['direct', 'hybrid'].includes(normalizedMix(row)),
    },
    {
      id: 'peer_relative',
      label: 'Peer Relative',
      field: 'peer_relative_score',
      weight: weights.peer_relative ?? 0,
      coverage: (row) => ['direct', 'hybrid'].includes(normalizedMix(row)),
    },
    {
      id: 'proxy_inferred',
      label: 'Proxy Inferred',
      field: 'proxy_inferred_score',
      weight: weights.proxy_inferred ?? 0,
      coverage: (row) => ['proxy_only', 'hybrid'].includes(normalizedMix(row)),
    },
  ];
}

function summarizeSleeve(definition, rows) {
  const covered = rows.filter((row) => row.coverage_ok);
  const eligible = covered.filter((row) => row.eligible);
  const avgSleeveScore = eligible.length
    ? eligible.reduce((acc, row) => acc + (row.sleeve_score ?? 0), 0) / eligible.length
    : null;
  const avgFactorScore = eligible.length
    ? eligible.reduce((acc, row) => acc + (row.factor_score ?? 0), 0) / eligible.length
    : null;
  const avgConfidence = eligible.length
    ? eligible.reduce((acc, row) => acc + (row.confidence ?? 0), 0) / eligible.length
    : null;
  const top = eligible.slice(0, 10);

  return {
    sleeve_id: definition.id,
    label: definition.label,
    weight: definition.weight,
    coverage_count: covered.length,
    eligible_count: eligible.length,
    avg_factor_score: avgFactorScore == null ? null : Number(avgFactorScore.toFixed(4)),
    avg_sleeve_score: avgSleeveScore == null ? null : Number(avgSleeveScore.toFixed(4)),
    avg_confidence: avgConfidence == null ? null : Number(avgConfidence.toFixed(4)),
    top_symbols: top.slice(0, 5).map((row) => row.ticker),
    rows: top.map((row, index) => ({
      rank: index + 1,
      ticker: row.ticker,
      source_mix: row.source_mix,
      factor_score: Number((row.factor_score ?? 0).toFixed(4)),
      sleeve_score: Number((row.sleeve_score ?? 0).toFixed(4)),
      baseline_score: row.baseline_score == null ? null : Number(row.baseline_score.toFixed(4)),
      score_delta_vs_baseline: row.score_delta_vs_baseline == null ? null : Number(row.score_delta_vs_baseline.toFixed(4)),
      confidence: row.confidence == null ? null : Number(row.confidence.toFixed(4)),
      strongest_drivers: row.strongest_drivers || '',
    })),
  };
}

export function buildFactorTournament({ featuresRows, ranksRows, weights, asOfDate }) {
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
      strongest_drivers: row.strongest_drivers || rank.strongest_drivers || '',
      eligible: isEligible(rank.ticker ? rank : row),
    };
  }).filter((row) => row.ticker);

  const sleeves = sleeveDefinitions(weights).map((definition) => {
    const rows = baseRows
      .map((row) => {
        const factorScore = asNum(row[definition.field]) ?? 0;
        const sleeveScore = (definition.weight * factorScore) - (row.risk_penalty ?? 0) - (row.liquidity_penalty ?? 0);
        return {
          ...row,
          factor_score: factorScore,
          coverage_ok: definition.coverage(row),
          sleeve_score: sleeveScore,
          score_delta_vs_baseline: row.baseline_score == null ? null : sleeveScore - row.baseline_score,
        };
      })
      .filter((row) => row.coverage_ok)
      .sort((a, b) => {
        const scoreDiff = (b.sleeve_score ?? -Infinity) - (a.sleeve_score ?? -Infinity);
        if (scoreDiff !== 0) return scoreDiff;
        return String(a.ticker).localeCompare(String(b.ticker));
      });

    return summarizeSleeve(definition, rows);
  });

  const winner = sleeves
    .slice()
    .sort((a, b) => {
      const scoreDiff = (b.avg_sleeve_score ?? -Infinity) - (a.avg_sleeve_score ?? -Infinity);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.eligible_count ?? 0) - (a.eligible_count ?? 0);
    })[0] || null;

  const detailRows = sleeves.flatMap((sleeve) => sleeve.rows.map((row) => ({
    sleeve_id: sleeve.sleeve_id,
    label: sleeve.label,
    ...row,
  })));

  return {
    as_of_date: asOfDate,
    weights,
    winner: winner ? {
      sleeve_id: winner.sleeve_id,
      label: winner.label,
      avg_sleeve_score: winner.avg_sleeve_score,
      eligible_count: winner.eligible_count,
      top_symbols: winner.top_symbols,
    } : null,
    sleeves,
    rows: detailRows,
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

  const payload = buildFactorTournament({
    featuresRows,
    ranksRows,
    weights: config?.weights || {},
    asOfDate: todayDate('America/New_York'),
  });

  await ensureDir(outDir);
  const jsonPath = path.join(outDir, 'latest_factor_tournament.json');
  const csvPath = path.join(outDir, 'latest_factor_tournament.csv');

  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  await fs.writeFile(csvPath, toCsv(payload.rows, [
    'sleeve_id',
    'label',
    'rank',
    'ticker',
    'source_mix',
    'factor_score',
    'sleeve_score',
    'baseline_score',
    'score_delta_vs_baseline',
    'confidence',
    'strongest_drivers',
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
