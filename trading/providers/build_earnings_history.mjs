#!/usr/bin/env node
/**
 * build_earnings_history.mjs
 *
 * Fetches real historical post-earnings returns for every ticker in the
 * universe and writes them to trading/data/alt/earnings_outcomes.csv.
 *
 * Strategy:
 *   Primary  – Finnhub /stock/earnings (actual announcement dates + revenue data)
 *   Fallback – Yahoo Finance earningsHistory (fiscal quarter-end + ~35-day offset)
 *
 * For each earnings event, the 5-day forward price return is computed
 * from Yahoo Finance historical close prices starting on the first trading
 * day on or after the announcement date.
 *
 * Existing rows whose report_date is in the past are kept as-is; only
 * missing ticker/date pairs are back-filled so the run stays fast after
 * the initial seed.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import YahooFinance from 'yahoo-finance2';
import { loadLocalEnv } from './env.mjs';
import { ensureDir, latestFile, parseCsv, toCsv } from '../scripts/lib.mjs';

const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });

const root = process.cwd();
const tradingDir = path.join(root, 'trading');
const altDir = path.join(tradingDir, 'data', 'alt');

const SLEEP_MS = 600;          // polite delay between tickers
const PRICE_LOOKBACK_DAYS = 20; // calendar days of price history fetched per side of event
const MIN_SAMPLES_TO_SKIP = 6;  // if ticker already has this many recent rows, skip re-fetch
const LOOKBACK_QUARTERS = 12;   // up to ~3 years of quarterly history

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIsoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── Universe ────────────────────────────────────────────────────────────────

async function loadUniverse() {
  const symbols = new Set();

  const latestBucketFile = await latestFile(
    path.join(tradingDir, 'buckets'),
    /-growth-bucket\.csv$/,
  ).catch(() => null);
  if (latestBucketFile) {
    const rows = parseCsv(await fs.readFile(latestBucketFile, 'utf8'));
    rows.forEach((r) => symbols.add(String(r.symbol || '').toUpperCase()));
  }

  try {
    const positions = parseCsv(
      await fs.readFile(path.join(tradingDir, 'data', 'positions.csv'), 'utf8'),
    );
    positions.forEach((r) => symbols.add(String(r.symbol || '').toUpperCase()));
  } catch {}

  return [...symbols].filter(Boolean).sort();
}

// ─── Existing outcomes ───────────────────────────────────────────────────────

// Fiscal quarter-end months+days that signal a raw period date rather than
// an actual announcement date — used to discard stale bad data.
const QUARTER_END_SUFFIXES = new Set(['-03-31', '-06-30', '-09-30', '-12-31']);

function isQuarterEndDate(dateStr) {
  if (dateStr.length < 10) return false;
  const suffix = dateStr.slice(4, 10); // "-MM-DD" portion
  return QUARTER_END_SUFFIXES.has(suffix);
}

async function loadExistingOutcomes(outcomesPath) {
  const today = toIsoDate(new Date());
  try {
    const rows = parseCsv(await fs.readFile(outcomesPath, 'utf8'));
    return rows.filter((r) => {
      const date = String(r.report_date || '');
      // Keep only rows with a valid past date (drops synthetic future rows)
      // Also drop any row whose date is an exact fiscal quarter-end — those
      // were generated with the old (wrong) Finnhub period date before the
      // +35-day announcement-date offset was added.
      if (!date || date > today || date < '2020-01-01') return false;
      if (isQuarterEndDate(date)) return false;
      return true;
    });
  } catch {
    return [];
  }
}

function buildExistingIndex(rows) {
  const set = new Set();
  for (const r of rows) {
    if (r.ticker && r.report_date) {
      set.add(`${r.ticker}|${r.report_date}`);
    }
  }
  return set;
}

function countExistingByTicker(rows) {
  const map = new Map();
  for (const r of rows) {
    const t = String(r.ticker || '').toUpperCase();
    map.set(t, (map.get(t) || 0) + 1);
  }
  return map;
}

// ─── Price helpers ────────────────────────────────────────────────────────────

async function fetchPricesAround(symbol, eventDate) {
  const from = addDays(eventDate, -3);
  const to = addDays(eventDate, PRICE_LOOKBACK_DAYS);
  try {
    const rows = await yahooFinance.historical(symbol, {
      period1: from,
      period2: to,
      interval: '1d',
    });
    return rows
      .filter((r) => r.close != null)
      .map((r) => ({
        date: toIsoDate(r.date),
        close: r.adjClose ?? r.close,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

function compute5dReturn(prices, eventDate) {
  // Find the first trading day on or after the event date
  const t0 = prices.find((p) => p.date >= eventDate);
  if (!t0) return null;
  const t0Idx = prices.indexOf(t0);
  const t5 = prices[t0Idx + 5];
  if (!t5) return null;
  if (!t0.close || !t5.close) return null;
  return (t5.close - t0.close) / t0.close;
}

// ─── Finnhub earnings history ─────────────────────────────────────────────────

async function httpJson(url) {
  const parsed = new URL(url);
  const label = `${parsed.hostname}${parsed.pathname}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'playground-trading/1.0',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${label}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new Error(`Non-JSON from ${label}`);
  return res.json();
}

async function fetchFinnhubEarnings(symbol, apiKey) {
  const url = `https://finnhub.io/api/v1/stock/earnings?symbol=${encodeURIComponent(symbol)}&limit=${LOOKBACK_QUARTERS}&token=${encodeURIComponent(apiKey)}`;
  const data = await httpJson(url);
  if (!Array.isArray(data)) return [];
  const today = toIsoDate(new Date());

  return data
    .map((item) => {
      // Finnhub's `period` field is the fiscal QUARTER-END date (e.g. "2024-12-31"),
      // NOT the actual announcement date. Earnings are typically released 3–7 weeks
      // after the quarter closes, so we offset by ~35 days to approximate the real
      // announcement date (same heuristic as the Yahoo Finance fallback path).
      const periodStr = String(item.period || '').slice(0, 10);
      if (!periodStr || periodStr < '2020-01-01') return null;

      const periodDate = new Date(`${periodStr}T00:00:00Z`);
      if (isNaN(periodDate.getTime())) return null;

      const approxAnnounce = new Date(periodDate.getTime() + 35 * 86400000);
      const reportDate = toIsoDate(approxAnnounce);
      if (reportDate > today) return null;

      const revenueActual = asNum(item.revenueActual);
      const revenueEstimate = asNum(item.revenueEstimate);
      const revenueSurprise =
        revenueActual != null && revenueEstimate != null && revenueEstimate !== 0
          ? (revenueActual - revenueEstimate) / Math.abs(revenueEstimate)
          : null;

      // Fall back to EPS surprise % if revenue not available
      const epsSurprise = asNum(item.surprisePercent);
      const surprisePct = revenueSurprise ?? (epsSurprise != null ? epsSurprise / 100 : null);

      return { reportDate, revenueSurprisePct: surprisePct };
    })
    .filter(Boolean);
}

// ─── Yahoo Finance earnings history (fallback) ────────────────────────────────

async function fetchYahooEarnings(symbol) {
  const today = toIsoDate(new Date());
  let history = [];

  try {
    const summary = await yahooFinance.quoteSummary(symbol, {
      modules: ['earningsHistory'],
    });
    history = summary?.earningsHistory?.history || [];
  } catch {
    return [];
  }

  return history
    .map((event) => {
      // Yahoo's earningsHistory.history uses the fiscal quarter end date.
      // Actual announcement typically follows 30-45 calendar days after quarter close.
      const quarterDate = event.quarter ?? event.date;
      if (!quarterDate) return null;

      const qd = new Date(quarterDate);
      if (isNaN(qd.getTime())) return null;

      // Approximate announcement date: quarter end + 35 days
      const approxAnnounce = new Date(qd.getTime() + 35 * 86400000);
      const reportDate = toIsoDate(approxAnnounce);
      if (reportDate > today || reportDate < '2020-01-01') return null;

      const surprisePct =
        typeof event.surprisePercent === 'number' ? event.surprisePercent / 100 : null;

      return { reportDate, revenueSurprisePct: surprisePct };
    })
    .filter(Boolean);
}

// ─── Per-ticker fetch & price-return computation ──────────────────────────────

async function buildOutcomesForTicker(symbol, apiKey, existingIndex) {
  const records = [];

  // 1. Get earnings events (Finnhub preferred)
  let events = [];
  if (apiKey) {
    try {
      events = await fetchFinnhubEarnings(symbol, apiKey);
    } catch {
      events = [];
    }
  }
  if (!events.length) {
    try {
      events = await fetchYahooEarnings(symbol);
    } catch {
      events = [];
    }
  }
  if (!events.length) return records;

  // 2. Deduplicate events against existing data
  const newEvents = events.filter(
    (e) => !existingIndex.has(`${symbol}|${e.reportDate}`),
  );
  if (!newEvents.length) return records;

  // 3. Fetch price data around each event
  for (const event of newEvents) {
    const prices = await fetchPricesAround(symbol, event.reportDate);
    const ret5d = compute5dReturn(prices, event.reportDate);
    if (ret5d == null) continue; // Can't compute return, skip

    records.push({
      ticker: symbol,
      report_date: event.reportDate,
      revenue_surprise_pct: event.revenueSurprisePct != null
        ? Number(event.revenueSurprisePct.toFixed(6))
        : '',
      post_earnings_return_5d: Number(ret5d.toFixed(6)),
    });
  }

  return records;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function run() {
  await loadLocalEnv(root);
  await ensureDir(altDir);

  const apiKey = process.env.FINNHUB_API_KEY || null;
  if (apiKey) {
    console.log('Earnings history: Finnhub primary, Yahoo Finance fallback');
  } else {
    console.log('Earnings history: Yahoo Finance only (set FINNHUB_API_KEY for better data)');
  }

  const universe = await loadUniverse();
  const outcomesPath = path.join(altDir, 'earnings_outcomes.csv');
  const existingRows = await loadExistingOutcomes(outcomesPath);
  const existingIndex = buildExistingIndex(existingRows);
  const countByTicker = countExistingByTicker(existingRows);

  console.log(
    `Universe: ${universe.length} tickers | existing real rows: ${existingRows.length}`,
  );

  const newRows = [];
  let skipped = 0;

  for (let i = 0; i < universe.length; i += 1) {
    const symbol = universe[i];
    const existing = countByTicker.get(symbol) || 0;

    // Skip if ticker already has plenty of recent history
    if (existing >= MIN_SAMPLES_TO_SKIP) {
      process.stdout.write(
        `  [${i + 1}/${universe.length}] ${symbol.padEnd(6)} already has ${existing} rows — skipping\n`,
      );
      skipped += 1;
      continue;
    }

    process.stdout.write(`  [${i + 1}/${universe.length}] ${symbol.padEnd(6)} (${existing} existing)... `);

    try {
      const records = await buildOutcomesForTicker(symbol, apiKey, existingIndex);
      newRows.push(...records);
      process.stdout.write(`+${records.length} new rows\n`);
    } catch (err) {
      process.stdout.write(
        `error: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}\n`,
      );
    }

    if (i < universe.length - 1) await sleep(SLEEP_MS);
  }

  // Merge & sort: existing good rows + newly fetched rows
  const allRows = [...existingRows, ...newRows].sort((a, b) => {
    const t = String(a.ticker).localeCompare(String(b.ticker));
    if (t !== 0) return t;
    return String(a.report_date).localeCompare(String(b.report_date));
  });

  const headers = ['ticker', 'report_date', 'revenue_surprise_pct', 'post_earnings_return_5d'];
  await fs.writeFile(outcomesPath, toCsv(allRows, headers), 'utf8');

  const totalTickers = new Set(allRows.map((r) => r.ticker)).size;
  console.log(`\nWrote: ${outcomesPath}`);
  console.log(`Total rows: ${allRows.length} across ${totalTickers} tickers`);
  console.log(`New rows added: ${newRows.length} | Tickers skipped (sufficient data): ${skipped}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
