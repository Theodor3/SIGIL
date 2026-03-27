#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { asNum, ensureDir, latestFile, parseCsv, readCsv, readJson, toCsv } from '../scripts/lib.mjs';
import { clamp, requireColumns } from '../pipeline/validate_data_contracts.mjs';

const root = process.cwd();

const DEFAULT_MODEL = {
  base_slippage_bps: 12,
  min_slippage_bps: 8,
  max_slippage_bps: 55,
  impact_scaler: 35,
  commission_per_trade_usd: 0,
  min_trade_notional_usd: 50,
  max_trade_cost_pct: 0.012,
};

async function loadCostModel(tradingDir) {
  try {
    const cfg = await readJson(path.join(tradingDir, 'config', 'execution_cost_model.json'));
    return { ...DEFAULT_MODEL, ...(cfg || {}) };
  } catch {
    return DEFAULT_MODEL;
  }
}

function parseOverlayReason(overlayText) {
  const text = String(overlayText || 'none').trim();
  if (!text || text.toLowerCase() === 'none') return 'NONE';
  const lowered = text.toLowerCase();
  if (lowered.startsWith('no options overlay')) {
    const m = text.match(/\((.+)\)/);
    return m ? m[1] : 'BLOCKED';
  }
  return 'ALLOWED';
}

async function loadPlaybookMap(tradingDir) {
  const latest = await latestFile(path.join(tradingDir, 'ideas'), /-final-top\d+\.csv$/);
  if (!latest) return new Map();
  const rows = parseCsv(await fs.readFile(latest, 'utf8'));
  return new Map(rows.map((r) => [String(r.symbol || '').toUpperCase(), r]));
}

export async function run() {
  const tradingDir = path.join(root, 'trading');
  const profile = await readJson(path.join(tradingDir, 'config', 'profile.json'));
  const positions = await readCsv(path.join(tradingDir, 'data', 'positions.csv'));
  const targets = await readCsv(path.join(tradingDir, 'data', 'portfolio', 'latest_target_weights.csv'));

  requireColumns(targets, ['ticker', 'target_weight', 'risk_adjusted_score', 'as_of_date'], 'latest_target_weights.csv');

  const model = await loadCostModel(tradingDir);
  const playbookMap = await loadPlaybookMap(tradingDir);

  const accountSize = asNum(profile?.investor_profile?.account_size_usd) ?? 0;
  const currentWeightByTicker = new Map();
  const priceByTicker = new Map();

  for (const row of positions) {
    const ticker = String(row.symbol || '').toUpperCase();
    const equity = asNum(row.equity) ?? 0;
    const price = asNum(row.price);
    if (!ticker || accountSize <= 0) continue;
    currentWeightByTicker.set(ticker, equity / accountSize);
    if (price != null && price > 0) priceByTicker.set(ticker, price);
  }

  const rows = targets.map((t) => {
    const ticker = String(t.ticker || '').toUpperCase();
    const targetWeight = asNum(t.target_weight) ?? 0;
    const currentWeight = currentWeightByTicker.get(ticker) ?? 0;
    const deltaWeight = targetWeight - currentWeight;
    const notional = deltaWeight * accountSize;

    const fallbackPrice = 100;
    const price = priceByTicker.get(ticker) ?? fallbackPrice;
    const sharesDelta = price > 0 ? notional / price : 0;

    const tradePctAccount = accountSize > 0 ? Math.abs(notional) / accountSize : 0;
    const slippageBps = clamp(
      Number(model.base_slippage_bps) + tradePctAccount * Number(model.impact_scaler) * 100,
      Number(model.min_slippage_bps),
      Number(model.max_slippage_bps),
    );

    const estCost = Math.abs(notional) * (slippageBps / 10000) + Number(model.commission_per_trade_usd);
    const costPct = Math.abs(notional) > 0 ? estCost / Math.abs(notional) : 0;

    const playbook = playbookMap.get(ticker) || {};
    const action = Math.abs(notional) < Number(model.min_trade_notional_usd)
      ? 'hold'
      : (notional > 0 ? 'buy' : (targetWeight > 0 ? 'trim' : 'sell'));

    const overlay = playbook.options_overlay || 'none';

    const executionPenalty = Number(asNum(t.liquidity_penalty) ?? 0) + (costPct * 0.5);

    return {
      ticker,
      action,
      shares_delta: Number(sharesDelta.toFixed(3)),
      est_slippage_bps: Number(slippageBps.toFixed(2)),
      est_cost_usd: Number(estCost.toFixed(2)),
      entry_zone_low: String(playbook.entry_zone || '').split('-')[0]?.trim() || 'n/a',
      entry_zone_high: String(playbook.entry_zone || '').split('-')[1]?.trim() || 'n/a',
      invalidation_price: playbook.invalidation || 'n/a',
      trim_schedule: playbook.trim_schedule || 'n/a',
      options_overlay: overlay,
      options_gate_reason: parseOverlayReason(overlay),
      as_of_date: t.as_of_date,
      target_weight: Number(targetWeight.toFixed(4)),
      current_weight: Number(currentWeight.toFixed(4)),
      delta_weight: Number(deltaWeight.toFixed(4)),
      risk_adjusted_score: Number((asNum(t.risk_adjusted_score) ?? 0).toFixed(4)),
      execution_penalty: Number(executionPenalty.toFixed(4)),
      trade_notional_usd: Number(notional.toFixed(2)),
      cost_pct_of_notional: Number(costPct.toFixed(4)),
    };
  });

  const outDir = path.join(tradingDir, 'data', 'execution');
  await ensureDir(outDir);
  const outFile = path.join(outDir, 'latest_trade_plan.csv');

  await fs.writeFile(outFile, toCsv(rows, [
    'ticker',
    'action',
    'shares_delta',
    'est_slippage_bps',
    'est_cost_usd',
    'entry_zone_low',
    'entry_zone_high',
    'invalidation_price',
    'trim_schedule',
    'options_overlay',
    'options_gate_reason',
    'as_of_date',
    'target_weight',
    'current_weight',
    'delta_weight',
    'risk_adjusted_score',
    'execution_penalty',
    'trade_notional_usd',
    'cost_pct_of_notional',
  ]), 'utf8');

  console.log(`Wrote: ${outFile}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
