#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { asNum, latestFile, parseCsv, readCsv, readJson, todayDate } from '../scripts/lib.mjs';
import { betaProxyForSector, displaySectorLabel, normalizeSector, normalizeSubIndustry } from '../scripts/sector_utils.mjs';
import { getProviderEnvSummary, loadLocalEnv } from '../providers/env.mjs';
import { buildNowcastAblation } from '../scripts/run_nowcast_ablation.mjs';
import { buildFactorTournament } from '../scripts/run_factor_tournament.mjs';
import { buildEarningsDriftLab } from '../scripts/run_earnings_drift_lab.mjs';

const root = process.cwd();
const tradingDir = path.join(root, 'trading');
const altDir = path.join(tradingDir, 'data', 'alt');

async function safeRead(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}

function pct(v) {
  if (v == null || Number.isNaN(Number(v))) return null;
  return Number((Number(v) * 100).toFixed(2));
}

function parsePctString(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.endsWith('%')) return asNum(s.slice(0, -1));
  return asNum(s);
}

function aggregateDrivers(rows) {
  const map = new Map();
  for (const r of rows) {
    const text = String(r.strongest_drivers || '');
    const parts = text.split(';').map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      const m = p.match(/^([a-z_]+)\(([-+]?\d*\.?\d+)\)$/i);
      if (!m) continue;
      const key = m[1];
      const val = Number(m[2]);
      if (!Number.isFinite(val)) continue;
      const cur = map.get(key) || { factor: key, total: 0, count: 0 };
      cur.total += val;
      cur.count += 1;
      map.set(key, cur);
    }
  }
  return [...map.values()]
    .map((x) => ({ factor: x.factor, avg_score: x.count ? x.total / x.count : 0, mentions: x.count }))
    .sort((a, b) => b.avg_score - a.avg_score);
}

function buildTickerMap(rows, keyField) {
  return new Map(
    (rows || [])
      .map((row) => [String(row?.[keyField] || '').toUpperCase(), row])
      .filter(([key]) => key)
  );
}

function daysBetweenUtc(fromDate, toDate) {
  if (!fromDate || !toDate) return null;
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf())) return null;
  return Math.round((to - from) / 86400000);
}

function addDaysUtc(dateStr, days) {
  if (!dateStr || !Number.isFinite(Number(days))) return '';
  const dt = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(dt.valueOf())) return '';
  dt.setUTCDate(dt.getUTCDate() + Number(days));
  return dt.toISOString().slice(0, 10);
}

function betaProxyForPosition(position, sector) {
  const symbol = String(position?.symbol || '').toUpperCase();
  const name = String(position?.name || '').toUpperCase();
  const assetType = String(position?.asset_type || '').toLowerCase();

  if (assetType === 'crypto') return 1.6;
  if (symbol === 'TQQQ') return 3.0;
  if (symbol === 'ARKK') return 1.8;
  if (symbol === 'XME') return 1.35;
  if (symbol === 'ARGT') return 1.4;
  if (name.includes('ETF')) return 1.0;
  return betaProxyForSector(sector);
}

function herfindahlIndex(weights) {
  return (weights || []).reduce((acc, weight) => acc + (weight ** 2), 0);
}

function isoDateOrBlank(value) {
  const dt = new Date(value);
  if (Number.isNaN(dt.valueOf())) return '';
  return dt.toISOString().slice(0, 10);
}

function freshnessLabel(ageDays) {
  if (ageDays == null) return 'unknown';
  if (ageDays <= 1) return 'fresh';
  if (ageDays <= 7) return 'aging';
  return 'stale';
}

function inferDateFromFileName(filePath) {
  const base = path.basename(String(filePath || ''));
  const match = base.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function summarizeTradeHistory(trades) {
  const total = trades.length;
  const open = trades.filter((trade) => String(trade.status || '').toUpperCase() === 'OPEN').length;
  const closedRows = trades.filter((trade) => String(trade.status || '').toUpperCase() === 'CLOSED');
  const wins = closedRows.filter((trade) => (trade.realized_return_pct ?? -Infinity) > 0).length;
  const losses = closedRows.filter((trade) => (trade.realized_return_pct ?? Infinity) <= 0).length;
  const avgRealized = closedRows.length
    ? sum(closedRows.map((trade) => trade.realized_return_pct ?? 0)) / closedRows.length
    : null;
  const avgAlphaVsExpected = trades.length
    ? sum(trades.map((trade) => trade.alpha_vs_expected_pct ?? 0)) / trades.length
    : null;
  const latestTrade = trades[0] || null;

  return {
    tracked_trades: total,
    open_trades: open,
    closed_trades: closedRows.length,
    wins,
    losses,
    avg_realized_return_pct: avgRealized,
    avg_alpha_vs_expected_pct: avgAlphaVsExpected,
    last_status: latestTrade?.status || '',
    last_opened_date: latestTrade?.opened_date || '',
    last_closed_date: latestTrade?.closed_date || '',
  };
}

function buildIdeaMemoryMap(ideaSnapshots, ledgerRows) {
  const memory = new Map();

  for (const snapshot of (ideaSnapshots || [])) {
    const fileDate = inferDateFromFileName(snapshot.file);
    const sourceFile = path.basename(String(snapshot.file || ''));
    for (const row of (snapshot.rows || [])) {
      const symbol = String(row.symbol || '').toUpperCase();
      if (!symbol) continue;
      const existing = memory.get(symbol) || { appearances: [], trades: [] };
      existing.appearances.push({
        date: String(row.date || fileDate || ''),
        rank: asNum(row.rank),
        final_alpha_score: asNum(row.final_alpha_score),
        confidence: asNum(row.confidence),
        expected_alpha_20d: parsePctString(row.expected_alpha_20d),
        expected_alpha_90d: parsePctString(row.expected_alpha_90d),
        entry_zone: row.entry_zone || '',
        strongest_drivers: row.strongest_drivers || '',
        source_file: sourceFile,
      });
      memory.set(symbol, existing);
    }
  }

  for (const row of (ledgerRows || [])) {
    const symbol = String(row.symbol || '').toUpperCase();
    if (!symbol) continue;
    const existing = memory.get(symbol) || { appearances: [], trades: [] };
    existing.trades.push({
      opened_date: String(row.opened_date || ''),
      closed_date: String(row.closed_date || ''),
      status: String(row.status || '').toUpperCase() || 'OPEN',
      close_reason: row.close_reason || '',
      expected_alpha_20d_pct: asNum(row.expected_alpha_20d_pct),
      expected_alpha_90d_pct: asNum(row.expected_alpha_90d_pct),
      expected_alpha_to_date_pct: asNum(row.expected_alpha_to_date_pct),
      realized_return_pct: asNum(row.realized_return_pct),
      alpha_vs_expected_pct: asNum(row.alpha_vs_expected_pct),
      days_open: asNum(row.days_open),
      source_file: row.source_file || '',
    });
    memory.set(symbol, existing);
  }

  for (const [symbol, entry] of memory.entries()) {
    const appearances = entry.appearances
      .slice()
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const trades = entry.trades
      .slice()
      .sort((a, b) => {
        const dateA = String(a.closed_date || a.opened_date || '');
        const dateB = String(b.closed_date || b.opened_date || '');
        return dateB.localeCompare(dateA);
      });
    const firstSeen = appearances.length ? appearances[appearances.length - 1].date : '';
    const lastSeen = appearances.length ? appearances[0].date : '';

    memory.set(symbol, {
      first_seen_date: firstSeen,
      last_seen_date: lastSeen,
      appearance_count: appearances.length,
      recent_appearances: appearances.slice(0, 5),
      trades: trades.slice(0, 5),
      summary: summarizeTradeHistory(trades),
    });
  }

  return memory;
}

function buildPostmortemShelf(ledgerRows) {
  const rows = (ledgerRows || []).map((row) => ({
    symbol: String(row.symbol || '').toUpperCase(),
    opened_date: String(row.opened_date || ''),
    closed_date: String(row.closed_date || ''),
    status: String(row.status || '').toUpperCase() || 'OPEN',
    close_reason: String(row.close_reason || ''),
    days_open: asNum(row.days_open),
    expected_alpha_20d_pct: asNum(row.expected_alpha_20d_pct),
    expected_alpha_90d_pct: asNum(row.expected_alpha_90d_pct),
    expected_alpha_to_date_pct: asNum(row.expected_alpha_to_date_pct),
    realized_return_pct: asNum(row.realized_return_pct),
    alpha_vs_expected_pct: asNum(row.alpha_vs_expected_pct),
    source_file: String(row.source_file || ''),
  })).filter((row) => row.symbol);

  const closed = rows
    .filter((row) => row.status === 'CLOSED')
    .sort((a, b) => String(b.closed_date || '').localeCompare(String(a.closed_date || '')));
  const open = rows
    .filter((row) => row.status === 'OPEN')
    .sort((a, b) => (b.alpha_vs_expected_pct ?? -Infinity) - (a.alpha_vs_expected_pct ?? -Infinity));

  const reasons = {};
  for (const row of closed) {
    const key = row.close_reason || 'UNKNOWN';
    reasons[key] = (reasons[key] || 0) + 1;
  }

  const avgClosedReturn = closed.length
    ? sum(closed.map((row) => row.realized_return_pct ?? 0)) / closed.length
    : null;
  const avgClosedAlphaGap = closed.length
    ? sum(closed.map((row) => row.alpha_vs_expected_pct ?? 0)) / closed.length
    : null;

  return {
    total_trades: rows.length,
    open_trades: open.length,
    closed_trades: closed.length,
    reasons,
    avg_closed_return_pct: avgClosedReturn,
    avg_closed_alpha_vs_expected_pct: avgClosedAlphaGap,
    recent_closed: closed.slice(0, 8),
    top_winners: rows
      .filter((row) => row.realized_return_pct != null)
      .slice()
      .sort((a, b) => (b.realized_return_pct ?? -Infinity) - (a.realized_return_pct ?? -Infinity))
      .slice(0, 5),
    top_losers: rows
      .filter((row) => row.realized_return_pct != null)
      .slice()
      .sort((a, b) => (a.realized_return_pct ?? Infinity) - (b.realized_return_pct ?? Infinity))
      .slice(0, 5),
    open_watchlist: open
      .slice()
      .sort((a, b) => (a.days_open ?? -Infinity) - (b.days_open ?? -Infinity))
      .slice(0, 8),
  };
}

async function inspectContract({
  filePath,
  label,
  sourceType,
  dateField,
  asOfDate,
  notes = '',
}) {
  try {
    const stat = await fs.stat(filePath);
    const text = await safeRead(filePath);
    const rows = text ? parseCsv(text) : [];
    let latestDataDate = '';

    if (dateField) {
      for (const row of rows) {
        const raw = dateField === 'published_at'
          ? String(row?.[dateField] || '').slice(0, 10)
          : String(row?.[dateField] || '');
        const normalized = isoDateOrBlank(raw);
        if (normalized && (!latestDataDate || normalized > latestDataDate)) {
          latestDataDate = normalized;
        }
      }
    }

    const updatedAt = stat.mtime.toISOString();
    const ageDays = latestDataDate ? daysBetweenUtc(latestDataDate, asOfDate) : daysBetweenUtc(updatedAt.slice(0, 10), asOfDate);

    return {
      label,
      file: filePath,
      source_type: sourceType,
      status: freshnessLabel(ageDays),
      file_updated_at: updatedAt,
      latest_data_date: latestDataDate || '',
      age_days: ageDays,
      row_count: rows.length,
      notes,
    };
  } catch {
    return {
      label,
      file: filePath,
      source_type: sourceType,
      status: 'missing',
      file_updated_at: '',
      latest_data_date: '',
      age_days: null,
      row_count: 0,
      notes: notes || 'File not found',
    };
  }
}

async function loadRegimePolicy() {
  try {
    return await readJson(path.join(tradingDir, 'config', 'regime_policy.json'));
  } catch {
    return {
      factor_tilts: {},
      regime_multipliers: {},
      exposure: {},
    };
  }
}

async function loadLatestCsv(dir, regex) {
  let f = null;
  try {
    f = await latestFile(dir, regex);
  } catch {
    return { file: null, rows: [] };
  }
  if (!f) return { file: null, rows: [] };
  const text = await safeRead(f);
  return {
    file: f,
    rows: text ? parseCsv(text) : [],
  };
}

async function loadRecentMatchingCsvs(dir, regex, limit = 2) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && regex.test(entry.name))
      .map((entry) => path.join(dir, entry.name))
      .sort((a, b) => path.basename(b).localeCompare(path.basename(a)))
      .slice(0, limit);

    return await Promise.all(files.map(async (file) => ({
      file,
      rows: parseCsv(await fs.readFile(file, 'utf8')),
    })));
  } catch {
    return [];
  }
}

