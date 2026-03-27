#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, readJson, toCsv } from '../scripts/lib.mjs';
import { createMarketDataClient } from '../providers/market_data.mjs';

const root = process.cwd();

const SECTOR_SYMBOLS = ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLP', 'XLU', 'XLY', 'XLB', 'XLRE', 'XLC'];
const SECTOR_LABELS = {
  XLK: 'TECH',
  XLF: 'FINANCIALS',
  XLE: 'ENERGY',
  XLV: 'HEALTHCARE',
  XLI: 'INDUSTRIALS',
  XLP: 'STAPLES',
  XLU: 'UTILITIES',
  XLY: 'DISCRETIONARY',
  XLB: 'MATERIALS',
  XLRE: 'REAL_ESTATE',
  XLC: 'COMMUNICATIONS',
};

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

async function fetchSeries(client, symbol, startDate, endDate) {
  const rows = await client.getDailyBars(symbol, startDate, endDate);
  return (rows || [])
    .map((r) => ({ date: isoDate(r.date), close: r.adjClose ?? r.close ?? null }))
    .filter((r) => r.close != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function seriesToMap(series) {
  return new Map(series.map((r) => [r.date, r.close]));
}

function trailingReturn(series, idx, days) {
  const end = series[idx]?.close;
  const start = series[idx - days]?.close;
  if (end == null || start == null || start <= 0) return null;
  return (end / start) - 1;
}

function realizedVol(series, idx, lookbackDays = 20) {
  if (idx < 1) return null;
  const startIdx = Math.max(1, idx - lookbackDays + 1);
  const returns = [];

  for (let i = startIdx; i <= idx; i += 1) {
    const prev = series[i - 1]?.close;
    const curr = series[i]?.close;
    if (prev == null || curr == null || prev <= 0 || curr <= 0) continue;
    returns.push(Math.log(curr / prev));
  }

  if (returns.length < Math.max(5, Math.floor(lookbackDays / 2))) return null;
  const mean = returns.reduce((sum, v) => sum + v, 0) / returns.length;
  const variance = returns.reduce((sum, v) => sum + ((v - mean) ** 2), 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}

function buildRows(spySeries, qqqSeries, rspSeries, vixSeries, sectorSeriesMap) {
  const qqqMap = seriesToMap(qqqSeries);
  const rspMap = seriesToMap(rspSeries);
  const vixMap = seriesToMap(vixSeries);
  const rows = [];
  const seenDates = new Set();

  for (let idx = 0; idx < spySeries.length; idx += 1) {
    const marketDate = spySeries[idx].date;
    if (seenDates.has(marketDate)) continue;
    seenDates.add(marketDate);
    const spyClose = spySeries[idx].close;
    const qqqClose = qqqMap.get(marketDate);
    const rspClose = rspMap.get(marketDate);
    const vixClose = vixMap.get(marketDate);
    if (spyClose == null || qqqClose == null || rspClose == null) continue;

    const qqqIdx = qqqSeries.findIndex((r) => r.date === marketDate);
    const rspIdx = rspSeries.findIndex((r) => r.date === marketDate);
    const vixIdx = vixSeries.findIndex((r) => r.date === marketDate);
    if (qqqIdx < 0 || rspIdx < 0) continue;

    const spyReturn5d = trailingReturn(spySeries, idx, 5);
    const spyReturn20d = trailingReturn(spySeries, idx, 20);
    const qqqReturn5d = trailingReturn(qqqSeries, qqqIdx, 5);
    const qqqReturn20d = trailingReturn(qqqSeries, qqqIdx, 20);
    const rspReturn20d = trailingReturn(rspSeries, rspIdx, 20);
    const rspSpyRelative20d = spyReturn20d != null && rspReturn20d != null ? (rspReturn20d - spyReturn20d) : null;
    const vixChange5d = vixIdx >= 5 ? trailingReturn(vixSeries, vixIdx, 5) : null;
    const spyRealizedVol20d = realizedVol(spySeries, idx, 20);
    const qqqRealizedVol20d = realizedVol(qqqSeries, qqqIdx, 20);

    const sectorReturns20d = Object.entries(sectorSeriesMap)
      .map(([symbol, series]) => {
        const sectorIdx = series.findIndex((r) => r.date === marketDate);
        const sectorReturn20d = sectorIdx >= 0 ? trailingReturn(series, sectorIdx, 20) : null;
        return sectorReturn20d == null ? null : {
          symbol,
          sector: SECTOR_LABELS[symbol] || symbol,
          return20d: sectorReturn20d,
        };
      })
      .filter(Boolean);
    const sectorPositiveRatio20d = sectorReturns20d.length
      ? sectorReturns20d.filter((v) => v.return20d > 0).length / sectorReturns20d.length
      : null;
    const orderedSectors = [...sectorReturns20d].sort((a, b) => b.return20d - a.return20d);
    const topSectorLeaders20d = orderedSectors
      .slice(0, 3)
      .map((row) => `${row.sector}:${row.return20d.toFixed(3)}`)
      .join('|');
    const topSectorLaggards20d = [...orderedSectors]
      .reverse()
      .slice(0, 3)
      .map((row) => `${row.sector}:${row.return20d.toFixed(3)}`)
      .join('|');

    rows.push({
      market_date: marketDate,
      spy_return_5d: spyReturn5d,
      spy_return_20d: spyReturn20d,
      qqq_return_5d: qqqReturn5d,
      qqq_return_20d: qqqReturn20d,
      rsp_return_20d: rspReturn20d,
      rsp_spy_relative_20d: rspSpyRelative20d,
      sector_positive_ratio_20d: sectorPositiveRatio20d,
      top_sector_leaders_20d: topSectorLeaders20d,
      top_sector_laggards_20d: topSectorLaggards20d,
      vix_close: vixClose,
      vix_change_5d: vixChange5d,
      spy_realized_vol_20d: spyRealizedVol20d,
      qqq_realized_vol_20d: qqqRealizedVol20d,
    });
  }

  return rows;
}

export async function run() {
  const tradingDir = path.join(root, 'trading');
  const profile = await readJson(path.join(tradingDir, 'config', 'profile.json'));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: profile?.timezone || 'America/New_York' });
  const start = addDays(today, -180);
  const end = today;
  const client = await createMarketDataClient(root);

  const sectorSeriesList = await Promise.all(SECTOR_SYMBOLS.map((symbol) => fetchSeries(client, symbol, start, end)));
  const [spySeries, qqqSeries, rspSeries, vixSeries] = await Promise.all([
    fetchSeries(client, 'SPY', start, end),
    fetchSeries(client, 'QQQ', start, end),
    fetchSeries(client, 'RSP', start, end),
    fetchSeries(client, '^VIX', start, end),
  ]);

  const sectorSeriesMap = Object.fromEntries(SECTOR_SYMBOLS.map((symbol, idx) => [symbol, sectorSeriesList[idx]]));
  const rows = buildRows(spySeries, qqqSeries, rspSeries, vixSeries, sectorSeriesMap);
  if (!rows.length) {
    throw new Error('No daily market context rows generated.');
  }

  const outDir = path.join(tradingDir, 'data', 'alt');
  await ensureDir(outDir);
  const outPath = path.join(outDir, 'daily_market_context.csv');
  await fs.writeFile(outPath, toCsv(rows, [
    'market_date',
    'spy_return_5d',
    'spy_return_20d',
    'qqq_return_5d',
    'qqq_return_20d',
    'rsp_return_20d',
    'rsp_spy_relative_20d',
    'sector_positive_ratio_20d',
    'top_sector_leaders_20d',
    'top_sector_laggards_20d',
    'vix_close',
    'vix_change_5d',
    'spy_realized_vol_20d',
    'qqq_realized_vol_20d',
  ]), 'utf8');

  console.log(`Wrote: ${outPath}`);
  console.log(`Daily market rows: ${rows.length}`);
  console.log(`Latest market date: ${rows[rows.length - 1].market_date}`);
  console.log(`Provider order: ${(client.providerOrder || []).join(' -> ') || 'unknown'}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
