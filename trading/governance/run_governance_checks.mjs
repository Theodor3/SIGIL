#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { asNum, parseCsv, readJson, toCsv, todayDate } from '../scripts/lib.mjs';

const root = process.cwd();

const DEFAULT_PROMOTION_POLICY = {
  min_backtest_sample_n: 40,
  min_forward_closed_trades: 5,
  min_forward_avg_alpha_pct_points: 0,
  block_on_freeze_violation: true,
  require_challenger_winner: true,
};

function daysBetween(a, b) {
  const da = new Date(`${a}T00:00:00Z`);
  const db = new Date(`${b}T00:00:00Z`);
  if (Number.isNaN(da.valueOf()) || Number.isNaN(db.valueOf())) return null;
  return Math.round((db - da) / 86400000);
}

function hashObj(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

async function readJsonOr(filePath, fallback) {
  try {
    return await readJson(filePath);
  } catch {
    return fallback;
  }
}

async function readForwardClosedSummary(tradingDir) {
  const ledgerPath = path.join(tradingDir, 'forward', 'paper_trades.csv');
  try {
    const rows = parseCsv(await fs.readFile(ledgerPath, 'utf8'));
    const closed = rows.filter((r) => String(r.status || '').toUpperCase() === 'CLOSED');
    if (!closed.length) {
      return { closed_count: 0, avg_alpha_vs_expected_pct_points: null };
    }
    const vals = closed
      .map((r) => asNum(r.alpha_vs_expected_pct))
      .filter((v) => v != null);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return {
      closed_count: closed.length,
      avg_alpha_vs_expected_pct_points: avg,
    };
  } catch {
    return { closed_count: 0, avg_alpha_vs_expected_pct_points: null };
  }
}

function evaluatePromotion({
  backtestWinner,
  sampleN,
  freezeViolation,
  forwardClosedCount,
  forwardAvgAlpha,
  policy,
}) {
  const reasons = [];
  const winner = String(backtestWinner || '').toUpperCase();

  if (policy.require_challenger_winner && winner !== 'CHALLENGER') {
    reasons.push('Backtest winner is not challenger');
  }

  if (Number(sampleN) < Number(policy.min_backtest_sample_n)) {
    reasons.push(`Backtest sample below minimum (${sampleN}/${policy.min_backtest_sample_n})`);
  }

  if (Number(forwardClosedCount) < Number(policy.min_forward_closed_trades)) {
    reasons.push(`Forward closed trades below minimum (${forwardClosedCount}/${policy.min_forward_closed_trades})`);
  }

  if ((forwardAvgAlpha ?? -Infinity) < Number(policy.min_forward_avg_alpha_pct_points)) {
    reasons.push(
      `Forward alpha_vs_expected below minimum (${forwardAvgAlpha ?? 'n/a'}/${policy.min_forward_avg_alpha_pct_points})`,
    );
  }

  if (policy.block_on_freeze_violation && freezeViolation) {
    reasons.push('Freeze violation active');
  }

  return {
    allow: reasons.length === 0,
    reasons,
  };
}

function normalizeRegistry(registry) {
  const models = Array.isArray(registry?.models) ? registry.models : [];
  const championId = registry?.champion_id || (models.find((m) => m.role === 'champion')?.id ?? null);

  return {
    champion_id: championId,
    challenger_ids: Array.isArray(registry?.challenger_ids) ? registry.challenger_ids : models.filter((m) => m.role === 'challenger').map((m) => m.id),
    models,
  };
}

function promoteRegistry(registry, targetChampionId) {
  const next = normalizeRegistry(registry);
  const currentChampion = next.champion_id;

  if (!targetChampionId || targetChampionId === currentChampion) {
    return { changed: false, registry: next, previousChampion: currentChampion };
  }

  const modelIds = new Set(next.models.map((m) => m.id));
  if (!modelIds.has(targetChampionId)) {
    return { changed: false, registry: next, previousChampion: currentChampion };
  }

  next.champion_id = targetChampionId;
  next.models = next.models.map((m) => {
    if (m.id === targetChampionId) return { ...m, role: 'champion' };
    if (m.id === currentChampion) return { ...m, role: 'challenger' };
    return { ...m, role: m.role === 'champion' ? 'challenger' : m.role };
  });

  next.challenger_ids = next.models.filter((m) => m.id !== targetChampionId && m.role === 'challenger').map((m) => m.id);

  return { changed: true, registry: next, previousChampion: currentChampion };
}

export async function run() {
  const tradingDir = path.join(root, 'trading');
  const govDir = path.join(tradingDir, 'governance');
  await fs.mkdir(govDir, { recursive: true });

  const profile = await readJson(path.join(tradingDir, 'config', 'profile.json'));
  const alphaModel = await readJson(path.join(tradingDir, 'config', 'alpha_model.json'));
  const modelVariants = await readJson(path.join(tradingDir, 'backtest', 'config', 'model_variants.json'));
  const backtest = await readJson(path.join(tradingDir, 'backtest', 'results', 'latest_backtest.json'));
  const modelRegistryPath = path.join(tradingDir, 'config', 'model_registry.json');
  const modelRegistry = await readJsonOr(modelRegistryPath, { champion_id: 'alpha_v1', challenger_ids: [], models: [] });

  const asOf = todayDate(profile?.timezone || 'America/New_York');
  const freezeDays = Number(alphaModel?.freeze?.weights_frozen_days ?? 7);
  const weightsHash = hashObj(alphaModel?.weights || {});

  const statePath = path.join(govDir, 'model_state.json');
  const state = await readJsonOr(statePath, {
    last_weights_hash: null,
    last_change_date: null,
    changes: [],
    last_promotion_date: null,
    last_promotion_from: null,
    last_promotion_to: null,
  });

  let freezeViolation = false;
  let changeEvent = null;

  if (state.last_weights_hash && state.last_weights_hash !== weightsHash) {
    const since = state.last_change_date ? daysBetween(state.last_change_date, asOf) : null;
    freezeViolation = since != null && since < freezeDays;
    changeEvent = {
      date: asOf,
      event: 'WEIGHTS_CHANGED',
      days_since_last_change: since,
      freeze_violation: freezeViolation,
      reason: 'Detected new alpha_model weights hash',
      prev_hash: state.last_weights_hash,
      new_hash: weightsHash,
    };
  } else if (!state.last_weights_hash) {
    changeEvent = {
      date: asOf,
      event: 'BASELINE_SET',
      days_since_last_change: null,
      freeze_violation: false,
      reason: 'Initialized governance model hash baseline',
      prev_hash: '',
      new_hash: weightsHash,
    };
  }

  if (changeEvent) {
    state.changes.push(changeEvent);
    state.last_weights_hash = weightsHash;
    state.last_change_date = asOf;
  }

  const promotionPolicy = {
    ...DEFAULT_PROMOTION_POLICY,
    ...(alphaModel?.promotion || {}),
  };

  const decisionWinner = String(backtest?.decision?.winner || 'N/A').toUpperCase();
  const sampleN = Number(backtest?.champion?.sample_n ?? 0);
  const forward = await readForwardClosedSummary(tradingDir);

  const gate = evaluatePromotion({
    backtestWinner: decisionWinner,
    sampleN,
    freezeViolation,
    forwardClosedCount: forward.closed_count,
    forwardAvgAlpha: forward.avg_alpha_vs_expected_pct_points,
    policy: promotionPolicy,
  });

  const requestedChampionId = modelRegistry?.challenger_ids?.[0] || modelRegistry?.models?.find((m) => m.role === 'challenger')?.id || null;
  const promotion = promoteRegistry(modelRegistry, gate.allow ? requestedChampionId : null);

  let promotionEvent = null;
  if (promotion.changed) {
    await fs.writeFile(modelRegistryPath, JSON.stringify(promotion.registry, null, 2), 'utf8');

    promotionEvent = {
      date: asOf,
      event: 'PROMOTION_EXECUTED',
      days_since_last_change: null,
      freeze_violation: freezeViolation,
      reason: `Promoted ${requestedChampionId} over ${promotion.previousChampion}`,
      prev_hash: '',
      new_hash: '',
    };

    state.changes.push(promotionEvent);
    state.last_promotion_date = asOf;
    state.last_promotion_from = promotion.previousChampion;
    state.last_promotion_to = requestedChampionId;
  }

  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');

  const governance = {
    as_of_date: asOf,
    freeze_days: freezeDays,
    freeze_violation: freezeViolation,
    last_change_date: state.last_change_date,
    change_count: state.changes.length,
    promotion_policy: promotionPolicy,
    promotion_gate: {
      winner: decisionWinner,
      sample_n: sampleN,
      min_sample: promotionPolicy.min_backtest_sample_n,
      forward_closed_trades: forward.closed_count,
      min_forward_closed_trades: promotionPolicy.min_forward_closed_trades,
      forward_avg_alpha_vs_expected_pct_points: forward.avg_alpha_vs_expected_pct_points,
      min_forward_avg_alpha_pct_points: promotionPolicy.min_forward_avg_alpha_pct_points,
      promote_challenger: gate.allow,
      promotion_executed: promotion.changed,
      promotion_target: promotion.changed ? requestedChampionId : null,
      reason: gate.allow
        ? 'All promotion gates passed.'
        : `Promotion blocked: ${gate.reasons.join('; ')}`,
    },
    champion: {
      name: modelVariants?.champion?.name || 'champion',
      id: normalizeRegistry(promotion.registry || modelRegistry).champion_id,
      alpha_vs_benchmark: asNum(backtest?.champion?.alpha_vs_benchmark),
      avg_trade_return: asNum(backtest?.champion?.avg_trade_return),
    },
    // Best challenger (used for promotion decisions)
    challenger: {
      name: backtest?.challenger?.name || 'challenger',
      id: backtest?.challenger?.id || requestedChampionId,
      alpha_vs_benchmark: asNum(backtest?.challenger?.alpha_vs_benchmark),
      avg_trade_return: asNum(backtest?.challenger?.avg_trade_return),
    },
    // All challengers with individual metrics
    challengers: Object.fromEntries(
      Object.entries(backtest?.challengers || {}).map(([id, metrics]) => [id, {
        name: metrics?.name || id,
        id,
        alpha_vs_benchmark: asNum(metrics?.alpha_vs_benchmark),
        avg_trade_return: asNum(metrics?.avg_trade_return),
        cagr: asNum(metrics?.cagr),
        sharpe: asNum(metrics?.sharpe),
      }])
    ),
    last_promotion: {
      date: state.last_promotion_date,
      from: state.last_promotion_from,
      to: state.last_promotion_to,
    },
  };

  const latestJson = path.join(govDir, 'latest_governance.json');
  const logCsv = path.join(govDir, 'model_change_log.csv');
  const tableMd = path.join(govDir, `${asOf}-model-table.md`);

  await fs.writeFile(latestJson, JSON.stringify(governance, null, 2), 'utf8');

  const changeRows = state.changes.map((c) => ({
    date: c.date,
    event: c.event,
    days_since_last_change: c.days_since_last_change ?? '',
    freeze_violation: c.freeze_violation,
    reason: c.reason,
    prev_hash: c.prev_hash,
    new_hash: c.new_hash,
  }));
  await fs.writeFile(logCsv, toCsv(changeRows, [
    'date',
    'event',
    'days_since_last_change',
    'freeze_violation',
    'reason',
    'prev_hash',
    'new_hash',
  ]), 'utf8');

  const md = [
    `# Model Governance Table - ${asOf}`,
    '',
    `- Freeze window: ${freezeDays} days`,
    `- Freeze violation: ${freezeViolation ? 'YES' : 'NO'}`,
    `- Last weight change date: ${state.last_change_date || 'n/a'}`,
    `- Last promotion: ${state.last_promotion_date ? `${state.last_promotion_date} (${state.last_promotion_from} -> ${state.last_promotion_to})` : 'n/a'}`,
    '',
    '## Champion vs Challengers',
    '',
    '| Model | Role | Avg Trade Return | Alpha vs Benchmark |',
    '|---|---|---:|---:|',
    `| ${governance.champion.id || governance.champion.name} | champion | ${governance.champion.avg_trade_return ?? 'n/a'} | ${governance.champion.alpha_vs_benchmark ?? 'n/a'} |`,
    ...Object.values(governance.challengers || {}).map((ch) =>
      `| ${ch.id || ch.name} | challenger | ${ch.avg_trade_return ?? 'n/a'} | ${ch.alpha_vs_benchmark ?? 'n/a'} |`
    ),
    '',
    '## Promotion Gate',
    '',
    `- Winner: ${governance.promotion_gate.winner}`,
    `- Backtest sample: ${governance.promotion_gate.sample_n} / ${governance.promotion_gate.min_sample}`,
    `- Forward closed trades: ${governance.promotion_gate.forward_closed_trades} / ${governance.promotion_gate.min_forward_closed_trades}`,
    `- Forward alpha vs expected: ${governance.promotion_gate.forward_avg_alpha_vs_expected_pct_points ?? 'n/a'} / ${governance.promotion_gate.min_forward_avg_alpha_pct_points}`,
    `- Promote challenger (gate): ${governance.promotion_gate.promote_challenger ? 'YES' : 'NO'}`,
    `- Promotion executed: ${governance.promotion_gate.promotion_executed ? 'YES' : 'NO'}`,
    `- Reason: ${governance.promotion_gate.reason}`,
  ].join('\n');

  await fs.writeFile(tableMd, md, 'utf8');

  console.log(`Wrote: ${latestJson}`);
  console.log(`Wrote: ${logCsv}`);
  console.log(`Wrote: ${tableMd}`);
  if (promotion.changed) {
    console.log(`Promotion executed: ${promotion.previousChampion} -> ${requestedChampionId}`);
  }
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
