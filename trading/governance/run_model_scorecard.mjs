#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { asNum, ensureDir, readJson, toCsv, todayDate } from '../scripts/lib.mjs';

const root = process.cwd();

async function loadRegistry(tradingDir) {
  const fallback = {
    champion_id: 'alpha_v1',
    challenger_ids: ['alpha_v1_regime_tilt'],
    models: [
      { id: 'alpha_v1', name: 'Alpha V1', role: 'champion', status: 'ACTIVE' },
      { id: 'alpha_v1_regime_tilt', name: 'Alpha V1 Regime Tilt', role: 'challenger', status: 'ACTIVE' },
    ],
  };

  try {
    const cfg = await readJson(path.join(tradingDir, 'config', 'model_registry.json'));
    return {
      ...fallback,
      ...cfg,
      models: Array.isArray(cfg?.models) ? cfg.models : fallback.models,
    };
  } catch {
    return fallback;
  }
}

export async function run() {
  const tradingDir = path.join(root, 'trading');
  const registry = await loadRegistry(tradingDir);

  let backtest = null;
  try {
    backtest = await readJson(path.join(tradingDir, 'backtest', 'results', 'latest_backtest.json'));
  } catch {
    backtest = null;
  }

  const asOf = todayDate('America/New_York');
  const winner = String(backtest?.decision?.winner || 'N/A');
  const reason = String(backtest?.decision?.reason || 'No backtest decision available');

  // Look up per-model backtest results by ID.
  // The backtest outputs: champion (keyed by ID), challengers map (keyed by ID),
  // plus a legacy top-level `challenger` for the best challenger.
  const challengersMap = backtest?.challengers || {};
  const promotionChallengerId = backtest?.decision?.challenger_id || null;

  const rows = (registry.models || []).map((model) => {
    const role = model.role || (model.id === registry.champion_id ? 'champion' : 'challenger');

    // Match this model to its specific backtest results by ID
    let side = null;
    if (role === 'champion') {
      side = backtest?.champion;
    } else {
      // Try per-challenger map first, fall back to legacy top-level challenger if IDs match
      side = challengersMap[model.id]
        || (backtest?.challenger?.id === model.id ? backtest.challenger : null);
    }

    return {
      as_of_date: asOf,
      model_id: model.id,
      model_name: model.name || model.id,
      role,
      status: model.status || 'ACTIVE',
      cagr: asNum(side?.cagr),
      sharpe: asNum(side?.sharpe),
      max_drawdown: asNum(side?.max_drawdown),
      alpha_vs_benchmark: asNum(side?.alpha_vs_benchmark),
      sample_n: asNum(side?.sample_n),
      promotion_candidate: winner === 'challenger' && model.id === promotionChallengerId,
      decision_reason: reason,
    };
  });

  const outDir = path.join(tradingDir, 'data', 'scorecard');
  await ensureDir(outDir);
  const outFile = path.join(outDir, 'latest_model_scorecard.csv');

  await fs.writeFile(outFile, toCsv(rows, [
    'as_of_date',
    'model_id',
    'model_name',
    'role',
    'status',
    'cagr',
    'sharpe',
    'max_drawdown',
    'alpha_vs_benchmark',
    'sample_n',
    'promotion_candidate',
    'decision_reason',
  ]), 'utf8');

  console.log(`Wrote: ${outFile}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