async function loadBacktestSummary() {
  try {
    const bt = await readJson(path.join(tradingDir, 'backtest', 'results', 'latest_backtest.json'));
    const dq = bt?.data_quality || {};
    return {
      winner: bt?.decision?.winner || 'N/A',
      reason: bt?.decision?.reason || '',
      champion_alpha: asNum(bt?.champion?.alpha_vs_benchmark),
      challenger_alpha: asNum(bt?.challenger?.alpha_vs_benchmark),
      champion_cagr: asNum(bt?.champion?.cagr),
      challenger_cagr: asNum(bt?.challenger?.cagr),
      champion_sharpe: asNum(bt?.champion?.sharpe),
      challenger_sharpe: asNum(bt?.challenger?.sharpe),
      champion_max_drawdown: asNum(bt?.champion?.max_drawdown),
      challenger_max_drawdown: asNum(bt?.challenger?.max_drawdown),
      sample_n: asNum(bt?.champion?.sample_n) ?? 0,
      threshold: asNum(bt?.threshold),
      hold_days: asNum(bt?.hold_days),
      benchmark_mode: bt?.benchmark_mode || 'N/A',
      as_of_date: bt?.as_of_date || null,
      // Data quality — tracks look-ahead bias elimination progress
      pit_events: dq.pit_events ?? 0,
      simulated_events: dq.simulated_events ?? 0,
      pit_coverage_pct: asNum(dq.pit_coverage_pct) ?? 0,
      snapshots_available: dq.snapshots_available ?? 0,
      data_quality_note: dq.note || '',
      // PEAD point-in-time backtest — zero look-ahead bias
      pead_pit_cagr: asNum(bt?.pead_pit?.cagr),
      pead_pit_hit_rate: asNum(bt?.pead_pit?.hit_rate),
      pead_pit_events_n: asNum(bt?.pead_pit?.events_n) ?? 0,
      pead_pit_note: bt?.pead_pit?.note || '',
    };
  } catch {
    return {
      winner: 'N/A',
      reason: 'Backtest not available',
      champion_alpha: null,
      challenger_alpha: null,
      champion_cagr: null,
      challenger_cagr: null,
      champion_sharpe: null,
      challenger_sharpe: null,
      champion_max_drawdown: null,
      challenger_max_drawdown: null,
      sample_n: 0,
      threshold: null,
      hold_days: null,
      benchmark_mode: 'N/A',
      as_of_date: null,
      pit_events: 0,
      simulated_events: 0,
      pit_coverage_pct: 0,
      snapshots_available: 0,
      data_quality_note: 'Backtest not available',
      pead_pit_cagr: null,
      pead_pit_hit_rate: null,
      pead_pit_events_n: 0,
      pead_pit_note: '',
    };
  }
}

async function loadCryptoAlertSummary(reportsDir) {
  const file = await latestFile(reportsDir, /-crypto-alerts\.md$/);
  if (!file) return { file: null, high: 0, medium: 0 };
  const txt = (await safeRead(file)) || '';
  const high = Number((txt.match(/- HIGH alerts:\s*(\d+)/) || [])[1] || 0);
  const medium = Number((txt.match(/- MEDIUM alerts:\s*(\d+)/) || [])[1] || 0);
  return { file, high, medium };
}

