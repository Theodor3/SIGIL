#!/usr/bin/env node
/**
 * Alpaca Execution Bridge
 * Reads today's trade plan and submits orders to Alpaca paper (or live) trading.
 *
 * Usage:
 *   node trading/execution/run_alpaca_broker.mjs            # dry-run (default, safe)
 *   node trading/execution/run_alpaca_broker.mjs --execute  # actually place orders
 *   node trading/execution/run_alpaca_broker.mjs --status   # show positions + open orders
 *
 * Env vars (in trading/.env.local):
 *   ALPACA_API_KEY=PKxxxxxxxx
 *   ALPACA_SECRET_KEY=xxxxxxxxxx
 *   ALPACA_BASE_URL=https://paper-api.alpaca.markets   ← paper (default)
 *                  https://api.alpaca.markets          ← LIVE (only when you're ready)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { asNum, ensureDir, parseCsv, readCsv, todayDate } from '../scripts/lib.mjs';
import { loadLocalEnv } from '../providers/env.mjs';

const root = process.cwd();
const tradingDir = path.join(root, 'trading');

// ── Alpaca REST client ────────────────────────────────────────────────────────

function alpacaClient(baseUrl, apiKey, secretKey) {
  const headers = {
    'APCA-API-KEY-ID': apiKey,
    'APCA-API-SECRET-KEY': secretKey,
    'Content-Type': 'application/json',
  };

  async function request(method, endpoint, body = null) {
    const url = `${baseUrl}${endpoint}`;
    const opts = {
      method,
      headers,
      signal: AbortSignal.timeout(15000),
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const text = await res.text();
    if (!res.ok) throw new Error(`Alpaca ${method} ${endpoint} → ${res.status}: ${text}`);
    return text ? JSON.parse(text) : null;
  }

  return {
    getAccount: () => request('GET', '/v2/account'),
    getPositions: () => request('GET', '/v2/positions'),
    getOrders: (status = 'open') => request('GET', `/v2/orders?status=${status}&limit=50`),
    placeOrder: (order) => request('POST', '/v2/orders', order),
    cancelOrder: (orderId) => request('DELETE', `/v2/orders/${orderId}`),
    getAsset: (symbol) => request('GET', `/v2/assets/${symbol}`),
  };
}

// ── Order sizing ──────────────────────────────────────────────────────────────

function parsePrice(str) {
  if (!str) return null;
  const m = String(str).match(/\$?([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function buildOrder(row, dryRun) {
  const symbol = (row.ticker || '').toUpperCase();
  const action = (row.action || '').toLowerCase();
  const sharesDelta = parseFloat(row.shares_delta);
  const entryLow = parsePrice(row.entry_zone_low);
  const entryHigh = parsePrice(row.entry_zone_high?.split(' ')[0]); // strip "(stagger...)"

  if (!symbol || !action || isNaN(sharesDelta) || sharesDelta <= 0) return null;
  if (action !== 'buy' && action !== 'sell') return null;

  const qty = Math.floor(sharesDelta); // whole shares only
  if (qty < 1) return null;

  // Use limit order at entry_zone_low for buys (conservative fill),
  // or market order for sells (exit quickly).
  const orderType = action === 'buy' && entryLow ? 'limit' : 'market';
  const limitPrice = orderType === 'limit' ? entryLow : null;

  return {
    symbol,
    qty: String(qty),
    side: action,
    type: orderType,
    time_in_force: orderType === 'limit' ? 'day' : 'day',
    ...(limitPrice ? { limit_price: String(limitPrice.toFixed(2)) } : {}),
    extended_hours: false,
    client_order_id: `sigil_${symbol}_${todayDate('America/New_York')}_${Date.now()}`,
    // Metadata for logging
    _meta: {
      trade_notional_usd: asNum(row.trade_notional_usd),
      target_weight: asNum(row.target_weight),
      risk_adjusted_score: asNum(row.risk_adjusted_score),
      entry_zone: `${row.entry_zone_low} – ${row.entry_zone_high}`,
      invalidation: row.invalidation_price,
      trim_schedule: row.trim_schedule,
      dry_run: dryRun,
    },
  };
}

// ── Status display ────────────────────────────────────────────────────────────

function fmt$(n) { return n == null ? 'n/a' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtPct(n) { return n == null ? 'n/a' : `${(Number(n) * 100).toFixed(2)}%`; }

async function showStatus(client) {
  const [account, positions, orders] = await Promise.all([
    client.getAccount(),
    client.getPositions(),
    client.getOrders('open'),
  ]);

  console.log('\n════ ACCOUNT ════');
  console.log(`  Cash:          ${fmt$(account.cash)}`);
  console.log(`  Buying power:  ${fmt$(account.buying_power)}`);
  console.log(`  Portfolio:     ${fmt$(account.portfolio_value)}`);
  console.log(`  Day P&L:       ${fmt$(account.equity - account.last_equity)}`);

  if (positions.length) {
    console.log('\n════ POSITIONS ════');
    for (const p of positions) {
      const pl = asNum(p.unrealized_pl);
      const plPct = asNum(p.unrealized_plpc);
      console.log(`  ${p.symbol.padEnd(6)} ${String(p.qty).padStart(6)} shares @ ${fmt$(p.avg_entry_price)} | P&L: ${fmt$(pl)} (${fmtPct(plPct)}) | Market: ${fmt$(p.market_value)}`);
    }
  } else {
    console.log('\n  No open positions.');
  }

  if (orders.length) {
    console.log('\n════ OPEN ORDERS ════');
    for (const o of orders) {
      console.log(`  ${o.symbol.padEnd(6)} ${o.side.toUpperCase()} ${o.qty} @ ${o.type === 'limit' ? fmt$(o.limit_price) : 'MARKET'} | ${o.status}`);
    }
  } else {
    console.log('\n  No open orders.');
  }

  return { account, positions, orders };
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function run() {
  await loadLocalEnv(root);

  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const statusOnly = args.includes('--status');
  const dryRun = !execute;

  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  const baseUrl = (process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets').replace(/\/$/, '');
  const isLive = baseUrl.includes('api.alpaca.markets') && !baseUrl.includes('paper');

  if (!apiKey || !secretKey) {
    console.error('Missing ALPACA_API_KEY or ALPACA_SECRET_KEY in trading/.env.local');
    console.error('Add them and re-run. See: https://app.alpaca.markets/paper/dashboard/overview');
    process.exit(1);
  }

  if (isLive && dryRun) {
    console.warn('⚠  LIVE endpoint detected — forcing dry-run. Pass --execute to trade live.');
  }

  if (isLive && execute) {
    console.warn('\n⚠️  WARNING: LIVE TRADING MODE ACTIVE ⚠️');
    console.warn('Orders will be placed with real money. You have 5 seconds to Ctrl+C.\n');
    await new Promise((r) => setTimeout(r, 5000));
  }

  const mode = isLive ? (execute ? 'LIVE' : 'DRY-RUN (live endpoint)') : (execute ? 'PAPER EXECUTE' : 'DRY-RUN');
  console.log(`\n═══ Alpaca Broker — ${mode} ═══`);
  console.log(`  Endpoint: ${baseUrl}`);

  const client = alpacaClient(baseUrl, apiKey, secretKey);

  // Always show account status
  const { account, positions } = await showStatus(client);

  if (statusOnly) return;

  // Load trade plan
  const tradePlanPath = path.join(tradingDir, 'data', 'execution', 'latest_trade_plan.csv');
  let tradePlanRows;
  try {
    tradePlanRows = await readCsv(tradePlanPath);
  } catch {
    console.error(`\nNo trade plan found at ${tradePlanPath}`);
    console.error('Run npm start or npm run trading:pipeline first.');
    process.exit(1);
  }

  const buyRows = tradePlanRows.filter((r) => (r.action || '').toLowerCase() === 'buy');
  if (!buyRows.length) {
    console.log('\nNo BUY orders in today\'s trade plan. Nothing to do.');
    return;
  }

  // Check buying power
  const buyingPower = asNum(account.buying_power) ?? 0;
  const totalNotional = buyRows.reduce((a, r) => a + (asNum(r.trade_notional_usd) ?? 0), 0);

  console.log(`\n════ TRADE PLAN ════`);
  console.log(`  Buying power available: ${fmt$(buyingPower)}`);
  console.log(`  Total planned notional: ${fmt$(totalNotional)}`);
  if (totalNotional > buyingPower) {
    console.warn(`  ⚠  Notional exceeds buying power — orders will be scaled or rejected by Alpaca`);
  }

  // Skip tickers already held
  const heldSymbols = new Set(positions.map((p) => p.symbol.toUpperCase()));

  const orders = [];
  for (const row of buyRows) {
    const symbol = (row.ticker || '').toUpperCase();
    if (heldSymbols.has(symbol)) {
      console.log(`  ${symbol}: already held — skipping`);
      continue;
    }

    const order = buildOrder(row, dryRun);
    if (!order) {
      console.log(`  ${symbol}: could not build order (check shares_delta / entry price)`);
      continue;
    }

    const notional = order._meta.trade_notional_usd;
    const limitStr = order.limit_price ? ` @ limit ${fmt$(order.limit_price)}` : ' @ MARKET';
    console.log(`  ${execute ? '→ PLACING' : '○ WOULD PLACE'} ${order.side.toUpperCase()} ${order.qty} ${order.symbol}${limitStr} | notional ~${fmt$(notional)} | score: ${n2(order._meta.risk_adjusted_score)}`);

    if (execute) {
      const { _meta, ...orderPayload } = order;
      try {
        const result = await client.placeOrder(orderPayload);
        console.log(`    ✓ Order placed: ${result.id} | status: ${result.status}`);
        orders.push({ ...order, order_id: result.id, status: result.status, placed_at: new Date().toISOString() });
      } catch (err) {
        console.error(`    ✗ Failed: ${err.message}`);
        orders.push({ ...order, error: err.message, placed_at: new Date().toISOString() });
      }
    } else {
      orders.push({ ...order, placed_at: new Date().toISOString() });
    }
  }

  // Log to file
  const logDir = path.join(tradingDir, 'logs', 'alpaca');
  await ensureDir(logDir);
  const logFile = path.join(logDir, `${todayDate('America/New_York')}-orders.json`);
  await fs.writeFile(logFile, JSON.stringify({ mode, as_of: new Date().toISOString(), orders }, null, 2), 'utf8');
  console.log(`\n  Log: ${logFile}`);

  if (dryRun) {
    console.log('\n  ℹ  Dry-run complete. No orders placed.');
    console.log('  Run with --execute to place paper orders.');
  } else {
    console.log(`\n  ✓ ${orders.filter((o) => o.order_id).length}/${orders.length} orders placed.`);
  }
}

function n2(v) { return v == null ? 'n/a' : Number(v).toFixed(3); }

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
