#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCsv, readJson, toCsv } from '../scripts/lib.mjs';
import { createMarketDataClient } from '../providers/market_data.mjs';

const root = process.cwd();

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function findCloseOnOrAfter(series, dateStr) {
  for (const p of series) {
    if (p.date >= dateStr && p.close != null) return p.close;
  }
  return null;
}

function findIndexOnOrAfter(series, dateStr) {
  return series.findIndex((p) => p.date >= dateStr && p.close != null);
}

function realizedVol(series, dateStr, lookbackDays = 20) {
  const endIdx = findIndexOnOrAfter(series, dateStr);
  if (endIdx < 1) return null;
  const startIdx = Math.max(1, endIdx - lookbackDays + 1);
  const returns = [];

  for (let i = startIdx; i <= endIdx; i += 1) {
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

async function fetchSeries(client, symbol, startDate, endDate) {
  const rows = await client.getDailyBars(symbol, startDate, endDate);
  return (rows || [])
    .map((r) => ({ date: isoDate(r.date), close: r.adjClose ?? r.close ?? null }))
    .filter((r) => r.close != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildReturnRow(reportDate, spySeries, qqqSeries, vixSeries, rspSeries, sectorSeriesMap) {
  const spyStart = findCloseOnOrAfter(spySeries, reportDate);
  const qqqStart = findCloseOnOrAfter(qqqSeries, reportDate);
  const vixStart = findCloseOnOrAfter(vixSeries, reportDate);
  const rspStart = findCloseOnOrAfter(rspSeries, reportDate);

  const spy5 = findCloseOnOrAfter(spySeries, addDays(reportDate, 5));
  const qqq5 = findCloseOnOrAfter(qqqSeries, addDays(reportDate, 5));
  const vix5 = findCloseOnOrAfter(vixSeries, addDays(reportDate, 5));
  const spy20 = findCloseOnOrAfter(spySeries, addDays(reportDate, 20));
  const qqq20 = findCloseOnOrAfter(qqqSeries, addDays(reportDate, 20));
  const rsp20 = findCloseOnOrAfter(rspSeries, addDays(reportDate, 20));

  const ret = (end, start) => (start && end) ? ((end / start) - 1) : null;
  const sector20Returns = Object.values(sectorSeriesMap)
    .map((series) => {
      const start = findCloseOnOrAfter(series, reportDate);
      const end = findCloseOnOrAfter(series, addDays(reportDate, 20));
      return ret(end, start);
    })
    .filter((v) => v != null);
  const sectorPositiveCount = sector20Returns.filter((v) => v > 0).length;
  const sectorPositiveRatio = sector20Returns.length ? (sectorPositiveCount / sector20Returns.length) : null;

  return {
    report_date: reportDate,
    spy_return_5d: ret(spy5, spyStart),
    spy_return_20d: ret(spy20, spyStart),
    qqq_return_5d: ret(qqq5, qqqStart),
    qqq_return_20d: ret(qqq20, qqqStart),
    rsp_return_20d: ret(rsp20, rspStart),
    rsp_spy_relative_20d: (rspStart && rsp20 && spyStart && spy20) ? (((rsp20 / rspStart) - 1) - ((spy20 / spyStart) - 1)) : null,
    sector_positive_ratio_20d: sectorPositiveRatio,
    vix_close: vixStart,
    vix_change_5d: ret(vix5, vixStart),
    spy_realized_vol_20d: realizedVol(spySeries, reportDate, 20),
    qqq_realized_vol_20d: realizedVol(qqqSeries, reportDate, 20),
  };
}

export async function run() {
  const tradingDir = path.join(root, 'trading');
  const outcomesPath = path.join(tradingDir, 'data', 'alt', 'earnings_outcomes.csv');
  const backtestCfg = await readJson(path.join(tradingDir, 'backtest', 'config', 'model_variants.json'));

  const text = await fs.readFile(outcomesPath, 'utf8');
  const outcomes = parseCsv(text);
  const dates = [...new Set(outcomes.map((r) => r.report_date).filter(Boolean))].sort();

  if (!dates.length) {
    throw new Error('No report_date values found in earnings_outcomes.csv');
  }

  const holdDays = Number(backtestCfg?.selection?.hold_days ?? 20);
  const start = addDays(dates[0], -12);
  const end = addDays(dates[dates.length - 1], holdDays + 30);

  let spySeries = [];
  let qqqSeries = [];
  let vixSeries = [];
  let rspSeries = [];
  let sectorSeriesMap = {};
  let mode = 'LIVE';
  let providerOrder = [];

  try {
    const client = await createMarketDataClient(root);
    providerOrder = client.providerOrder || [];
    const sectorSymbols = ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLP', 'XLU', 'XLY', 'XLB', 'XLRE', 'XLC'];
    const sectorSeriesList = await Promise.all(sectorSymbols.map((symbol) => fetchSeries(client, symbol, start, end)));
    [spySeries, qqqSeries, vixSeries, rspSeries] = await Promise.all([
      fetchSeries(client, 'SPY', start, end),
      fetchSeries(client, 'QQQ', start, end),
      fetchSeries(client, '^VIX', start, end),
      fetchSeries(client, 'RSP', start, end),
    ]);
    sectorSeriesMap = Object.fromEntries(sectorSymbols.map((symbol, idx) => [symbol, sectorSeriesList[idx]]));
  } catch (err) {
    mode = 'FALLBACK_EMPTY';
    console.warn(`Benchmark fetch failed, writing empty benchmark file: ${err instanceof Error ? err.message : String(err)}`);
  }

  const rows = dates.map((d) => buildReturnRow(d, spySeries, qqqSeries, vixSeries, rspSeries, sectorSeriesMap));

  const outPath = path.join(tradingDir, 'data', 'alt', 'benchmark_returns.csv');
  await fs.writeFile(outPath, toCsv(rows, [
    'report_date',
    'spy_return_5d',
    'spy_return_20d',
    'qqq_return_5d',
    'qqq_return_20d',
    'rsp_return_20d',
    'rsp_spy_relative_20d',
    'sector_positive_ratio_20d',
    'vix_close',
    'vix_change_5d',
    'spy_realized_vol_20d',
    'qqq_realized_vol_20d',
  ]), 'utf8');

  const coverage = rows.filter((r) => r.spy_return_20d != null || r.qqq_return_20d != null).length;
  console.log(`Wrote: ${outPath}`);
  console.log(`Mode: ${mode}`);
  console.log(`Provider order: ${(providerOrder || []).join(' -> ') || 'unknown'}`);
  console.log(`Benchmark coverage: ${coverage}/${rows.length} event dates`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