async function loadRollingAlpha() {
  const eventsFile = await latestFile(path.join(tradingDir, 'backtest', 'results'), /-alpha-backtest-events\.csv$/);
  if (!eventsFile) return { file: null, alpha_30: null, alpha_90: null, series: [] };

  const text = await safeRead(eventsFile);
  const rows = text ? parseCsv(text) : [];

  const selected = rows
    .filter((r) => String(r.champion_selected).toLowerCase() === 'true')
    .map((r) => {
      const trade = asNum(r.simulated_return_hold) ?? asNum(r.realized_return_5d) ?? null;
      const bench = asNum(r.benchmark_return_hold) ?? asNum(r.realized_return_5d) ?? null;
      if (trade == null || bench == null) return null;
      return {
        report_date: r.report_date || '',
        trade_return: trade,
        benchmark_return: bench,
        alpha: trade - bench,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.report_date).localeCompare(String(b.report_date)));

  let cumTrade = 1;
  let cumBench = 1;
  const series = selected.map((r) => {
    cumTrade *= (1 + r.trade_return);
    cumBench *= (1 + r.benchmark_return);
    return {
      report_date: r.report_date,
      trade_return: r.trade_return,
      benchmark_return: r.benchmark_return,
      alpha: r.alpha,
      cumulative_alpha: (cumTrade - 1) - (cumBench - 1),
    };
  });

  function calc(lastN) {
    const slice = series.slice(-lastN);
    if (!slice.length) return null;
    return sum(slice.map((r) => r.alpha)) / slice.length;
  }

  return {
    file: eventsFile,
    alpha_30: calc(30),
    alpha_90: calc(90),
    series: series.slice(-20),
  };
}

async function loadForwardMonitor(timezone = 'America/New_York') {
  const forwardDir = path.join(tradingDir, 'forward');
  const ledgerPath = path.join(forwardDir, 'paper_trades.csv');
  const policyPath = path.join(tradingDir, 'config', 'forward_policy.json');
  const latestSnap = await loadLatestCsv(path.join(forwardDir, 'snapshots'), /-forward-snapshot\.csv$/);

  let ledgerRows = [];
  try {
    ledgerRows = parseCsv(await fs.readFile(ledgerPath, 'utf8'));
  } catch {
    ledgerRows = [];
  }

  let policy = {
    close_after_days: 90,
    reopen_cooldown_days: 21,
    max_open_trades: 10,
    stop_loss_pct: -12,
    take_profit_pct: 20,
    close_on_hit_stop_or_take: false,
  };

  try {
    policy = { ...policy, ...(await readJson(policyPath)) };
  } catch {
    // keep defaults
  }

  const asOf = todayDate(timezone);
  const open = ledgerRows.filter((r) => String(r.status || 'OPEN').toUpperCase() === 'OPEN');
  const closed = ledgerRows.filter((r) => String(r.status || '').toUpperCase() === 'CLOSED');
  const closedToday = closed.filter((r) => String(r.closed_date || '') === asOf);

  const reasons = {};
  for (const r of closedToday) {
    const k = String(r.close_reason || 'UNKNOWN');
    reasons[k] = (reasons[k] || 0) + 1;
  }

  const hitRate = open.length
    ? open.filter((r) => (asNum(r.realized_return_pct) ?? -Infinity) > 0).length / open.length
    : null;

  const avgAlphaDiff = open.length
    ? open.reduce((a, b) => a + (asNum(b.alpha_vs_expected_pct) ?? 0), 0) / open.length
    : null;

  const matured20 = open.filter((r) => (asNum(r.days_open) ?? 0) >= 20).length;

  return {
    ledger_file: ledgerRows.length ? ledgerPath : null,
    snapshot_file: latestSnap.file,
    policy,
    open_count: open.length,
    closed_count: closed.length,
    matured_20d_count: matured20,
    closes_today_count: closedToday.length,
    close_reasons_today: reasons,
    hit_rate_open: hitRate,
    avg_alpha_vs_expected_pct_points: avgAlphaDiff,
    ledger_rows: ledgerRows,
    open_trade_rows: open,
    open_rows: latestSnap.rows.slice(0, 20).map((r) => ({
      symbol: r.symbol,
      days_open: asNum(r.days_open),
      realized_return_pct: asNum(r.realized_return_pct),
      expected_alpha_to_date_pct: asNum(r.expected_alpha_to_date_pct),
      alpha_vs_expected_pct: asNum(r.alpha_vs_expected_pct),
    })),
  };
}

async function loadGovernanceSummary() {
  try {
    return await readJson(path.join(tradingDir, 'governance', 'latest_governance.json'));
  } catch {
    return {
      freeze_violation: false,
      promotion_gate: {
        winner: 'N/A',
        promote_challenger: false,
        reason: 'Governance not available',
      },
      change_count: 0,
    };
  }
}

function gateBreakdown(featureRows) {
  const out = {
    LOW_CONFIDENCE: 0,
    HIGH_LEVERAGE: 0,
    WEAK_PRE_EARNINGS: 0,
    ELIGIBLE: 0,
  };

  for (const r of featureRows) {
    const eligible = String(r.eligible || '').toLowerCase() !== 'false';
    if (eligible) {
      out.ELIGIBLE += 1;
      continue;
    }
    const tokens = String(r.gate_reason || '').split(';').map((s) => s.trim()).filter(Boolean);
    for (const t of tokens) {
      if (Object.prototype.hasOwnProperty.call(out, t)) out[t] += 1;
    }
  }
  return out;
}

function scriptCatalog() {
  return [
    { id: 'trading:alpha', command: 'npm run trading:alpha', purpose: 'Master pipeline (single source of truth).' },
    { id: 'trading:backtest', command: 'npm run trading:backtest', purpose: 'Run portfolio simulation backtest only.' },
    { id: 'trading:ablation:nowcast', command: 'npm run trading:ablation:nowcast', purpose: 'Refresh the nowcast ablation Alpha Lab artifact.' },
    { id: 'trading:factor:tournament', command: 'npm run trading:factor:tournament', purpose: 'Refresh the factor tournament Alpha Lab artifact.' },
    { id: 'trading:earnings:drift', command: 'npm run trading:earnings:drift', purpose: 'Refresh the earnings drift lab Alpha Lab artifact.' },
    { id: 'trading:dashboard:data', command: 'npm run trading:dashboard:data', purpose: 'Refresh dashboard JSON only.' },
  ];
}

function inferExperimentHypothesis(modelName, role) {
  const name = String(modelName || '').toLowerCase();
  if (role === 'champion') {
    return 'Reference baseline used to measure whether challengers add durable alpha.';
  }
  if (name.includes('regime')) {
    return 'Regime-aware tilts should improve timing and risk-adjusted returns.';
  }
  if (name.includes('quality')) {
    return 'Heavier quality emphasis should reduce drawdowns and improve consistency.';
  }
  if (name.includes('growth')) {
    return 'Growth bias should work best when acceleration and breadth are supportive.';
  }
  if (name.includes('alt') || name.includes('nowcast')) {
    return 'Alternative data should add incremental alpha when direct coverage is strong.';
  }
  return 'Competing alpha variant being tested against the current champion.';
}

function buildResearchProjects({
  asOfDate,
  featureRows,
  rankRows,
  bucketRows,
  nowcastRows,
  qualityRows,
  topIdeas,
  forwardMonitor,
  regime,
  nowcastAblation,
  factorTournament,
  earningsDriftLab,
}) {
  const featureCount = featureRows.length;
  const eligibleCount = rankRows.filter((row) => String(row.eligible || '').toLowerCase() !== 'false').length;
  const bucketCount = bucketRows.length;
  const ideaCount = topIdeas.length;
  const earningsReadyCount = featureRows.filter((row) => {
    const days = asNum(row.days_to_earnings);
    return days != null && days >= 0 && days <= 21;
  }).length;
  const directCount = nowcastRows.filter((row) => String(row.source_mix || '').toLowerCase() === 'direct').length;
  const hybridCount = nowcastRows.filter((row) => String(row.source_mix || '').toLowerCase() === 'hybrid').length;
  const proxyOnlyCount = nowcastRows.filter((row) => String(row.source_mix || '').toLowerCase() === 'proxy_only').length;
  const coveredCount = directCount + hybridCount + proxyOnlyCount;
  const noneCount = Math.max(featureCount - coveredCount, 0);
  const avgQualityPenalty = qualityRows.length
    ? sum(qualityRows.map((row) => asNum(row.quality_penalty) || 0)) / qualityRows.length
    : null;
  const avgEffectiveConfidence = qualityRows.length
    ? sum(qualityRows.map((row) => asNum(row.effective_confidence) || 0)) / qualityRows.length
    : null;
  const currentDrivers = aggregateDrivers(topIdeas).slice(0, 3);
  const regimeName = regime?.regime_id || 'unknown';
  const openTrades = asNum(forwardMonitor?.open_count) ?? 0;
  const matured20 = asNum(forwardMonitor?.matured_20d_count) ?? 0;

  return [
    {
      id: 'nowcast_ablation_lab',
      name: 'Nowcast Ablation Lab',
      category: 'research',
      status: 'active',
      hypothesis: 'Direct, proxy-only, and hybrid nowcast variants should compete so we keep only the alt-data sleeve that adds forward alpha.',
      evidence: [
        `Current winner: ${nowcastAblation?.winner?.label || 'n/a'} (${nowcastAblation?.winner?.avg_variant_score == null ? '-' : nowcastAblation.winner.avg_variant_score.toFixed(4)})`,
        `Coverage split: direct ${directCount}, hybrid ${hybridCount}, proxy-only ${proxyOnlyCount}, none ${noneCount}`,
        `Avg quality penalty: ${avgQualityPenalty == null ? '-' : avgQualityPenalty.toFixed(3)}`,
        `Avg effective confidence: ${avgEffectiveConfidence == null ? '-' : avgEffectiveConfidence.toFixed(3)}`,
      ],
      readiness: {
        score: featureCount ? coveredCount / featureCount : null,
        label: directCount > 0 ? 'good' : 'warn',
      },
      metrics: [
        ['Universe', featureCount],
        ['Covered', coveredCount],
        ['Direct', directCount],
        ['Proxy-only', proxyOnlyCount],
      ],
      notes: 'Now backed by a dedicated lab artifact. Next build: compare forward outcomes by cohort instead of only score-level diagnostics.',
    },
    {
      id: 'factor_tournament',
      name: 'Factor Tournament',
      category: 'research',
      status: 'monitor',
      hypothesis: 'Quality, growth, value, alt momentum, peer-relative, and proxy sleeves should compete separately before we rebalance blend weights.',
      evidence: [
        `Current winner: ${factorTournament?.winner?.label || 'n/a'} (${factorTournament?.winner?.avg_sleeve_score == null ? '-' : factorTournament.winner.avg_sleeve_score.toFixed(4)})`,
        ...currentDrivers.map((driver) => `${driver.factor}: avg ${driver.avg_score.toFixed(3)} across ${driver.mentions} ideas`),
      ],
      readiness: {
        score: ideaCount ? Math.min(currentDrivers.length / 3, 1) : 0,
        label: currentDrivers.length >= 3 ? 'good' : 'warn',
      },
      metrics: [
        ['Top ideas', ideaCount],
        ['Eligible', eligibleCount],
        ['Bucket', bucketCount],
        ['Regime', regimeName],
      ],
      notes: 'Now backed by a dedicated sleeve artifact. Next build: tie sleeve leaders to realized forward outcomes, not just score snapshots.',
    },
    {
      id: 'earnings_drift_lab',
      name: 'Earnings Drift Lab',
      category: 'research',
      status: 'monitor',
      hypothesis: 'Pre-earnings setup and post-earnings drift should form a distinct event alpha track rather than living as a side effect of the main ranker.',
      evidence: [
        `Top setup: ${earningsDriftLab?.summary?.top_setup?.ticker || 'n/a'} (${earningsDriftLab?.summary?.top_setup?.drift_score == null ? '-' : earningsDriftLab.summary.top_setup.drift_score.toFixed(4)})`,
        `Upcoming setups: ${earningsDriftLab?.summary?.upcoming_count ?? earningsReadyCount}`,
        `Active overlaps: ${earningsDriftLab?.summary?.active_overlap_count ?? openTrades}`,
        `Historical coverage: ${earningsDriftLab?.summary?.historical_coverage_count ?? 0}`,
      ],
      readiness: {
        score: featureCount ? (earningsDriftLab?.summary?.upcoming_count ?? earningsReadyCount) / featureCount : null,
        label: (earningsDriftLab?.summary?.historical_coverage_count ?? 0) >= 5 ? 'good' : 'monitor',
      },
      metrics: [
        ['Earnings setups', earningsDriftLab?.summary?.upcoming_count ?? earningsReadyCount],
        ['Open overlaps', earningsDriftLab?.summary?.active_overlap_count ?? openTrades],
        ['20D matured', matured20],
      ],
      notes: 'Now backed by a dedicated event-study artifact. Next build: compare predicted drift versus realized post-earnings returns by cohort and setup type.',
    },
    {
      id: 'broad_universe_ranker',
      name: 'Broad Universe Ranker',
      category: 'research',
      status: 'active',
      hypothesis: 'A wide scored preselection bucket should create better cross-sectional choice than a tiny hard-pass list.',
      evidence: [
        `Feature rows: ${featureCount}`,
        `Eligible rows: ${eligibleCount}`,
        `Current scored bucket: ${bucketCount}`,
      ],
      readiness: {
        score: featureCount ? eligibleCount / featureCount : null,
        label: eligibleCount >= 40 ? 'good' : 'warn',
      },
      metrics: [
        ['Feature rows', featureCount],
        ['Eligible', eligibleCount],
        ['Bucket', bucketCount],
        ['Ideas', ideaCount],
      ],
      notes: 'Next build: compare hit rate and expected alpha by bucket depth so we can decide where the preselection cutoff should really live.',
    },
  ].map((project) => ({
    ...project,
    as_of_date: asOfDate,
  }));
}

function buildAlphaLab({ scorecardRows, governance, backtest, forwardMonitor, asOfDate, researchProjects = [] }) {
  const rows = Array.isArray(scorecardRows) ? scorecardRows : [];
  const fallbackRows = rows.length
    ? rows
    : [
      {
        model_id: governance?.champion?.id || 'alpha_v1',
        model_name: governance?.champion?.name || 'Champion',
        role: 'champion',
        status: 'ACTIVE',
        cagr: governance?.champion?.cagr,
        sharpe: governance?.champion?.sharpe,
        max_drawdown: governance?.champion?.max_drawdown,
        alpha_vs_benchmark: governance?.champion?.alpha_vs_benchmark,
        sample_n: backtest?.champion?.sample_n,
        promotion_candidate: false,
        decision_reason: backtest?.decision?.reason || '',
      },
      {
        model_id: governance?.challenger?.id || 'alpha_v1_challenger',
        model_name: governance?.challenger?.name || 'Challenger',
        role: 'challenger',
        status: 'ACTIVE',
        cagr: governance?.challenger?.cagr,
        sharpe: governance?.challenger?.sharpe,
        max_drawdown: governance?.challenger?.max_drawdown,
        alpha_vs_benchmark: governance?.challenger?.alpha_vs_benchmark,
        sample_n: backtest?.challenger?.sample_n,
        promotion_candidate: Boolean(governance?.promotion_gate?.promote_challenger),
        decision_reason: backtest?.decision?.reason || '',
      },
    ];

  const experimentGate = {
    winner: governance?.promotion_gate?.winner || backtest?.winner || 'N/A',
    promote_challenger: Boolean(governance?.promotion_gate?.promote_challenger),
    promotion_executed: Boolean(governance?.promotion_gate?.promotion_executed),
    promotion_target: governance?.promotion_gate?.promotion_target || null,
    freeze_violation: Boolean(governance?.freeze_violation),
    reason: governance?.promotion_gate?.reason || backtest?.reason || '',
    sample_n: asNum(governance?.promotion_gate?.sample_n) ?? asNum(backtest?.sample_n) ?? null,
    min_sample: asNum(governance?.promotion_gate?.min_sample) ?? null,
    forward_closed_trades: asNum(governance?.promotion_gate?.forward_closed_trades) ?? null,
    min_forward_closed_trades: asNum(governance?.promotion_gate?.min_forward_closed_trades) ?? null,
    forward_avg_alpha_vs_expected_pct_points: asNum(governance?.promotion_gate?.forward_avg_alpha_vs_expected_pct_points) ?? null,
    min_forward_avg_alpha_pct_points: asNum(governance?.promotion_gate?.min_forward_avg_alpha_pct_points) ?? null,
  };

  const experiments = fallbackRows
    .map((row) => {
      const promoted = experimentGate.promotion_executed && experimentGate.promotion_target === row.model_id;
      const selected = row.role === 'challenger' ? Boolean(row.promotion_candidate) : row.role === 'champion';
      const status = promoted
        ? 'PROMOTED'
        : row.role === 'champion'
          ? 'BASELINE'
          : selected
            ? 'PROMOTION_CANDIDATE'
            : 'TRACKING';

      return {
        model_id: row.model_id,
        model_name: row.model_name,
        role: row.role,
        status: row.status || 'ACTIVE',
        lifecycle_state: status,
        hypothesis: inferExperimentHypothesis(row.model_name, row.role),
        evidence: {
          cagr: asNum(row.cagr),
          sharpe: asNum(row.sharpe),
          max_drawdown: asNum(row.max_drawdown),
          alpha_vs_benchmark: asNum(row.alpha_vs_benchmark),
          sample_n: asNum(row.sample_n) ?? asNum(backtest?.sample_n) ?? null,
          promotion_candidate: Boolean(row.promotion_candidate),
          decision_reason: row.decision_reason || '',
          backtest_winner: experimentGate.winner,
          backtest_reason: backtest?.reason || '',
        },
        promotion: {
          promotion_candidate: Boolean(row.promotion_candidate),
          promoted,
          winner: experimentGate.winner,
          blocked: row.role === 'challenger' ? (!experimentGate.promote_challenger || experimentGate.freeze_violation) : false,
        },
      };
    })
    .sort((a, b) => {
      if (a.role === b.role) return String(a.model_name).localeCompare(String(b.model_name));
      return a.role === 'champion' ? -1 : 1;
    });

  const seededProjects = (researchProjects || []).map((project) => ({
    model_id: project.id,
    model_name: project.name,
    role: project.category || 'research',
    status: project.status || 'TRACKING',
    lifecycle_state: 'RESEARCH',
    hypothesis: project.hypothesis,
    evidence: project.evidence,
    promotion: {
      promotion_candidate: false,
      promoted: false,
      winner: experimentGate.winner,
      blocked: false,
    },
    readiness: project.readiness || null,
    metrics: project.metrics || [],
    notes: project.notes || '',
  }));

  const combinedExperiments = [...experiments, ...seededProjects];
  const challengerCount = experiments.filter((exp) => exp.role === 'challenger').length;
  const promotedCount = combinedExperiments.filter((exp) => exp.promotion.promoted).length;
  const activeCount = combinedExperiments.filter((exp) => String(exp.status || '').toLowerCase() === 'active').length;
  const blockedCount = combinedExperiments.filter((exp) => String(exp.status || '').toLowerCase() === 'blocked').length;
  const readyCount = combinedExperiments.filter((exp) => Number(exp.readiness?.score) >= 0.75).length;

  return {
    as_of_date: asOfDate,
    summary: {
      experiment_count: combinedExperiments.length,
      champion_id: governance?.champion?.id || null,
      champion_name: governance?.champion?.name || null,
      challenger_count: challengerCount,
      research_project_count: seededProjects.length,
      active_count: activeCount,
      promoted_count: promotedCount,
      promotion_ready: experimentGate.promote_challenger,
      promotion_executed: experimentGate.promotion_executed,
      freeze_violation: experimentGate.freeze_violation,
      winner: experimentGate.winner,
      blocked_reason: experimentGate.reason,
    },
    meta: {
      source: rows.length ? 'model scorecard + research board + governance + backtest' : 'research board + governance/backtest fallback',
      experiment_count: combinedExperiments.length,
      active_count: activeCount,
      blocked_count: blockedCount,
      ready_count: readyCount,
    },
    gate: experimentGate,
    evidence: {
      backtest: {
        champion_cagr: asNum(backtest?.champion_cagr),
        challenger_cagr: asNum(backtest?.challenger_cagr),
        champion_sharpe: asNum(backtest?.champion_sharpe),
        challenger_sharpe: asNum(backtest?.challenger_sharpe),
        champion_max_drawdown: asNum(backtest?.champion_max_drawdown),
        challenger_max_drawdown: asNum(backtest?.challenger_max_drawdown),
        champion_alpha_vs_benchmark: asNum(backtest?.champion_alpha),
        challenger_alpha_vs_benchmark: asNum(backtest?.challenger_alpha),
        benchmark_mode: backtest?.benchmark_mode || 'N/A',
        sample_n: asNum(backtest?.sample_n) ?? null,
        threshold: asNum(backtest?.threshold) ?? null,
        hold_days: asNum(backtest?.hold_days) ?? null,
        as_of_date: backtest?.as_of_date || null,
        decision_reason: backtest?.reason || '',
      },
      forward: {
        closed_trades: asNum(forwardMonitor?.closed_count),
        open_trades: asNum(forwardMonitor?.open_count),
        avg_alpha_vs_expected_pct_points: asNum(forwardMonitor?.avg_alpha_vs_expected_pct_points),
        hit_rate_open: asNum(forwardMonitor?.hit_rate_open),
      },
      governance: {
        freeze_days: asNum(governance?.freeze_days),
        freeze_violation: Boolean(governance?.freeze_violation),
        last_change_date: governance?.last_change_date || '',
        change_count: asNum(governance?.change_count),
      },
    },
    experiments: combinedExperiments,
  };
}

function buildPlatformRoadmap() {
  return {
    active_focus: 'Backend data provider architecture for paper-traded longs',
    updated_by: 'Codex',
    phases: [
      {
        name: 'Secrets + provider bootstrap',
        status: 'in_progress',
        note: 'Local secrets file is in place. Provider env loading and the first market data client are now wired into benchmark and regime market-tape scripts.',
      },
      {
        name: 'Normalized market data layer',
        status: 'in_progress',
        note: 'Daily bars, quote/reference fetches, the growth-scan fundamentals path, and provider-backed event refreshes are now normalized behind shared clients with Polygon/Massive and Finnhub hooks plus Yahoo fallback. Finnhub news now backfills missing direct news coverage instead of double-counting it.',
      },
      {
        name: 'Paper long book',
        status: 'planned',
        note: 'Keep focus on long-only stock and ETF paper trading before adding options or broker automation.',
      },
      {
        name: 'Live console UX',
        status: 'planned',
        note: 'Add richer charts and live market views after the backend contracts are reliable.',
      },
      {
        name: 'Options sleeve',
        status: 'deferred',
        note: 'Treat options as a separate speculative sleeve after the long book is behaving well.',
      },
      {
        name: 'Broker connection',
        status: 'deferred',
        note: 'Only consider live execution after forward results, risk limits, and trade ticket flow are trustworthy.',
      },
    ],
    next_actions: [
      'Load .env.local safely from Node scripts.',
      'Add explicit source provenance and freshness tracking to nowcast inputs so GDELT and Finnhub backfill are visible in the console.',
      'Add caching and freshness metadata for provider-backed earnings and company news contracts.',
      'Replace the remaining yfinance-only fetch paths incrementally instead of all at once.',
      'Add caching so provider calls are reproducible and cheap across reruns.',
    ],
  };
}

async function buildDataProvenance(asOfDate) {
  await loadLocalEnv(root);
  const env = getProviderEnvSummary();
  const rows = await Promise.all([
    inspectContract({
      filePath: path.join(altDir, 'daily_market_context.csv'),
      label: 'Daily Market Context',
      sourceType: `market_data:${env.marketDataProvider}`,
      dateField: 'market_date',
      asOfDate,
      notes: 'Regime market tape built from normalized provider bars.',
    }),
    inspectContract({
      filePath: path.join(altDir, 'benchmark_returns.csv'),
      label: 'Benchmark Returns',
      sourceType: `market_data:${env.marketDataProvider}`,
      dateField: 'report_date',
      asOfDate,
      notes: 'Event-date benchmark context for backtests.',
    }),
    inspectContract({
      filePath: path.join(altDir, 'earnings_calendar.csv'),
      label: 'Earnings Calendar',
      sourceType: env.finnhub ? 'finnhub' : 'static/local',
      dateField: 'report_date',
      asOfDate,
      notes: 'Pipeline event risk gate input.',
    }),
    inspectContract({
      filePath: path.join(altDir, 'company_news.csv'),
      label: 'Company News',
      sourceType: env.finnhub ? 'finnhub' : 'missing_provider',
      dateField: 'published_at',
      asOfDate,
      notes: 'Provider-backed company news cache.',
    }),
    inspectContract({
      filePath: path.join(altDir, 'news_mentions.csv'),
      label: 'News Mentions',
      sourceType: 'gdelt+finnhub_backfill',
      dateField: 'date',
      asOfDate,
      notes: 'Direct nowcast news signal with provider backfill only where needed.',
    }),
    inspectContract({
      filePath: path.join(altDir, 'news_mentions_finnhub.csv'),
      label: 'Finnhub News Backfill',
      sourceType: env.finnhub ? 'finnhub' : 'missing_provider',
      dateField: 'date',
      asOfDate,
      notes: 'Backfill source for missing direct news coverage.',
    }),
    inspectContract({
      filePath: path.join(altDir, 'search_trends.csv'),
      label: 'Search Trends',
      sourceType: 'wikimedia',
      dateField: 'date',
      asOfDate,
      notes: 'Direct alternative-data coverage from Wikimedia pageviews.',
    }),
  ]);

  return {
    provider_env: env,
    summary: {
      fresh_count: rows.filter((row) => row.status === 'fresh').length,
      aging_count: rows.filter((row) => row.status === 'aging').length,
      stale_count: rows.filter((row) => row.status === 'stale').length,
      missing_count: rows.filter((row) => row.status === 'missing').length,
    },
    rows,
  };
}

async function loadRobinhoodSnapshot() {
  try {
    return await readJson(path.join(tradingDir, 'data', 'portfolio', 'robinhood_snapshot.json'));
  } catch {
    return null;
  }
}

export async function run() {
  const asOfDate = todayDate('America/New_York');
  const dataProvenance = await buildDataProvenance(asOfDate);
  const profile = await readJson(path.join(tradingDir, 'config', 'profile.json'));
  const portfolioConstraints = await readJson(path.join(tradingDir, 'config', 'portfolio_constraints.json'));
  const regimePolicy = await loadRegimePolicy();
  const positions = await readCsv(path.join(tradingDir, 'data', 'positions.csv'));
  let crypto = [];
  try {
    crypto = await readCsv(path.join(tradingDir, 'data', 'crypto_positions.csv'));
  } catch {
    crypto = [];
  }

  const ideasDir = path.join(tradingDir, 'ideas');
  const reportsDir = path.join(tradingDir, 'reports');
  const outputDir = path.join(tradingDir, 'output');
  const ranksDir = path.join(tradingDir, 'data', 'ranks');
  const featuresDir = path.join(tradingDir, 'data', 'features');

  const latestFinal = await loadLatestCsv(ideasDir, /-final-top\d+\.csv$/);
  const latestIdeas = latestFinal.file ? latestFinal : await loadLatestCsv(ideasDir, /-top\d+-ideas\.csv$/);
  const recentFinalIdeas = await loadRecentMatchingCsvs(ideasDir, /-final-top\d+\.csv$/, 40);
  const latestTrim = await loadLatestCsv(reportsDir, /-trim-plan\.csv$/);
  const latestNowcast = await loadLatestCsv(outputDir, /-alt-nowcast-top20\.csv$/);
  const latestRanks = await loadLatestCsv(ranksDir, /latest_ranks\.csv$/);
  const latestFeatures = await loadLatestCsv(featuresDir, /latest_features\.csv$/);

  const latestRegime = await loadLatestCsv(path.join(tradingDir, 'data', 'regime'), /latest_regime\.csv$/);
  const latestQuality = await loadLatestCsv(path.join(tradingDir, 'data', 'quality'), /latest_signal_quality\.csv$/);
  const latestTargets = await loadLatestCsv(path.join(tradingDir, 'data', 'portfolio'), /latest_target_weights\.csv$/);
  const latestTradePlan = await loadLatestCsv(path.join(tradingDir, 'data', 'execution'), /latest_trade_plan\.csv$/);
  const latestScorecard = await loadLatestCsv(path.join(tradingDir, 'data', 'scorecard'), /latest_model_scorecard\.csv$/);
  const latestBucket = await loadLatestCsv(path.join(tradingDir, 'buckets'), /-growth-bucket\.csv$/);
  const alphaModel = await readJson(path.join(tradingDir, 'config', 'alpha_model.json'));

  const cryptoAlerts = await loadCryptoAlertSummary(reportsDir);
  const backtest = await loadBacktestSummary();
  const rollingAlpha = await loadRollingAlpha();
  const governance = await loadGovernanceSummary();
  const forwardMonitor = await loadForwardMonitor(profile?.timezone || 'America/New_York');
  const postmortemShelf = buildPostmortemShelf(forwardMonitor.ledger_rows || []);

  const equitiesTotal = sum(positions.map((p) => asNum(p.equity) || 0));
  const cryptoTotal = sum(crypto.map((p) => asNum(p.equity) || 0));
  const cash = asNum(profile?.allocation?.cash_usd) || 0;
  const accountSize = asNum(profile?.investor_profile?.account_size_usd) || (equitiesTotal + cryptoTotal + cash);

  const trimRows = latestTrim.rows;
  const trimCandidates = trimRows.filter((r) => (r.action || '').toUpperCase() === 'TRIM');
  const trimCash = sum(trimCandidates.map((r) => asNum(r.est_cash_out) || 0));
  const trimBySymbol = new Map(trimRows.map((r) => [String(r.symbol || '').toUpperCase(), r]));

  const topIdeas = latestIdeas.rows.map((r) => ({
    symbol: r.symbol,
    adjusted_score: asNum(r.final_alpha_score) ?? asNum(r.adjusted_score),
    confidence: asNum(r.confidence),
    expected_kpi: r.expected_kpi_surprise || r.expected_kpi,
    risk_note: r.why_risky || r.gate_reason,
    strongest_drivers: r.strongest_drivers,
    expected_alpha_20d: r.expected_alpha_20d || null,
    expected_alpha_90d: r.expected_alpha_90d || null,
    entry_zone: r.entry_zone || null,
    invalidation: r.invalidation || null,
    max_position_size_usd: asNum(r.max_position_size_usd),
    options_overlay: r.options_overlay || null,
  }));

  const currentIdeasBySymbol = buildTickerMap(topIdeas, 'symbol');
  const previousIdeasSnapshot = recentFinalIdeas.length > 1 ? recentFinalIdeas[1] : null;
  const ideaMemoryBySymbol = buildIdeaMemoryMap(recentFinalIdeas, forwardMonitor.ledger_rows || []);
  const previousIdeaRows = (previousIdeasSnapshot?.rows || []).map((r) => ({
    symbol: String(r.symbol || '').toUpperCase(),
    final_alpha_score: asNum(r.final_alpha_score),
    entry_zone: r.entry_zone || '',
    expected_alpha_20d: parsePctString(r.expected_alpha_20d),
    expected_alpha_90d: parsePctString(r.expected_alpha_90d),
  }));
  const previousIdeasBySymbol = buildTickerMap(previousIdeaRows, 'symbol');

  const earningsCalendarRows = await readCsv(path.join(tradingDir, 'data', 'alt', 'earnings_calendar.csv')).catch(() => []);
  const consensusRows = await readCsv(path.join(tradingDir, 'data', 'alt', 'consensus_estimates.csv')).catch(() => []);

  const nowcastTop = latestNowcast.rows.slice(0, 20).map((r) => ({
    company: r.company,
    ticker: r.ticker,
    strongest_drivers: r.strongest_drivers,
    source_provenance_summary: r.source_provenance_summary || '',
    confidence_score: asNum(r.confidence_score),
    source_mix: r.source_mix || '',
    direct_source_count: asNum(r.direct_source_count),
    proxy_source_count: asNum(r.proxy_source_count),
    proxy_share: parsePctString(r.proxy_share),
    website_traffic_yoy: r.website_traffic_yoy || '',
    app_rank_yoy: r.app_rank_yoy || '',
    search_trends_yoy: r.search_trends_yoy || '',
    search_trends_provenance: r.search_trends_provenance || '',
    news_mentions_yoy: r.news_mentions_yoy || '',
    news_mentions_provenance: r.news_mentions_provenance || '',
    price_promo_yoy: r.price_promo_yoy || '',
    price_promo_provenance: r.price_promo_provenance || '',
    foot_traffic_yoy: r.foot_traffic_yoy || '',
    foot_traffic_provenance: r.foot_traffic_provenance || '',
    website_traffic_provenance: r.website_traffic_provenance || '',
    app_rank_provenance: r.app_rank_provenance || '',
    market_price_proxy_yoy: r.market_price_proxy_yoy || '',
    market_price_proxy_provenance: r.market_price_proxy_provenance || '',
    market_volume_proxy_yoy: r.market_volume_proxy_yoy || '',
    market_volume_proxy_provenance: r.market_volume_proxy_provenance || '',
    expected_kpi_surprise: r.expected_kpi_surprise,
    expected_stock_reaction: r.expected_stock_reaction,
    historical_backtest: r.historical_backtest,
  }));

  const directSourceLeaderboard = latestNowcast.rows
    .map((r) => {
      const directSignals = [
        { label: 'Search Trends', value: parsePctString(r.search_trends_yoy) },
        { label: 'News Mentions', value: parsePctString(r.news_mentions_yoy) },
        { label: 'Website Traffic', value: parsePctString(r.website_traffic_yoy) },
        { label: 'App Rank', value: parsePctString(r.app_rank_yoy) },
        { label: 'Price / Promo', value: parsePctString(r.price_promo_yoy) },
        { label: 'Foot Traffic', value: parsePctString(r.foot_traffic_yoy) },
      ].filter((signal) => signal.value != null);

      const avgAbsDirectSignal = directSignals.length
        ? sum(directSignals.map((signal) => Math.abs(signal.value))) / directSignals.length
        : null;

      const bestDirectSignal = directSignals
        .slice()
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0] || null;

      const directSignalScore = (
        ((asNum(r.direct_source_count) ?? 0) * 0.35) +
        ((asNum(r.confidence_score) ?? 0) * 0.30) +
        (((avgAbsDirectSignal ?? 0) / 100) * 0.45) +
        ((r.source_mix || '') === 'direct' ? 0.12 : 0) -
        ((asNum(r.proxy_source_count) ?? 0) * 0.05)
      );

      return {
        ticker: r.ticker,
        source_mix: r.source_mix || '',
        direct_source_count: asNum(r.direct_source_count) ?? 0,
        proxy_source_count: asNum(r.proxy_source_count) ?? 0,
        confidence_score: asNum(r.confidence_score),
        expected_kpi_surprise: r.expected_kpi_surprise || '',
        strongest_drivers: r.strongest_drivers || '',
        direct_signal_score: Number(directSignalScore.toFixed(3)),
        avg_abs_direct_signal_pct: avgAbsDirectSignal == null ? null : Number(avgAbsDirectSignal.toFixed(2)),
        best_direct_signal_label: bestDirectSignal?.label || '',
        best_direct_signal_value: bestDirectSignal?.value == null ? null : Number(bestDirectSignal.value.toFixed(2)),
      };
    })
    .filter((r) => r.direct_source_count > 0)
    .sort((a, b) => (b.direct_signal_score ?? 0) - (a.direct_signal_score ?? 0))
    .slice(0, 12);

  const alphaTop = latestRanks.rows.slice(0, 20).map((r) => ({
    ticker: r.ticker,
    rank: asNum(r.rank),
    final_alpha_score: asNum(r.final_alpha_score),
    confidence: asNum(r.confidence),
    strongest_drivers: r.strongest_drivers,
    eligible: String(r.eligible || '').toLowerCase() !== 'false',
    gate_reason: r.gate_reason || '',
  }));

  const eligibleCount = latestFeatures.rows.filter((r) => String(r.eligible || '').toLowerCase() !== 'false').length;
  const avgConfidence = latestFeatures.rows.length
    ? sum(latestFeatures.rows.map((r) => asNum(r.confidence) || 0)) / latestFeatures.rows.length
    : null;

  const exp20Vals = topIdeas.map((r) => parsePctString(r.expected_alpha_20d)).filter((v) => v != null);
  const exp90Vals = topIdeas.map((r) => parsePctString(r.expected_alpha_90d)).filter((v) => v != null);

  const avgExp20 = exp20Vals.length ? sum(exp20Vals) / exp20Vals.length : null;
  const avgExp90 = exp90Vals.length ? sum(exp90Vals) / exp90Vals.length : null;

  const factorAttribution = aggregateDrivers(topIdeas);

  const qualityRows = latestQuality.rows;
  const avgSignalQualityPenalty = qualityRows.length
    ? sum(qualityRows.map((r) => asNum(r.quality_penalty) || 0)) / qualityRows.length
    : null;

  const avgEffectiveConfidence = qualityRows.length
    ? sum(qualityRows.map((r) => asNum(r.effective_confidence) || 0)) / qualityRows.length
    : null;

  const regime = latestRegime.rows[0] || null;
  const activeRegimeId = regime?.regime_id || 'risk_on';
  const activeTilt = regimePolicy?.factor_tilts?.[activeRegimeId] || {};

  const tradePlanRows = latestTradePlan.rows;
  const tradeCostUsd = sum(tradePlanRows.map((r) => asNum(r.est_cost_usd) || 0));
  const tradeNotionalUsd = sum(tradePlanRows.map((r) => Math.abs(asNum(r.trade_notional_usd) || 0)));

  const targets = latestTargets.rows.map((r) => ({
    ticker: r.ticker,
    target_weight: asNum(r.target_weight),
    regime_tilt_score: asNum(r.regime_tilt_score),
    risk_adjusted_score: asNum(r.risk_adjusted_score),
    sector_bucket: r.sector_bucket,
    sub_industry: r.sub_industry || '',
    flags: r.constraint_flags,
  }));

  const scorecard = latestScorecard.rows.map((r) => ({
    model_id: r.model_id,
    model_name: r.model_name,
    role: r.role,
    status: r.status,
    cagr: asNum(r.cagr),
    sharpe: asNum(r.sharpe),
    max_drawdown: asNum(r.max_drawdown),
    alpha_vs_benchmark: asNum(r.alpha_vs_benchmark),
    promotion_candidate: String(r.promotion_candidate || '').toLowerCase() === 'true',
  }));

  const currentAsOfDate = todayDate(profile?.timezone || 'America/New_York');
  const nowcastAblation = buildNowcastAblation({
    featuresRows: latestFeatures.rows,
    ranksRows: latestRanks.rows,
    weights: alphaModel?.weights || {},
    asOfDate: currentAsOfDate,
  });
  const factorTournament = buildFactorTournament({
    featuresRows: latestFeatures.rows,
    ranksRows: latestRanks.rows,
    weights: alphaModel?.weights || {},
    asOfDate: currentAsOfDate,
  });
  const earningsDriftLab = buildEarningsDriftLab({
    featuresRows: latestFeatures.rows,
    outcomesRows: await readCsv(path.join(tradingDir, 'data', 'alt', 'earnings_outcomes.csv')).catch(() => []),
    consensusRows,
    earningsRows: earningsCalendarRows,
    forwardRows: forwardMonitor.ledger_rows || [],
    asOfDate: currentAsOfDate,
  });
  const researchProjects = buildResearchProjects({
    asOfDate: currentAsOfDate,
    featureRows: latestFeatures.rows,
    rankRows: latestRanks.rows,
    bucketRows: latestBucket.rows,
    nowcastRows: latestNowcast.rows,
    qualityRows,
    topIdeas,
    forwardMonitor,
    regime,
    nowcastAblation,
    factorTournament,
    earningsDriftLab,
  });

  const alphaLab = buildAlphaLab({
    scorecardRows: scorecard,
    governance,
    backtest,
    forwardMonitor,
    asOfDate: currentAsOfDate,
    researchProjects,
  });

  const sectorMap = portfolioConstraints?.sector_map || {};
  const currentPositionRows = positions.map((p) => {
    const equity = asNum(p.equity) || 0;
    const weight = accountSize > 0 ? equity / accountSize : 0;
    const sector = normalizeSector(p.symbol, p.name, sectorMap);
    const subIndustry = normalizeSubIndustry(p.symbol, p.name, sectorMap);
    const displaySector = displaySectorLabel(sector, subIndustry);
    const betaProxy = betaProxyForPosition(p, sector);
    return {
      name: p.name,
      symbol: String(p.symbol || '').toUpperCase(),
      equity,
      weight,
      sector: displaySector,
      base_sector: sector,
      sub_industry: subIndustry,
      beta_proxy: betaProxy,
      return_pct: equity > 0 ? ((asNum(p.total_return) || 0) / equity) : null,
    };
  }).sort((a, b) => b.weight - a.weight);

  const sectorExposureMap = new Map();
  for (const row of currentPositionRows) {
    const current = sectorExposureMap.get(row.sector) || { sector: row.sector, equity: 0, weight: 0, names: 0 };
    current.equity += row.equity;
    current.weight += row.weight;
    current.names += 1;
    sectorExposureMap.set(row.sector, current);
  }

  const subIndustryExposureMap = new Map();
  for (const row of currentPositionRows) {
    const current = subIndustryExposureMap.get(row.sub_industry) || { sub_industry: row.sub_industry, equity: 0, weight: 0, names: 0 };
    current.equity += row.equity;
    current.weight += row.weight;
    current.names += 1;
    subIndustryExposureMap.set(row.sub_industry, current);
  }

  const sectorExposure = [...sectorExposureMap.values()].sort((a, b) => b.weight - a.weight);
  const subIndustryExposure = [...subIndustryExposureMap.values()].sort((a, b) => b.weight - a.weight);
  const etfExposureSummary = {
    country_etf_pct: pct(sectorExposure.find((row) => row.sector === 'COUNTRY_ETF')?.weight || 0),
    thematic_etf_pct: pct(sectorExposure.find((row) => row.sector === 'THEMATIC_ETF')?.weight || 0),
    sector_etf_pct: pct(sectorExposure.find((row) => row.sector === 'SECTOR_ETF')?.weight || 0),
    leveraged_etf_pct: pct(sectorExposure.find((row) => row.sector === 'LEVERAGED_ETF')?.weight || 0),
  };
  const topWeights = currentPositionRows.map((r) => r.weight);
  const weightedBeta = currentPositionRows.reduce((acc, row) => acc + (row.weight * row.beta_proxy), 0);
  const cashWeight = accountSize > 0 ? cash / accountSize : 0;
  const equityWeight = accountSize > 0 ? equitiesTotal / accountSize : 0;
  const cryptoWeight = accountSize > 0 ? cryptoTotal / accountSize : 0;

  const top5Weight = topWeights.slice(0, 5).reduce((a, b) => a + b, 0);
  const maxSingleNameWeight = topWeights[0] || 0;
  const maxSectorWeight = sectorExposure[0]?.weight || 0;
  const concentrationHhi = herfindahlIndex(topWeights);

  const currentWeightByTicker = new Map(currentPositionRows.map((r) => [r.symbol, r.weight]));
  const subIndustryByTicker = new Map(currentPositionRows.map((r) => [r.symbol, r.sub_industry]));
  const targetDrift = targets
    .map((row) => {
      const currentWeight = currentWeightByTicker.get(String(row.ticker || '').toUpperCase()) || 0;
      const targetWeight = asNum(row.target_weight) || 0;
      return {
        ticker: row.ticker,
        current_weight: currentWeight,
        target_weight: targetWeight,
        drift: targetWeight - currentWeight,
        sector_bucket: row.sector_bucket,
      };
    })
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
  const targetDriftByTicker = new Map(targetDrift.map((row) => [String(row.ticker || '').toUpperCase(), row]));
  const targetSubIndustryByTicker = new Map(
    targets.map((row) => [String(row.ticker || '').toUpperCase(), String(row.sub_industry || '')]),
  );

  const currentSubIndustryWeights = new Map();
  for (const row of currentPositionRows) {
    currentSubIndustryWeights.set(
      row.sub_industry,
      (currentSubIndustryWeights.get(row.sub_industry) || 0) + (row.weight || 0),
    );
  }

  const targetSubIndustryWeights = new Map();
  for (const row of targets) {
    const subIndustry = String(row.sub_industry || 'UNKNOWN');
    const targetWeight = asNum(row.target_weight) || 0;
    targetSubIndustryWeights.set(
      subIndustry,
      (targetSubIndustryWeights.get(subIndustry) || 0) + targetWeight,
    );
  }

  const subIndustryDrift = [
    ...new Set([
      ...currentSubIndustryWeights.keys(),
      ...targetSubIndustryWeights.keys(),
    ]),
  ]
    .map((subIndustry) => {
      const currentWeight = currentSubIndustryWeights.get(subIndustry) || 0;
      const targetWeight = targetSubIndustryWeights.get(subIndustry) || 0;
      return {
        sub_industry: subIndustry,
        current_weight: currentWeight,
        target_weight: targetWeight,
        drift: targetWeight - currentWeight,
      };
    })
    .filter((row) => Math.abs(row.drift) > 0.0001)
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
  const subIndustryDriftByName = new Map(subIndustryDrift.map((row) => [String(row.sub_industry || ''), row]));

  const rotationRecommendations = [];
  const minTrimWeight = 0.005;
  const minTrimCashOut = 25;
  const minRotationWeight = 0.01;
  const minAddDrift = 0.03;
  const maxRotationRows = 12;

  for (const row of currentPositionRows) {
    const drift = targetDriftByTicker.get(row.symbol);
    const trim = trimBySymbol.get(row.symbol);
    const subDrift = subIndustryDriftByName.get(row.sub_industry);
    const currentWeight = row.weight || 0;
    const targetWeight = drift?.target_weight || 0;
    const tickerDrift = drift?.drift || 0;
    const subIndustryDelta = subDrift?.drift || 0;
    const shouldHarvest = (trim?.action || '').toUpperCase() === 'TRIM';
    const shouldTrimToModel = tickerDrift < -0.01;
    const shouldRotate = subIndustryDelta < -0.015;
    const estCashOut = asNum(trim?.est_cash_out) || 0;
    const meaningfulHarvest = shouldHarvest && (currentWeight >= minTrimWeight || estCashOut >= minTrimCashOut);
    const meaningfulTrimToModel = shouldTrimToModel && currentWeight >= minTrimWeight;
    const meaningfulRotate = shouldRotate && currentWeight >= minRotationWeight;

    if (!(meaningfulHarvest || meaningfulTrimToModel || meaningfulRotate)) continue;

    const reasons = [];
    let action = 'REVIEW';
    if (meaningfulHarvest) reasons.push(trim.reason || 'Gain-based trim threshold hit');
    if (meaningfulTrimToModel) reasons.push(`Model target below current weight by ${((Math.abs(tickerDrift)) * 100).toFixed(2)} pts`);
    if (meaningfulRotate) reasons.push(`Sub-industry drift negative (${(subIndustryDelta * 100).toFixed(2)} pts)`);

    if (meaningfulHarvest && meaningfulRotate) action = 'TRIM_AND_ROTATE';
    else if (meaningfulTrimToModel) action = 'TRIM_TO_TARGET';
    else if (meaningfulHarvest) action = 'HARVEST_TRIM';
    else if (meaningfulRotate) action = 'ROTATE_OUT';

    const score = Math.abs(tickerDrift) + Math.abs(subIndustryDelta) + (meaningfulHarvest ? 0.03 : 0);
    rotationRecommendations.push({
      symbol: row.symbol,
      action,
      current_weight_pct: pct(currentWeight),
      target_weight_pct: pct(targetWeight),
      drift_pct_points: Number((tickerDrift * 100).toFixed(2)),
      sub_industry: row.sub_industry,
      est_cash_out: estCashOut || null,
      reason: reasons.join(' | '),
      score,
    });
  }

  for (const row of targetDrift) {
    if ((row.current_weight || 0) > 0) continue;
    if ((row.drift || 0) < minAddDrift) continue;
    rotationRecommendations.push({
      symbol: row.ticker,
      action: 'ADD',
      current_weight_pct: pct(row.current_weight),
      target_weight_pct: pct(row.target_weight),
      drift_pct_points: Number(((row.drift || 0) * 100).toFixed(2)),
      sub_industry: targetSubIndustryByTicker.get(String(row.ticker || '').toUpperCase()) || '',
      est_cash_out: null,
      reason: `Model wants new exposure of ${(((row.drift || 0) * 100)).toFixed(2)} pts`,
      score: Math.abs(row.drift || 0),
    });
  }

  rotationRecommendations.sort((a, b) => (b.score || 0) - (a.score || 0));
  const addCandidates = rotationRecommendations.filter((row) => row.action === 'ADD');
  const rotationTrimRows = rotationRecommendations.filter((row) => row.action !== 'ADD');
  for (let i = 0; i < rotationTrimRows.length; i += 1) {
    const target = addCandidates.length ? addCandidates[i % addCandidates.length] : null;
    rotationTrimRows[i].rotation_target_symbol = target?.symbol || '';
    rotationTrimRows[i].rotation_target_sub_industry = target?.sub_industry || '';
    rotationTrimRows[i].rotation_target_reason = target
      ? `Rotate toward ${target.symbol} (${target.target_weight_pct}% target)`
      : '';
  }
  for (const row of addCandidates) {
    row.rotation_target_symbol = '';
    row.rotation_target_sub_industry = '';
    row.rotation_target_reason = '';
  }
  const finalRotationRecommendations = rotationRecommendations.slice(0, maxRotationRows);

  const limitFlags = [];
  if (maxSingleNameWeight > Number(portfolioConstraints?.max_single_name_weight ?? 1)) limitFlags.push('SINGLE_NAME_LIMIT');
  if (maxSectorWeight > Number(portfolioConstraints?.max_sector_weight ?? 1)) limitFlags.push('SECTOR_LIMIT');
  if (weightedBeta > Number(portfolioConstraints?.max_beta_exposure ?? 99)) limitFlags.push('BETA_LIMIT');
  if (cashWeight < Number(portfolioConstraints?.min_cash_buffer ?? 0)) limitFlags.push('CASH_FLOOR');

  const heldSymbols = new Set(currentPositionRows.map((r) => r.symbol));
  const ideaSymbols = new Set(topIdeas.map((r) => String(r.symbol || '').toUpperCase()).filter(Boolean));
  const consensusByTicker = buildTickerMap(consensusRows, 'ticker');

  const catalystEvents = [];

  for (const row of earningsCalendarRows) {
    const symbol = String(row.ticker || '').toUpperCase();
    const eventDate = row.report_date || '';
      const daysUntil = daysBetweenUtc(currentAsOfDate, eventDate);
    if (!symbol || !eventDate || daysUntil == null || daysUntil < 0 || daysUntil > 90) continue;

    const scope = heldSymbols.has(symbol) ? 'holding' : (ideaSymbols.has(symbol) ? 'idea' : 'watch');
    const consensus = consensusByTicker.get(symbol) || {};
    catalystEvents.push({
      date: eventDate,
      days_until: daysUntil,
      symbol,
      category: 'earnings',
      scope,
      severity: daysUntil <= 7 ? 'high' : (daysUntil <= 21 ? 'medium' : 'low'),
      headline: `${symbol} earnings report`,
      note: consensus.consensus_revenue_growth_yoy
        ? `Consensus rev growth ${consensus.consensus_revenue_growth_yoy}`
        : 'No linked consensus growth field',
    });
  }

  if (governance?.last_change_date && governance?.freeze_days != null) {
    const unlockDate = addDaysUtc(governance.last_change_date, governance.freeze_days);
    const daysUntil = daysBetweenUtc(asOfDate, unlockDate);
    if (unlockDate && daysUntil != null && daysUntil >= 0 && daysUntil <= 90) {
      catalystEvents.push({
        date: unlockDate,
        days_until: daysUntil,
        symbol: 'MODEL',
        category: 'governance',
        scope: 'system',
        severity: daysUntil <= 7 ? 'medium' : 'low',
        headline: 'Weekly weight freeze unlock',
        note: 'Next date weights can be changed without violating freeze policy',
      });
    }
  }

  for (const row of (forwardMonitor.open_trade_rows || [])) {
    const symbol = String(row.symbol || '').toUpperCase();
    const daysOpen = asNum(row.days_open);
    if (!symbol || daysOpen == null) continue;

    const reviewDate = addDaysUtc(asOfDate, 20 - daysOpen);
    const closeDate = addDaysUtc(asOfDate, (forwardMonitor.policy?.close_after_days ?? 90) - daysOpen);
    const reviewDays = daysBetweenUtc(asOfDate, reviewDate);
    const closeDays = daysBetweenUtc(asOfDate, closeDate);

    if (reviewDate && reviewDays != null && reviewDays >= 0 && reviewDays <= 90) {
      catalystEvents.push({
        date: reviewDate,
        days_until: reviewDays,
        symbol,
        category: 'forward_review',
        scope: 'paper_trade',
        severity: reviewDays <= 7 ? 'medium' : 'low',
        headline: `${symbol} 20-day forward review`,
        note: 'First performance checkpoint versus expected alpha curve',
      });
    }

    if (closeDate && closeDays != null && closeDays >= 0 && closeDays <= 90) {
      catalystEvents.push({
        date: closeDate,
        days_until: closeDays,
        symbol,
        category: 'forward_close',
        scope: 'paper_trade',
        severity: closeDays <= 7 ? 'medium' : 'low',
        headline: `${symbol} forward close window`,
        note: `Policy close-after-days = ${forwardMonitor.policy?.close_after_days ?? 90}`,
      });
    }
  }

  catalystEvents.sort((a, b) => {
    const dateCmp = String(a.date).localeCompare(String(b.date));
    if (dateCmp !== 0) return dateCmp;
    return String(a.symbol).localeCompare(String(b.symbol));
  });

  const catalystCalendar = {
    as_of_date: asOfDate,
    upcoming_7d: catalystEvents.filter((e) => e.days_until <= 7).length,
    upcoming_30d: catalystEvents.filter((e) => e.days_until <= 30).length,
    earnings_count: catalystEvents.filter((e) => e.category === 'earnings').length,
    forward_checkpoints_count: catalystEvents.filter((e) => e.category.startsWith('forward_')).length,
    events: catalystEvents.slice(0, 40),
  };

  const currentSymbols = topIdeas.map((r) => String(r.symbol || '').toUpperCase()).filter(Boolean);
  const previousSymbols = previousIdeaRows.map((r) => String(r.symbol || '').toUpperCase()).filter(Boolean);
  const addedSymbols = currentSymbols.filter((symbol) => !previousSymbols.includes(symbol));
  const removedSymbols = previousSymbols.filter((symbol) => !currentSymbols.includes(symbol));

  const scoreChanges = currentSymbols.map((symbol) => {
    const current = currentIdeasBySymbol.get(symbol) || {};
    const previous = previousIdeasBySymbol.get(symbol) || {};
    const currentScore = asNum(current.adjusted_score);
    const previousScore = asNum(previous.final_alpha_score);
    const current20 = parsePctString(current.expected_alpha_20d);
    const previous20 = asNum(previous.expected_alpha_20d);
    return {
      symbol,
      current_score: currentScore,
      previous_score: previousScore,
      score_delta: currentScore != null && previousScore != null ? currentScore - previousScore : null,
      current_entry_zone: current.entry_zone || '',
      previous_entry_zone: previous.entry_zone || '',
      entry_changed: String(current.entry_zone || '') !== String(previous.entry_zone || ''),
      current_expected_alpha_20d: current20,
      previous_expected_alpha_20d: previous20,
      expected_alpha_20d_delta: current20 != null && previous20 != null ? current20 - previous20 : null,
    };
  }).sort((a, b) => Math.abs(b.score_delta ?? 0) - Math.abs(a.score_delta ?? 0));

  const runChanges = {
    current_file: latestIdeas.file,
    previous_file: previousIdeasSnapshot?.file || null,
    current_as_of: topIdeas[0]?.date || asOfDate,
    previous_as_of: previousIdeaRows[0]?.date || null,
    lineup_changed: addedSymbols.length > 0 || removedSymbols.length > 0,
    added_symbols: addedSymbols,
    removed_symbols: removedSymbols,
    score_changes: scoreChanges,
  };

  const featureByTicker = buildTickerMap(latestFeatures.rows, 'ticker');
  const rankByTicker = buildTickerMap(latestRanks.rows, 'ticker');
  const topIdeaByTicker = buildTickerMap(topIdeas, 'symbol');
  const qualityByTicker = buildTickerMap(qualityRows, 'ticker');
  const targetByTicker = buildTickerMap(latestTargets.rows, 'ticker');
  const executionByTicker = buildTickerMap(tradePlanRows, 'ticker');
  const forwardByTicker = buildTickerMap(forwardMonitor.open_rows, 'symbol');
  const nowcastByTicker = buildTickerMap(nowcastTop, 'ticker');
  const bucketByTicker = buildTickerMap(latestBucket.rows, 'symbol');

  const drilldownSymbols = [
    ...new Set([
      ...topIdeas.map((r) => String(r.symbol || '').toUpperCase()),
      ...alphaTop.map((r) => String(r.ticker || '').toUpperCase()),
    ].filter(Boolean)),
  ];

  const ideaDrilldowns = drilldownSymbols.map((symbol) => {
    const feature = featureByTicker.get(symbol) || {};
    const rank = rankByTicker.get(symbol) || {};
    const idea = topIdeaByTicker.get(symbol) || {};
    const quality = qualityByTicker.get(symbol) || {};
    const target = targetByTicker.get(symbol) || {};
    const execution = executionByTicker.get(symbol) || {};
    const forward = forwardByTicker.get(symbol) || {};
    const nowcast = nowcastByTicker.get(symbol) || {};
    const bucket = bucketByTicker.get(symbol) || {};
    const memory = ideaMemoryBySymbol.get(symbol) || null;

    const factorScores = [
      { factor: 'quality', score: asNum(feature.quality_score) },
      { factor: 'growth', score: asNum(feature.growth_score) },
      { factor: 'alt_momentum', score: asNum(feature.alt_momentum_score) },
      { factor: 'peer_relative', score: asNum(feature.peer_relative_score) },
      { factor: 'proxy_inferred', score: asNum(feature.proxy_inferred_score) },
      { factor: 'value', score: asNum(feature.value_score) },
      { factor: 'pead', score: asNum(feature.pead_score) },
    ].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

    return {
      symbol,
      rank: asNum(rank.rank),
      eligible: String(rank.eligible || '').toLowerCase() !== 'false',
      gate_reason: rank.gate_reason || '',
      final_alpha_score: asNum(rank.final_alpha_score),
      risk_adjusted_score: asNum(target.risk_adjusted_score),
      confidence: asNum(rank.confidence),
      effective_confidence: asNum(quality.effective_confidence),
      confidence_components: {
        fundamental_confidence: asNum(feature.fundamental_confidence),
        value_confidence: asNum(feature.value_confidence),
        alt_confidence: asNum(feature.alt_confidence),
        peer_confidence: asNum(feature.peer_confidence),
        proxy_confidence: asNum(feature.proxy_confidence),
        structural_anomaly_penalty: asNum(feature.structural_anomaly_penalty),
        valuation_context_strength: asNum(feature.valuation_context_strength),
        valuation_method_strength: asNum(feature.valuation_method_strength),
      },
      confidence_snapshot: [
        `F ${asNum(feature.fundamental_confidence) == null ? '-' : asNum(feature.fundamental_confidence).toFixed(2)}`,
        `V ${asNum(feature.value_confidence) == null ? '-' : asNum(feature.value_confidence).toFixed(2)}`,
        `A ${asNum(feature.alt_confidence) == null ? '-' : asNum(feature.alt_confidence).toFixed(2)}`,
        `P ${asNum(feature.peer_confidence) == null ? '-' : asNum(feature.peer_confidence).toFixed(2)}`,
        `X ${asNum(feature.proxy_confidence) == null ? '-' : asNum(feature.proxy_confidence).toFixed(2)}`,
      ].join(' | '),
      strongest_drivers: idea.strongest_drivers || rank.strongest_drivers || '',
      expected_alpha_20d: parsePctString(idea.expected_alpha_20d),
      expected_alpha_90d: parsePctString(idea.expected_alpha_90d),
      expected_stock_reaction: feature.expected_stock_reaction || nowcast.expected_stock_reaction || '',
      historical_backtest: feature.historical_backtest || nowcast.historical_backtest || '',
      regime: regime ? {
        regime_id: regime.regime_id,
        regime_confidence: asNum(regime.regime_confidence),
        recommended_gross_exposure: asNum(regime.recommended_gross_exposure),
      } : null,
      factor_scores: factorScores,
      quality: {
        coverage_score: asNum(quality.coverage_score),
        staleness_score: asNum(quality.staleness_score),
        cross_source_agreement: asNum(quality.cross_source_agreement),
        source_integrity_score: asNum(quality.source_integrity_score),
        quality_penalty: asNum(quality.quality_penalty),
      },
      fundamentals: {
        revenue_cagr_3y: asNum(feature.revenue_cagr_3y),
        fcf_cagr_3y: asNum(feature.fcf_cagr_3y),
        roic: asNum(feature.roic),
        fcf_margin: asNum(feature.fcf_margin),
        asset_turnover: asNum(feature.asset_turnover),
        debt_to_ebitda: asNum(feature.debt_to_ebitda),
        value_score: asNum(feature.value_score),
        valuation_score_raw: asNum(feature.valuation_score_raw),
        forward_pe: asNum(bucket.forward_pe),
        trailing_pe: asNum(bucket.trailing_pe),
        price_to_sales: asNum(bucket.price_to_sales),
        enterprise_to_ebitda: asNum(bucket.enterprise_to_ebitda),
        enterprise_to_revenue: asNum(bucket.enterprise_to_revenue),
        fcf_yield: asNum(bucket.fcf_yield),
        valuation_method: bucket.valuation_method || '',
        sector: bucket.sector || '',
        industry: bucket.industry || '',
        next_earnings_date: feature.next_earnings_date || '',
        days_to_earnings: asNum(feature.days_to_earnings),
        pead_score: asNum(feature.pead_score),
        pead_raw: asNum(feature.pead_raw),
      },
      execution: {
        entry_zone: idea.entry_zone || '',
        invalidation: idea.invalidation || '',
        max_position_size_usd: asNum(idea.max_position_size_usd),
        target_weight: asNum(target.target_weight),
        regime_tilt_score: asNum(target.regime_tilt_score),
        sector_bucket: target.sector_bucket || '',
        sub_industry: normalizeSubIndustry(symbol, feature.company || feature.name || symbol, portfolioConstraints?.sector_map || {}),
        constraint_flags: target.constraint_flags || target.flags || '',
        action: execution.action || '',
        shares_delta: asNum(execution.shares_delta),
        trade_notional_usd: asNum(execution.trade_notional_usd),
        est_slippage_bps: asNum(execution.est_slippage_bps),
        est_cost_usd: asNum(execution.est_cost_usd),
        options_overlay: idea.options_overlay || execution.options_overlay || '',
        options_gate_reason: execution.options_gate_reason || '',
      },
      forward: {
        days_open: asNum(forward.days_open),
        realized_return_pct: asNum(forward.realized_return_pct),
        expected_alpha_to_date_pct: asNum(forward.expected_alpha_to_date_pct),
        alpha_vs_expected_pct: asNum(forward.alpha_vs_expected_pct),
      },
      memory,
      nowcast: {
        confidence_score: asNum(nowcast.confidence_score),
        strongest_drivers: nowcast.strongest_drivers || '',
        source_provenance_summary: nowcast.source_provenance_summary || '',
        pipeline_source_mix: feature.nowcast_source_mix || '',
        pipeline_direct_source_count: asNum(feature.nowcast_direct_source_count),
        pipeline_proxy_source_count: asNum(feature.nowcast_proxy_source_count),
        pipeline_proxy_share: asNum(feature.nowcast_proxy_share),
        source_mix: nowcast.source_mix || '',
        direct_source_count: asNum(nowcast.direct_source_count),
        proxy_source_count: asNum(nowcast.proxy_source_count),
        proxy_share: asNum(nowcast.proxy_share),
        expected_kpi_surprise: nowcast.expected_kpi_surprise || '',
        source_signals: [
          { label: 'Search Trends YoY', value: parsePctString(nowcast.search_trends_yoy), kind: 'direct', provenance: nowcast.search_trends_provenance || '' },
          { label: 'News Mentions YoY', value: parsePctString(nowcast.news_mentions_yoy), kind: 'direct', provenance: nowcast.news_mentions_provenance || '' },
          { label: 'Website Traffic YoY', value: parsePctString(nowcast.website_traffic_yoy), kind: 'direct', provenance: nowcast.website_traffic_provenance || '' },
          { label: 'App Rank YoY', value: parsePctString(nowcast.app_rank_yoy), kind: 'direct', provenance: nowcast.app_rank_provenance || '' },
          { label: 'Price / Promo YoY', value: parsePctString(nowcast.price_promo_yoy), kind: 'direct', provenance: nowcast.price_promo_provenance || '' },
          { label: 'Foot Traffic YoY', value: parsePctString(nowcast.foot_traffic_yoy), kind: 'direct', provenance: nowcast.foot_traffic_provenance || '' },
          { label: 'Price Proxy YoY', value: parsePctString(nowcast.market_price_proxy_yoy), kind: 'proxy', provenance: nowcast.market_price_proxy_provenance || '' },
          { label: 'Volume Proxy YoY', value: parsePctString(nowcast.market_volume_proxy_yoy), kind: 'proxy', provenance: nowcast.market_volume_proxy_provenance || '' },
        ].filter((signal) => signal.value != null),
      },
    };
  });

  const nowcastCoverageRows = ideaDrilldowns
    .map((row) => ({
      symbol: row.symbol,
      rank: row.rank,
      final_alpha_score: row.final_alpha_score,
      nowcast_confidence: row.nowcast?.confidence_score ?? null,
      source_mix: row.nowcast?.source_mix || 'none',
      direct_source_count: row.nowcast?.direct_source_count ?? null,
      proxy_source_count: row.nowcast?.proxy_source_count ?? null,
      proxy_share: row.nowcast?.proxy_share ?? null,
      expected_kpi_surprise: row.nowcast?.expected_kpi_surprise || '',
    }))
    .sort((a, b) => {
      const rankA = a.rank ?? Number.POSITIVE_INFINITY;
      const rankB = b.rank ?? Number.POSITIVE_INFINITY;
      if (rankA !== rankB) return rankA - rankB;
      return String(a.symbol).localeCompare(String(b.symbol));
    });

  const coverageCounts = {
    direct: nowcastCoverageRows.filter((row) => row.source_mix === 'direct').length,
    hybrid: nowcastCoverageRows.filter((row) => row.source_mix === 'hybrid').length,
    proxy_only: nowcastCoverageRows.filter((row) => row.source_mix === 'proxy_only').length,
    none: nowcastCoverageRows.filter((row) => row.source_mix === 'none').length,
  };

  const nowcastCoverage = {
    tracked_symbols: nowcastCoverageRows.length,
    direct_count: coverageCounts.direct,
    hybrid_count: coverageCounts.hybrid,
    proxy_only_count: coverageCounts.proxy_only,
    no_nowcast_count: coverageCounts.none,
    direct_pct: nowcastCoverageRows.length ? pct(coverageCounts.direct / nowcastCoverageRows.length) : null,
    hybrid_pct: nowcastCoverageRows.length ? pct(coverageCounts.hybrid / nowcastCoverageRows.length) : null,
    proxy_only_pct: nowcastCoverageRows.length ? pct(coverageCounts.proxy_only / nowcastCoverageRows.length) : null,
    no_nowcast_pct: nowcastCoverageRows.length ? pct(coverageCounts.none / nowcastCoverageRows.length) : null,
    rows: nowcastCoverageRows,
  };

  const directCoverageTargets = nowcastCoverageRows
    .filter((row) => row.source_mix !== 'direct' && row.source_mix !== 'hybrid')
    .map((row) => {
      const drill = ideaDrilldowns.find((item) => item.symbol === row.symbol) || {};
      const execution = drill.execution || {};
      const fundamentals = drill.fundamentals || {};
      const priorityScore = (row.rank != null ? Math.max(0, 20 - row.rank) : 0) + ((row.final_alpha_score || 0) * 10);
      let gapReason = 'No nowcast coverage yet';
      if (row.source_mix === 'proxy_only') gapReason = 'Proxy-only nowcast; needs direct alternative inputs';

      return {
        symbol: row.symbol,
        rank: row.rank,
        final_alpha_score: row.final_alpha_score,
        source_mix: row.source_mix,
        gap_reason: gapReason,
        priority_score: Number(priorityScore.toFixed(2)),
        sector_bucket: execution.sector_bucket || '',
        sub_industry: execution.sub_industry || normalizeSubIndustry(row.symbol, row.symbol, portfolioConstraints?.sector_map || {}),
        industry: fundamentals.industry || '',
        expected_kpi_surprise: row.expected_kpi_surprise || '',
      };
    })
    .sort((a, b) => {
      if ((b.priority_score || 0) !== (a.priority_score || 0)) return (b.priority_score || 0) - (a.priority_score || 0);
      const rankA = a.rank ?? Number.POSITIVE_INFINITY;
      const rankB = b.rank ?? Number.POSITIVE_INFINITY;
      if (rankA !== rankB) return rankA - rankB;
      return String(a.symbol).localeCompare(String(b.symbol));
    })
    .slice(0, 12);

  const payload = {
    generated_at: new Date().toISOString(),
    timezone: profile?.timezone || 'America/New_York',
    portfolio: {
      account_size: accountSize,
      equities_total: equitiesTotal,
      crypto_total: cryptoTotal,
      cash,
      weights: {
        equities: pct(accountSize > 0 ? equitiesTotal / accountSize : 0),
        crypto: pct(accountSize > 0 ? cryptoTotal / accountSize : 0),
        cash: pct(accountSize > 0 ? cash / accountSize : 0),
      },
      holdings_count: positions.length,
      crypto_count: crypto.length,
    },
    portfolio_risk: {
      summary: {
        weighted_beta_proxy: Number(weightedBeta.toFixed(3)),
        top5_concentration_pct: pct(top5Weight),
        max_single_name_pct: pct(maxSingleNameWeight),
        max_sector_pct: pct(maxSectorWeight),
        cash_buffer_pct: pct(cashWeight),
        equities_pct: pct(equityWeight),
        crypto_pct: pct(cryptoWeight),
        concentration_hhi: Number(concentrationHhi.toFixed(4)),
        limit_flags: limitFlags,
        ...etfExposureSummary,
      },
      constraints: {
        max_single_name_weight: portfolioConstraints?.max_single_name_weight ?? null,
        max_sector_weight: portfolioConstraints?.max_sector_weight ?? null,
        max_beta_exposure: portfolioConstraints?.max_beta_exposure ?? null,
        min_cash_buffer: portfolioConstraints?.min_cash_buffer ?? null,
      },
      top_positions: currentPositionRows.slice(0, 12).map((row) => ({
        symbol: row.symbol,
        name: row.name,
        weight_pct: pct(row.weight),
        equity: Number(row.equity.toFixed(2)),
        sector: row.sector,
        sub_industry: row.sub_industry,
        beta_proxy: row.beta_proxy,
        return_pct: row.return_pct == null ? null : Number((row.return_pct * 100).toFixed(2)),
      })),
      sector_exposure: sectorExposure.slice(0, 12).map((row) => ({
        sector: row.sector,
        weight_pct: pct(row.weight),
        equity: Number(row.equity.toFixed(2)),
        names: row.names,
      })),
      sub_industry_exposure: subIndustryExposure.slice(0, 12).map((row) => ({
        sub_industry: row.sub_industry,
        weight_pct: pct(row.weight),
        equity: Number(row.equity.toFixed(2)),
        names: row.names,
      })),
      target_drift: targetDrift.slice(0, 12).map((row) => ({
        ticker: row.ticker,
        current_weight_pct: pct(row.current_weight),
        target_weight_pct: pct(row.target_weight),
        drift_pct_points: Number(((row.drift || 0) * 100).toFixed(2)),
        sector_bucket: row.sector_bucket,
      })),
      sub_industry_drift: subIndustryDrift.slice(0, 12).map((row) => ({
        sub_industry: row.sub_industry,
        current_weight_pct: pct(row.current_weight),
        target_weight_pct: pct(row.target_weight),
        drift_pct_points: Number(((row.drift || 0) * 100).toFixed(2)),
      })),
    },
    rotation_assistant: {
      recommendation_count: finalRotationRecommendations.length,
      rows: finalRotationRecommendations.map((row) => ({
        symbol: row.symbol,
        action: row.action,
        current_weight_pct: row.current_weight_pct,
        target_weight_pct: row.target_weight_pct,
        drift_pct_points: row.drift_pct_points,
        sub_industry: row.sub_industry,
        est_cash_out: row.est_cash_out == null ? null : Number(row.est_cash_out.toFixed(2)),
        rotation_target_symbol: row.rotation_target_symbol || '',
        rotation_target_sub_industry: row.rotation_target_sub_industry || '',
        rotation_target_reason: row.rotation_target_reason || '',
        reason: row.reason,
      })),
    },
    run_changes: runChanges,
    catalyst_calendar: catalystCalendar,
    regime: regime ? {
      source_market_date: regime.source_market_date || '',
      regime_id: regime.regime_id,
      regime_confidence: asNum(regime.regime_confidence),
      vol_state: regime.vol_state,
      rates_state: regime.rates_state,
      breadth_state: regime.breadth_state,
      sector_leadership_state: regime.sector_leadership_state || '',
      recommended_gross_exposure: asNum(regime.recommended_gross_exposure),
      vix_level: asNum(regime.vix_level),
      realized_vol_20d: asNum(regime.realized_vol_20d),
      rsp_spy_relative_20d: asNum(regime.rsp_spy_relative_20d),
      sector_positive_ratio_20d: asNum(regime.sector_positive_ratio_20d),
      top_sector_leaders_20d: regime.top_sector_leaders_20d || '',
      top_sector_laggards_20d: regime.top_sector_laggards_20d || '',
      why_this_regime: regime.why_this_regime || '',
      regime_multiplier: asNum(regimePolicy?.regime_multipliers?.[activeRegimeId]),
      factor_tilts: Object.entries(activeTilt).map(([factor, multiplier]) => ({
        factor,
        multiplier: asNum(multiplier),
      })),
    } : null,
    signal_quality: {
      row_count: qualityRows.length,
      avg_quality_penalty: avgSignalQualityPenalty,
      avg_effective_confidence: avgEffectiveConfidence,
      top10: qualityRows.slice(0, 10).map((r) => ({
        ticker: r.ticker,
        coverage_score: asNum(r.coverage_score),
        staleness_score: asNum(r.staleness_score),
        cross_source_agreement: asNum(r.cross_source_agreement),
        quality_penalty: asNum(r.quality_penalty),
        effective_confidence: asNum(r.effective_confidence),
      })),
    },
    target_weights: {
      row_count: targets.length,
      rows: targets,
    },
    execution_plan: {
      row_count: tradePlanRows.length,
      total_estimated_cost_usd: Number(tradeCostUsd.toFixed(2)),
      total_notional_usd: Number(tradeNotionalUsd.toFixed(2)),
      avg_cost_pct_of_notional: tradeNotionalUsd > 0 ? Number((tradeCostUsd / tradeNotionalUsd).toFixed(4)) : null,
      rows: tradePlanRows.slice(0, 20).map((r) => ({
        ticker: r.ticker,
        action: r.action,
        shares_delta: asNum(r.shares_delta),
        est_slippage_bps: asNum(r.est_slippage_bps),
        est_cost_usd: asNum(r.est_cost_usd),
        options_overlay: r.options_overlay,
        options_gate_reason: r.options_gate_reason,
      })),
    },
    model_scorecard: {
      row_count: scorecard.length,
      rows: scorecard,
    },
    alpha_lab: alphaLab,
    expected_alpha_summary: {
      avg_20d_pct: avgExp20,
      avg_90d_pct: avgExp90,
      by_symbol: topIdeas.map((r) => ({
        symbol: r.symbol,
        expected_alpha_20d: parsePctString(r.expected_alpha_20d),
        expected_alpha_90d: parsePctString(r.expected_alpha_90d),
      })),
    },
    factor_attribution: factorAttribution,
    nowcast_ablation: nowcastAblation,
    factor_tournament: factorTournament,
    earnings_drift_lab: earningsDriftLab,
    forward_test: {
      open_count: forwardMonitor.open_count,
      closed_count: forwardMonitor.closed_count,
      matured_20d_count: forwardMonitor.matured_20d_count,
      hit_rate_open: forwardMonitor.hit_rate_open,
      avg_alpha_vs_expected_pct_points: forwardMonitor.avg_alpha_vs_expected_pct_points,
      policy: forwardMonitor.policy,
      closes_today_count: forwardMonitor.closes_today_count,
      close_reasons_today: forwardMonitor.close_reasons_today,
      open_rows: forwardMonitor.open_rows,
    },
    postmortem_shelf: postmortemShelf,
    rolling_alpha: {
      alpha_30d: rollingAlpha.alpha_30,
      alpha_90d: rollingAlpha.alpha_90,
      series_last20: rollingAlpha.series,
    },
    model_health: {
      feature_rows: latestFeatures.rows.length,
      eligible_rows: eligibleCount,
      eligible_pct: pct(latestFeatures.rows.length ? eligibleCount / latestFeatures.rows.length : 0),
      gate_breakdown: gateBreakdown(latestFeatures.rows),
      avg_confidence: avgConfidence,
      avg_effective_confidence: avgEffectiveConfidence,
      avg_signal_quality_penalty: avgSignalQualityPenalty,
      expected_alpha_20d_avg_pct: avgExp20,
      expected_alpha_90d_avg_pct: avgExp90,
      rolling_alpha_30d: rollingAlpha.alpha_30,
      rolling_alpha_90d: rollingAlpha.alpha_90,
      forward_open_count: forwardMonitor.open_count,
      forward_hit_rate_open: forwardMonitor.hit_rate_open,
      forward_avg_alpha_vs_expected_pct_points: forwardMonitor.avg_alpha_vs_expected_pct_points,
      backtest_hold_days: backtest.hold_days,
      backtest_benchmark_mode: backtest.benchmark_mode,
      champion_cagr: backtest.champion_cagr,
      challenger_cagr: backtest.challenger_cagr,
      champion_sharpe: backtest.champion_sharpe,
      challenger_sharpe: backtest.challenger_sharpe,
      champion_max_drawdown: backtest.champion_max_drawdown,
      challenger_max_drawdown: backtest.challenger_max_drawdown,
      governance_freeze_violation: governance.freeze_violation,
      promotion_winner: governance?.promotion_gate?.winner || 'N/A',
    },
    summaries: {
      top_ideas_count: topIdeas.length,
      trim_candidates: trimCandidates.length,
      trim_estimated_cash: Number(trimCash.toFixed(2)),
      crypto_alerts_high: cryptoAlerts.high,
      crypto_alerts_medium: cryptoAlerts.medium,
      nowcast_ranked: nowcastTop.length,
      alpha_ranked: alphaTop.length,
      backtest_winner: backtest.winner,
      backtest_sample_n: backtest.sample_n,
      rolling_alpha_30d: rollingAlpha.alpha_30,
      rolling_alpha_90d: rollingAlpha.alpha_90,
      execution_total_cost_usd: Number(tradeCostUsd.toFixed(2)),
      regime_id: regime?.regime_id || 'N/A',
    },
    latest_files: {
      ideas_csv: latestIdeas.file,
      trim_csv: latestTrim.file,
      crypto_alerts_md: cryptoAlerts.file,
      nowcast_csv: latestNowcast.file,
      ranks_csv: latestRanks.file,
      features_csv: latestFeatures.file,
      regime_csv: latestRegime.file,
      signal_quality_csv: latestQuality.file,
      target_weights_csv: latestTargets.file,
      execution_plan_csv: latestTradePlan.file,
      model_scorecard_csv: latestScorecard.file,
      backtest_events_csv: rollingAlpha.file,
      forward_ledger_csv: forwardMonitor.ledger_file,
      forward_snapshot_csv: forwardMonitor.snapshot_file,
    },
    top_ideas: topIdeas,
    idea_drilldowns: ideaDrilldowns,
    nowcast_coverage: nowcastCoverage,
    direct_source_leaderboard: directSourceLeaderboard,
    direct_coverage_targets: directCoverageTargets,
    alpha_top20: alphaTop,
    nowcast_top20: nowcastTop,
    backtest,
    governance,
    robinhood: await loadRobinhoodSnapshot(),
    scripts: scriptCatalog(),
    platform_roadmap: buildPlatformRoadmap(),
    data_provenance: dataProvenance,
  };

  const outDir = path.join(tradingDir, 'dashboard', 'data');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'dashboard_data.json');
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Wrote: ${outFile}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}

