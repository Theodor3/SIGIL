#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { latestFile, parseCsv } from '../scripts/lib.mjs';

const root = process.cwd();
const tradingDir = path.join(root, 'trading');
const altDir = path.join(tradingDir, 'data', 'alt');
const configDir = path.join(tradingDir, 'nowcast', 'config');
const DAY_MS = 24 * 60 * 60 * 1000;
const NEWS_WAIT_MS = 5500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function toCsv(rows) {
  const header = 'date,ticker,value';
  return [header, ...rows.map((r) => `${r.date},${r.ticker},${r.value}`)].join('\n');
}

function toNewsProvenanceCsv(rows) {
  const header = 'ticker,primary_source,gdelt_rows,finnhub_backfill_rows,total_rows';
  return [
    header,
    ...rows.map((r) => `${r.ticker},${r.primary_source},${r.gdelt_rows},${r.finnhub_backfill_rows},${r.total_rows}`),
  ].join('\n');
}

async function loadFallbackNewsRows() {
  const finnhubPath = path.join(altDir, 'news_mentions_finnhub.csv');
  try {
    const rows = parseCsv(await fs.readFile(finnhubPath, 'utf8'));
    return rows
      .map((r) => ({
        date: String(r.date || ''),
        ticker: String(r.ticker || '').toUpperCase(),
        value: Number(r.value),
      }))
      .filter((r) => r.date && r.ticker && Number.isFinite(r.value));
  } catch {
    return [];
  }
}

async function loadExistingNewsRows(newsFile) {
  try {
    const rows = parseCsv(await fs.readFile(newsFile, 'utf8'));
    return rows
      .map((r) => ({
        date: String(r.date || ''),
        ticker: String(r.ticker || '').toUpperCase(),
        value: Number(r.value),
      }))
      .filter((r) => r.date && r.ticker && Number.isFinite(r.value));
  } catch {
    return [];
  }
}

function mergeNewsRows(primaryRows, fallbackRows) {
  const merged = new Map();

  for (const row of primaryRows) {
    merged.set(`${row.date}|${row.ticker}`, {
      date: row.date,
      ticker: row.ticker,
      value: row.value,
      source: 'gdelt',
    });
  }

  for (const row of fallbackRows) {
    const key = `${row.date}|${row.ticker}`;
    if (!merged.has(key)) {
      merged.set(key, {
        date: row.date,
        ticker: row.ticker,
        value: row.value,
        source: 'finnhub_backfill',
      });
    }
  }

  return [...merged.values()].sort((a, b) => (
    a.date === b.date ? a.ticker.localeCompare(b.ticker) : a.date.localeCompare(b.date)
  ));
}

function summarizeNewsProvenance(mergedRows) {
  const byTicker = new Map();
  for (const row of mergedRows) {
    const key = row.ticker;
    const cur = byTicker.get(key) || {
      ticker: key,
      gdelt_rows: 0,
      finnhub_backfill_rows: 0,
      total_rows: 0,
      primary_source: 'none',
    };
    if (row.source === 'gdelt') cur.gdelt_rows += 1;
    if (row.source === 'finnhub_backfill') cur.finnhub_backfill_rows += 1;
    cur.total_rows += 1;
    byTicker.set(key, cur);
  }

  return [...byTicker.values()]
    .map((row) => ({
      ...row,
      primary_source: row.gdelt_rows > 0 ? 'gdelt' : row.finnhub_backfill_rows > 0 ? 'finnhub_backfill' : 'none',
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
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
    const peers = JSON.parse(await fs.readFile(path.join(configDir, 'peer_groups.json'), 'utf8'));
    Object.entries(peers).forEach(([ticker, peerList]) => {
      symbols.add(String(ticker || '').toUpperCase());
      for (const peer of peerList || []) symbols.add(String(peer || '').toUpperCase());
    });
  } catch {}

  return [...symbols].filter(Boolean).sort();
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

  return [...symbols].filter(Boolean).sort();
}

async function loadWikiMap() {
  try {
    return JSON.parse(await fs.readFile(path.join(configDir, 'wiki_page_map.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function loadNewsMap() {
  try {
    return JSON.parse(await fs.readFile(path.join(configDir, 'news_query_map.json'), 'utf8'));
  } catch {
    return {};
  }
}

function titleToQuery(title) {
  const raw = String(title || '')
    .replace(/_/g, ' ')
    .replace(/\s*\([^)]*\)/g, '')
    .trim();
  return raw ? `"${raw}"` : '';
}

async function fetchPageviews(pageTitle, startDate, endDate) {
  const start = startDate.replace(/-/g, '');
  const end = endDate.replace(/-/g, '');
  const encodedTitle = encodeURIComponent(pageTitle);
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/${encodedTitle}/daily/${start}/${end}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'playground-trading/1.0 (alt-source-builder)',
    },
  });
  if (!res.ok) {
    throw new Error(`Pageviews fetch failed for ${pageTitle}: ${res.status}`);
  }
  const data = await res.json();
  return (data.items || []).map((item) => ({
    date: `${item.timestamp.slice(0, 4)}-${item.timestamp.slice(4, 6)}-${item.timestamp.slice(6, 8)}`,
    value: item.views,
  }));
}

async function fetchNewsMentions(query, startDate, endDate) {
  const start = `${startDate.replace(/-/g, '')}000000`;
  const end = `${endDate.replace(/-/g, '')}000000`;
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=TimelineVolRaw&format=json&startdatetime=${start}&enddatetime=${end}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'playground-trading/1.0 (news-source-builder)',
    },
  });
  if (!res.ok) {
    throw new Error(`News mentions fetch failed for ${query}: ${res.status}`);
  }
  const data = await res.json();
  const series = (data.timeline || []).find((item) => item.series === 'Article Count');
  return (series?.data || []).map((item) => ({
    date: `${item.date.slice(0, 4)}-${item.date.slice(4, 6)}-${item.date.slice(6, 8)}`,
    value: item.value,
  }));
}

