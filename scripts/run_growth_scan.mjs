#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { createFundamentalsDataClient } from '../trading/providers/fundamentals_data.mjs';

const TZ = 'America/New_York';
const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const outDir = path.join(process.cwd(), 'trading', 'buckets');
const csvPath = path.join(outDir, `${dateStr}-growth-bucket.csv`);
const mdPath = path.join(outDir, `${dateStr}-growth-bucket.md`);

const FILTERS = {
  revenueCagr3yMin: 0.2,
  fcfCagr3yMin: 0.15,
  roicMin: 0.15,
  fcfMarginMin: 0.1,
  debtToEbitdaMax: 2,
};
const TARGET_BUCKET_SIZE = 75;

const CONCURRENCY = 8;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asNum(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

function cagr(start, end, years) {
  if (start == null || end == null || years <= 0) return null;
  if (start <= 0 || end <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

function safeDiv(a, b) {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

function clamp(v, lo = 0, hi = 1) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.min(hi, Math.max(lo, v));
}

function mean(vals) {
  const clean = vals.filter((v) => v != null && Number.isFinite(v));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function sanitizePositiveRatio(v, max = 100) {
  if (v == null || !Number.isFinite(v) || v <= 0 || v > max) return null;
  return v;
}

function sanitizeYield(v, min = -0.25, max = 0.25) {
  if (v == null || !Number.isFinite(v) || v < min || v > max) return null;
  return v;
}

function cappedContribution(v, scale, cap) {
  if (v == null || !Number.isFinite(v)) return 0;
  return Math.min(Math.max(v, 0), cap) * scale;
}

function pct(v) {
  return v == null ? '' : `${(v * 100).toFixed(2)}%`;
}

function num(v, d = 2) {
  return v == null ? '' : Number(v).toFixed(d);
}

function normalizeDateEpoch(dateValue) {
  const n = Number(dateValue);
  if (!Number.isFinite(n)) return null;
  if (n > 1e12) return n; // ms epoch
  if (n > 1e9) return n * 1000; // sec epoch
  return null;
}

function dedupeAndSortByDateDesc(rows) {
  const map = new Map();
  for (const row of rows) {
    const epochMs = normalizeDateEpoch(row?.date);
    if (!epochMs) continue;
    const year = new Date(epochMs).getUTCFullYear();
    if (year < 2000 || year > 2100) continue;

    if (!map.has(epochMs)) {
      map.set(epochMs, { ...row, date: epochMs });
    } else {
      Object.assign(map.get(epochMs), row);
    }
  }

  return [...map.values()].sort((a, b) => b.date - a.date);
}

function pickMetricSeries(rows, key) {
  return rows
    .map((r) => ({ date: r.date, value: asNum(r[key]) }))
    .filter((x) => x.value != null)
    .sort((a, b) => b.date - a.date);
}

function get3yCagrFromSeries(series) {
  if (series.length < 4) return null;
  const latest = series[0].value;
  const prior3y = series[3].value;
  return cagr(prior3y, latest, 3);
}

async function fetchSp500Symbols() {
  const url = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Failed to fetch S&P 500 page: ${res.status}`);
  const html = await res.text();

  const tableMatch = html.match(/<table[^>]*id="constituents"[\s\S]*?<\/table>/i);
  if (!tableMatch) throw new Error('Could not locate S&P 500 constituents table.');
  const table = tableMatch[0];

  const rowMatches = [...table.matchAll(/<tr>[\s\S]*?<\/tr>/gi)].slice(1);
  const symbols = rowMatches
    .map((rowMatch) => {
      const firstCell = rowMatch[0].match(/<td>([\s\S]*?)<\/td>/i);
      if (!firstCell) return null;
      const stripped = firstCell[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .trim();
      return stripped.toUpperCase().replace('.', '-');
    })
    .filter((s) => !!s && /^[A-Z\-]{1,8}$/.test(s));

  const deduped = [...new Set(symbols)];
  if (deduped.length < 400) {
    throw new Error(`Parsed only ${deduped.length} symbols; expected ~500.`);
  }

  return deduped;
}

async function withRetries(fn, retries = 2) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > retries) throw err;
      await sleep(300 * attempt);
    }
  }
}

async function fetchFundamentals(client, symbol) {
  const snapshot = await withRetries(() => client.getFundamentalsSnapshot(symbol));

  const missing = [];
  if (snapshot.revenueCagr3y == null) missing.push('revenue_cagr_3y');
  if (snapshot.fcfCagr3y == null) missing.push('fcf_cagr_3y');
  if (snapshot.roic == null) missing.push('roic');
  if (snapshot.fcfMargin == null) missing.push('fcf_margin');
  if (snapshot.debtToEbitda == null) missing.push('debt_to_ebitda');
  if (snapshot.trailingPe == null && snapshot.forwardPe == null && snapshot.priceToSales == null && snapshot.fcfYield == null) {
    missing.push('valuation');
  }

  const passed =
    snapshot.revenueCagr3y != null &&
    snapshot.fcfCagr3y != null &&
    snapshot.roic != null &&
    snapshot.fcfMargin != null &&
    snapshot.debtToEbitda != null &&
    snapshot.revenueCagr3y >= FILTERS.revenueCagr3yMin &&
    snapshot.fcfCagr3y >= FILTERS.fcfCagr3yMin &&
    snapshot.roic >= FILTERS.roicMin &&
    snapshot.fcfMargin >= FILTERS.fcfMarginMin &&
    snapshot.debtToEbitda <= FILTERS.debtToEbitdaMax;

  const coreMetrics = [
    snapshot.revenueCagr3y,
    snapshot.fcfCagr3y,
    snapshot.roic,
    snapshot.fcfMargin,
    snapshot.debtToEbitda,
  ];
  const coreCoverage = coreMetrics.filter((v) => v != null).length;
  const hardRejected = coreCoverage < 3;

  const qualityScore = [
    cappedContribution(snapshot.revenueCagr3y, 30, 0.8),
    cappedContribution(snapshot.fcfCagr3y, 30, 1.0),
    cappedContribution(snapshot.roic, 25, 0.5),
    cappedContribution(snapshot.fcfMargin, 10, 0.4),
    cappedContribution(snapshot.assetTurnover, 5, 1.5),
    snapshot.debtToEbitda != null ? Math.max(0, 2 - Math.min(Math.max(snapshot.debtToEbitda, 0), 3)) * 3 : 0,
  ].reduce((a, b) => a + b, 0);

  const coverageBonus = coreCoverage * 4;
  const missingPenalty = missing.length * 2;
  const leveragePenalty = snapshot.debtToEbitda != null && snapshot.debtToEbitda > FILTERS.debtToEbitdaMax
    ? Math.min((snapshot.debtToEbitda - FILTERS.debtToEbitdaMax) * 4, 20)
    : 0;

  return {
    symbol,
    revenueCagr3y: snapshot.revenueCagr3y,
    fcfCagr3y: snapshot.fcfCagr3y,
    roic: snapshot.roic,
    fcfMargin: snapshot.fcfMargin,
    debtToEbitda: snapshot.debtToEbitda,
    assetTurnover: snapshot.assetTurnover,
    sector: snapshot.sector,
    industry: snapshot.industry,
    marketCap: snapshot.marketCap,
    enterpriseValue: snapshot.enterpriseValue,
    trailingPe: snapshot.trailingPe,
    forwardPe: snapshot.forwardPe,
    priceToSales: snapshot.priceToSales,
    enterpriseToEbitda: snapshot.enterpriseToEbitda,
    enterpriseToRevenue: snapshot.enterpriseToRevenue,
    fcfYield: snapshot.fcfYield,
    dataProvider: snapshot.provider || '',
    qualityScore,
    preselectionScore: qualityScore + coverageBonus - missingPenalty - leveragePenalty,
    coreCoverage,
    missing,
    passed,
    hardRejected,
  };
}

function assignValuationScores(rows) {
  const MIN_INDUSTRY_GROUP = 4;
  const MIN_SECTOR_GROUP = 6;

  function metricVectors(sourceRows) {
    return {
      peVals: sourceRows.map((r) => r.forwardPe ?? r.trailingPe).filter((v) => v != null && v > 0).sort((a, b) => a - b),
      psVals: sourceRows.map((r) => r.priceToSales).filter((v) => v != null && v > 0).sort((a, b) => a - b),
      evEbitdaVals: sourceRows.map((r) => r.enterpriseToEbitda).filter((v) => v != null && v > 0).sort((a, b) => a - b),
      evRevenueVals: sourceRows.map((r) => r.enterpriseToRevenue).filter((v) => v != null && v > 0).sort((a, b) => a - b),
      fcfYieldVals: sourceRows.map((r) => r.fcfYield).filter((v) => v != null).sort((a, b) => a - b),
    };
  }

  const globalVectors = metricVectors(rows);
  const byIndustry = new Map();
  const bySector = new Map();

  for (const row of rows) {
    const industryKey = String(row.industry || '').trim();
    const sectorKey = String(row.sector || '').trim();
    if (industryKey) {
      if (!byIndustry.has(industryKey)) byIndustry.set(industryKey, []);
      byIndustry.get(industryKey).push(row);
    }
    if (sectorKey) {
      if (!bySector.has(sectorKey)) bySector.set(sectorKey, []);
      bySector.get(sectorKey).push(row);
    }
  }

  const industryVectors = new Map([...byIndustry.entries()].map(([k, groupRows]) => [k, metricVectors(groupRows)]));
  const sectorVectors = new Map([...bySector.entries()].map(([k, groupRows]) => [k, metricVectors(groupRows)]));

  function percentile(sorted, value) {
    if (value == null || !sorted.length) return null;
    const idx = sorted.findIndex((x) => x >= value);
    if (idx === -1) return 1;
    return idx / Math.max(sorted.length - 1, 1);
  }

  for (const row of rows) {
    const isFinancial =
      row.sector === 'FINANCIAL SERVICES' ||
      row.sector === 'FINANCIALS' ||
      row.industry.includes('BANK') ||
      row.industry.includes('BROKER') ||
      row.industry.includes('CAPITAL MARKET') ||
      row.industry.includes('INSURANCE');

    const industryGroup = byIndustry.get(row.industry || '') || [];
    const sectorGroup = bySector.get(row.sector || '') || [];
    const contextVectors = industryGroup.length >= MIN_INDUSTRY_GROUP
      ? industryVectors.get(row.industry || '')
      : sectorGroup.length >= MIN_SECTOR_GROUP
        ? sectorVectors.get(row.sector || '')
        : globalVectors;
    const valuationContext = industryGroup.length >= MIN_INDUSTRY_GROUP
      ? `industry:${row.industry}`
      : sectorGroup.length >= MIN_SECTOR_GROUP
        ? `sector:${row.sector}`
        : 'global';

    const pePct = percentile(contextVectors.peVals, row.forwardPe ?? row.trailingPe);
    const psPct = percentile(contextVectors.psVals, row.priceToSales);
    const evPct = percentile(contextVectors.evEbitdaVals, row.enterpriseToEbitda);
    const evRevenuePct = percentile(contextVectors.evRevenueVals, row.enterpriseToRevenue);
    const fcfPct = percentile(contextVectors.fcfYieldVals, row.fcfYield);

    const valuationComponents = isFinancial
      ? [
          pePct == null ? null : 1 - pePct,
          psPct == null ? null : 1 - psPct,
          fcfPct,
        ]
      : [
          pePct == null ? null : 1 - pePct,
          psPct == null ? null : 1 - psPct,
          evPct == null ? null : 1 - evPct,
          evRevenuePct == null ? null : 1 - evRevenuePct,
          fcfPct,
        ];

    row.valuationScore = clamp(mean(valuationComponents), 0, 1);
    row.valuationMethod = isFinancial ? 'financial_multiples' : 'enterprise_multiples';
    row.valuationContext = valuationContext;
    row.preselectionScore =
      (row.preselectionScore ?? row.qualityScore ?? 0) +
      ((row.valuationScore ?? 0.5) * 12) +
      (row.passed ? 6 : 0);
  }
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = [];
  let index = 0;

  async function runner() {
    while (true) {
      const i = index;
      index += 1;
      if (i >= items.length) break;
      const item = items[i];

      try {
        results[i] = await worker(item);
      } catch (err) {
        results[i] = { symbol: item, error: err instanceof Error ? err.message : String(err) };
      }

      await sleep(40);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runner()));
  return results;
}

function toCsv(rows) {
  const headers = [
    'symbol',
    'preselection_score',
    'passed_filters',
    'core_coverage',
    'quality_score',
    'valuation_score',
    'revenue_cagr_3y',
    'fcf_cagr_3y',
    'roic',
    'fcf_margin',
    'debt_to_ebitda',
    'asset_turnover',
    'sector',
    'industry',
    'valuation_method',
    'valuation_context',
    'market_cap',
    'enterprise_value',
    'trailing_pe',
    'forward_pe',
    'price_to_sales',
    'enterprise_to_ebitda',
    'enterprise_to_revenue',
    'fcf_yield',
    'missing_flags',
  ];

  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      r.symbol,
      num(r.preselectionScore, 6),
      r.passed ? 'true' : 'false',
      num(r.coreCoverage, 0),
      num(r.qualityScore, 6),
      num(r.valuationScore, 6),
      num(r.revenueCagr3y, 6),
      num(r.fcfCagr3y, 6),
      num(r.roic, 6),
      num(r.fcfMargin, 6),
      num(r.debtToEbitda, 6),
      num(r.assetTurnover, 6),
      r.sector || '',
      `"${r.industry || ''}"`,
      r.valuationMethod || '',
      `"${r.valuationContext || ''}"`,
      num(r.marketCap, 0),
      num(r.enterpriseValue, 0),
      num(r.trailingPe, 6),
      num(r.forwardPe, 6),
      num(r.priceToSales, 6),
      num(r.enterpriseToEbitda, 6),
      num(r.enterpriseToRevenue, 6),
      num(r.fcfYield, 6),
      `"${(r.missing ?? []).join('|')}"`,
    ].join(','));
  }
  return lines.join('\n');
}

function toMarkdown(summary) {
  const lines = [];
  lines.push(`# Growth Bucket Scan - ${dateStr}`);
  lines.push('');
  lines.push(`- Universe size: ${summary.universeSize}`);
  lines.push(`- Successfully evaluated: ${summary.evaluated}`);
  lines.push(`- Hard rejects removed: ${summary.hardRejectedCount}`);
  lines.push(`- Passed all filters: ${summary.passedCount}`);
  lines.push(`- Bucket size written: ${summary.bucketSize}`);
  lines.push('- Filters are now used as strong preferences, not the only way into the candidate bucket.');
  lines.push('');
  lines.push('## Top Ranked Names (up to 20)');
  lines.push('');
  lines.push('| Rank | Ticker | Preselection | Passed Filters | Growth Score | Valuation | Method | Context | Rev CAGR 3Y | FCF CAGR 3Y | ROIC | FCF Yield | Fwd P/E | EV/EBITDA | Missing Data |');
  lines.push('|---:|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---|');

  summary.top20.forEach((r, idx) => {
    lines.push(`| ${idx + 1} | ${r.symbol} | ${num(r.preselectionScore)} | ${r.passed ? 'yes' : 'no'} | ${num(r.qualityScore)} | ${num(r.valuationScore, 3)} | ${r.valuationMethod || '-'} | ${r.valuationContext || '-'} | ${pct(r.revenueCagr3y)} | ${pct(r.fcfCagr3y)} | ${pct(r.roic)} | ${pct(r.fcfYield)} | ${num(r.forwardPe)} | ${num(r.enterpriseToEbitda)} | ${(r.missing ?? []).join(', ') || 'none'} |`);
  });

  lines.push('');
  lines.push('## Missing Data Flags');
  lines.push('');
  if (summary.missingFlagCounts.length === 0) {
    lines.push('- none');
  } else {
    for (const [flag, count] of summary.missingFlagCounts) {
      lines.push(`- ${flag}: ${count}`);
    }
  }

  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push(`- Source: normalized fundamentals provider client with Yahoo fallback and Finnhub hooks. Bucket capped at top ${TARGET_BUCKET_SIZE} scored names.`);
  lines.push('- This is a candidate bucket for manual review, not investment advice.');

  return lines.join('\n');
}

export async function run() {
  await fs.mkdir(outDir, { recursive: true });
  const fundamentalsClient = await createFundamentalsDataClient(process.cwd());

  console.log('Fetching S&P 500 universe...');
  const symbols = await fetchSp500Symbols();
  console.log(`Universe loaded: ${symbols.length} symbols`);
  console.log(`Fundamentals provider order: ${fundamentalsClient.providerOrder.join(' -> ')}`);

  console.log('Running scan...');
  const results = await runWithConcurrency(symbols, CONCURRENCY, (symbol) => fetchFundamentals(fundamentalsClient, symbol));

  const evaluated = results.filter((r) => r && !r.error);
  assignValuationScores(evaluated);
  const errors = results.filter((r) => r && r.error);
  const candidates = evaluated
    .filter((r) => !r.hardRejected)
    .sort((a, b) => (b.preselectionScore ?? 0) - (a.preselectionScore ?? 0));
  const bucketRows = candidates.slice(0, TARGET_BUCKET_SIZE);
  const passed = bucketRows.filter((r) => r.passed);

  const missingCount = new Map();
  for (const row of evaluated) {
    for (const flag of row.missing ?? []) {
      missingCount.set(flag, (missingCount.get(flag) ?? 0) + 1);
    }
  }

  const summary = {
    universeSize: symbols.length,
    evaluated: evaluated.length,
    hardRejectedCount: evaluated.filter((r) => r.hardRejected).length,
    passedCount: passed.length,
    bucketSize: bucketRows.length,
    top20: bucketRows.slice(0, 20),
    missingFlagCounts: [...missingCount.entries()].sort((a, b) => b[1] - a[1]),
  };

  await fs.writeFile(csvPath, toCsv(bucketRows), 'utf8');
  await fs.writeFile(mdPath, toMarkdown(summary), 'utf8');

  console.log(`Done. Evaluated: ${evaluated.length}. Bucket: ${bucketRows.length}. Passed filters: ${passed.length}. Errors: ${errors.length}.`);
  if (errors.length) {
    console.log('Sample errors:');
    errors.slice(0, 5).forEach((e) => console.log(`- ${e.symbol}: ${e.error}`));
  }
  console.log(`CSV: ${csvPath}`);
  console.log(`MD: ${mdPath}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}

