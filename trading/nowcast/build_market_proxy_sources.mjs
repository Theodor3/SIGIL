#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import YahooFinance from 'yahoo-finance2';
import { latestFile, parseCsv } from '../scripts/lib.mjs';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const root = process.cwd();
const tradingDir = path.join(root, 'trading');
const altDir = path.join(tradingDir, 'data', 'alt');
const nowcastConfigDir = path.join(tradingDir, 'nowcast', 'config');

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

function toNum(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function toCsv(rows) {
  const header = 'date,ticker,value';
  const lines = rows.map((r) => `${r.date},${r.ticker},${r.value}`);
  return [header, ...lines].join('\n');
}

async function loadUniverse() {
  const symbols = new Set();

  const latestBucketFile = await latestFile(path.join(tradingDir, 'buckets'), /-growth-bucket\.csv$/).catch(() => null);
  if (latestBucketFile) {
    const rows = parseCsv(await fs.readFile(latestBucketFile, 'utf8'));
    rows.forEach((r) => symbols.add(String(r.symbol || '').toUpperCase()));
  }

  try {
    const positions = parseCsv(await fs.readFile(path.join(tradingDir, 'data', 'positions.csv'), 'utf8'));
    positions.forEach((r) => symbols.add(String(r.symbol || '').toUpperCase()));
  } catch {}

  try {
    const peers = JSON.parse(await fs.readFile(path.join(nowcastConfigDir, 'peer_groups.json'), 'utf8'));
    Object.entries(peers).forEach(([k, vals]) => {
      symbols.add(String(k || '').toUpperCase());
      for (const v of vals || []) symbols.add(String(v || '').toUpperCase());
    });
  } catch {}

  return [...symbols].filter(Boolean).sort();
}

async function fetchSeries(symbol) {
  const end = new Date();
  const start = new Date(end.getTime() - (430 * 24 * 60 * 60 * 1000));
  const rows = await yf.chart(symbol, {
    period1: start,
    period2: end,
    interval: '1d',
  });

  const quotes = rows?.quotes || [];
  return quotes
    .map((q) => ({
      date: q.date instanceof Date ? toIsoDate(q.date) : '',
      close: toNum(q.close),
      volume: toNum(q.volume),
    }))
    .filter((q) => q.date && q.close != null && q.volume != null);
}

export async function run() {
  await fs.mkdir(altDir, { recursive: true });
  const universe = await loadUniverse();
  const priceRows = [];
  const volumeRows = [];

  for (const symbol of universe) {
    try {
      const series = await fetchSeries(symbol);
      for (const row of series) {
        priceRows.push({ date: row.date, ticker: symbol, value: row.close });
        volumeRows.push({ date: row.date, ticker: symbol, value: row.volume });
      }
    } catch {}
  }

  await fs.writeFile(path.join(altDir, 'market_price_proxy.csv'), toCsv(priceRows), 'utf8');
  await fs.writeFile(path.join(altDir, 'market_volume_proxy.csv'), toCsv(volumeRows), 'utf8');

  console.log(`Wrote: ${path.join(altDir, 'market_price_proxy.csv')}`);
  console.log(`Wrote: ${path.join(altDir, 'market_volume_proxy.csv')}`);
  console.log(`Proxy universe: ${universe.length} tickers`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
