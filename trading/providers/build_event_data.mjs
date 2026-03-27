#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, latestFile, parseCsv, readJson, toCsv, todayDate } from '../scripts/lib.mjs';
import { createFundamentalsDataClient } from './fundamentals_data.mjs';

const root = process.cwd();
const tradingDir = path.join(root, 'trading');
const altDir = path.join(tradingDir, 'data', 'alt');
const configDir = path.join(tradingDir, 'nowcast', 'config');

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

function countNewsByDay(rows) {
  const map = new Map();
  for (const row of rows) {
    const date = String(row.published_at || '').slice(0, 10);
    const ticker = String(row.ticker || '').toUpperCase();
    if (!date || !ticker) continue;
    const key = `${date}|${ticker}`;
    map.set(key, (map.get(key) || 0) + 1);
  }

  return [...map.entries()]
    .map(([key, value]) => {
      const [date, ticker] = key.split('|');
      return { date, ticker, value };
    })
    .sort((a, b) => (a.date === b.date ? a.ticker.localeCompare(b.ticker) : a.date.localeCompare(b.date)));
}

async function loadPriorityUniverse() {
  const symbols = new Set();

  const latestBucketFile = await latestFile(path.join(tradingDir, 'buckets'), /-growth-bucket\.csv$/).catch(() => null);
  if (latestBucketFile) {
    const rows = parseCsv(await fs.readFile(latestBucketFile, 'utf8'));
    rows.forEach((r) => {
      const ticker = String(r.symbol || '').toUpperCase();
      if (ticker) symbols.add(ticker);
    });
  }

  try {
    const positions = parseCsv(await fs.readFile(path.join(tradingDir, 'data', 'positions.csv'), 'utf8'));
    positions.forEach((r) => {
      const ticker = String(r.symbol || '').toUpperCase();
      if (ticker) symbols.add(ticker);
    });
  } catch {}

  try {
    const peers = JSON.parse(await fs.readFile(path.join(configDir, 'peer_groups.json'), 'utf8'));
    Object.entries(peers).forEach(([ticker, peerList]) => {
      const base = String(ticker || '').toUpperCase();
      if (base) symbols.add(base);
      for (const peer of peerList || []) {
        const p = String(peer || '').toUpperCase();
        if (p) symbols.add(p);
      }
    });
  } catch {}

  return [...symbols].filter(Boolean).sort();
}

export async function run() {
  await ensureDir(altDir);

  const profile = await readJson(path.join(tradingDir, 'config', 'profile.json'));
  const tz = profile?.timezone || 'America/New_York';
  const asOf = todayDate(tz);
  const earningsFrom = addDays(asOf, -7);
  const earningsTo = addDays(asOf, 120);
  const newsFrom = addDays(asOf, -430);
  const newsTo = asOf;

  const client = await createFundamentalsDataClient(root);
  const universe = await loadPriorityUniverse();

  let earningsRows = [];
  let newsRows = [];

  try {
    earningsRows = await client.getEarningsCalendar(earningsFrom, earningsTo, universe);
  } catch (err) {
    console.warn(`Provider earnings refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    earningsRows = [];
  }

  for (const ticker of universe) {
    try {
      const rows = await client.getCompanyNews(ticker, newsFrom, newsTo);
      newsRows.push(...rows);
    } catch {
      // keep going on single-symbol failures
    }
  }

  const earningsPath = path.join(altDir, 'earnings_calendar.csv');
  const companyNewsPath = path.join(altDir, 'company_news.csv');
  const newsMentionsPath = path.join(altDir, 'news_mentions_finnhub.csv');
  const earningsHeaders = ['ticker', 'report_date', 'eps_estimate', 'revenue_estimate', 'hour', 'provider'];
  const companyNewsHeaders = ['ticker', 'source', 'headline', 'summary', 'published_at', 'url', 'provider'];
  const dailyCounts = countNewsByDay(newsRows);

  await fs.writeFile(earningsPath, toCsv(earningsRows, earningsHeaders), 'utf8');
  await fs.writeFile(companyNewsPath, toCsv(newsRows, companyNewsHeaders), 'utf8');
  await fs.writeFile(newsMentionsPath, toCsv(dailyCounts, ['date', 'ticker', 'value']), 'utf8');

  console.log(`Provider-backed event universe: ${universe.length} tickers`);
  console.log(`Wrote: ${earningsPath} (${earningsRows.length} rows)`);
  console.log(`Wrote: ${companyNewsPath} (${newsRows.length} rows)`);
  console.log(`Wrote: ${newsMentionsPath} (${dailyCounts.length} rows)`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