async function fetchNewsMentionsWithRetry(query, startDate, endDate, attempts = 2) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchNewsMentions(query, startDate, endDate);
    } catch (err) {
      lastError = err;
      await sleep(NEWS_WAIT_MS);
    }
  }
  throw lastError;
}

export async function run() {
  await fs.mkdir(altDir, { recursive: true });

  const wikiMap = await loadWikiMap();
  const newsMap = await loadNewsMap();
  const universe = await loadUniverse();
  const newsUniverse = await loadPriorityUniverse();
  const end = new Date();
  const start = new Date(end.getTime() - (430 * DAY_MS));
  const startDate = toIsoDate(start);
  const endDate = toIsoDate(end);

  const searchTrendRows = [];
  const unresolved = [];
  const newsRows = [];
  const unresolvedNews = [];
  const fallbackNewsRows = await loadFallbackNewsRows();
  const newsProvenanceFile = path.join(altDir, 'news_mentions_provenance.csv');

  for (const ticker of universe) {
    const pageTitle = wikiMap[ticker];
    if (!pageTitle) {
      unresolved.push(ticker);
      continue;
    }

    try {
      const items = await fetchPageviews(pageTitle, startDate, endDate);
      for (const item of items) {
        searchTrendRows.push({
          date: item.date,
          ticker,
          value: item.value,
        });
      }
    } catch {
      unresolved.push(ticker);
    }
  }

  await fs.writeFile(path.join(altDir, 'search_trends.csv'), toCsv(searchTrendRows), 'utf8');

  const newsFile = path.join(altDir, 'news_mentions.csv');
  let reuseNews = false;
  try {
    const stat = await fs.stat(newsFile);
    reuseNews = toIsoDate(stat.mtime) === endDate;
  } catch {}

  if (!reuseNews) {
    for (let idx = 0; idx < newsUniverse.length; idx += 1) {
      const ticker = newsUniverse[idx];
      const query = newsMap[ticker] || titleToQuery(wikiMap[ticker]);
      if (!query) {
        unresolvedNews.push(ticker);
        continue;
      }

      try {
        const items = await fetchNewsMentionsWithRetry(query, startDate, endDate);
        for (const item of items) {
          newsRows.push({
            date: item.date,
            ticker,
            value: item.value,
          });
        }
      } catch {
        unresolvedNews.push(ticker);
      }

      if (idx < newsUniverse.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, NEWS_WAIT_MS));
      }
    }

    const mergedNewsRows = mergeNewsRows(newsRows, fallbackNewsRows);
    await fs.writeFile(newsFile, toCsv(mergedNewsRows), 'utf8');
    await fs.writeFile(newsProvenanceFile, toNewsProvenanceCsv(summarizeNewsProvenance(mergedNewsRows)), 'utf8');
    const fallbackOnlyCount = mergedNewsRows.filter((row) => row.source === 'finnhub_backfill').length;
    console.log(`News backfill rows added from Finnhub cache: ${fallbackOnlyCount}`);
  }

  console.log(`Wrote: ${path.join(altDir, 'search_trends.csv')}`);
  console.log(`Direct alt coverage: ${new Set(searchTrendRows.map((r) => r.ticker)).size}/${universe.length} tickers`);
  if (unresolved.length) {
    console.log(`Unresolved wiki mappings: ${unresolved.slice(0, 20).join(', ')}${unresolved.length > 20 ? ' ...' : ''}`);
  }
  if (reuseNews) {
    console.log(`Reused: ${newsFile}`);
    try {
      const existingRows = await loadExistingNewsRows(newsFile);
      const mergedNewsRows = existingRows.length
        ? existingRows.map((row) => ({ ...row, source: 'unknown' }))
        : mergeNewsRows([], fallbackNewsRows);
      if (!existingRows.length && mergedNewsRows.length) {
        await fs.writeFile(newsFile, toCsv(mergedNewsRows), 'utf8');
        console.log(`Seeded: ${newsFile} from Finnhub backfill cache`);
      }
      await fs.writeFile(newsProvenanceFile, toNewsProvenanceCsv(summarizeNewsProvenance(mergedNewsRows)), 'utf8');
      console.log(`Wrote: ${newsProvenanceFile}`);
    } catch {}
  } else {
    console.log(`Wrote: ${newsFile}`);
    console.log(`Wrote: ${newsProvenanceFile}`);
    const mergedCoverageRows = mergeNewsRows(newsRows, fallbackNewsRows);
    console.log(`News source coverage: ${new Set(mergedCoverageRows.map((r) => r.ticker)).size}/${newsUniverse.length} tickers`);
    if (unresolvedNews.length) {
      console.log(`Unresolved news queries: ${unresolvedNews.slice(0, 20).join(', ')}${unresolvedNews.length > 20 ? ' ...' : ''}`);
    }
  }
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
