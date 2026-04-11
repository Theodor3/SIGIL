import YahooFinance from 'yahoo-finance2';
import { loadLocalEnv } from './env.mjs';

const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'], validation: { logErrors: false, logOptionsErrors: false } });

function asNum(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

function safeDiv(a, b) {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

function cagr(start, end, years) {
  if (start == null || end == null || years <= 0) return null;
  if (start <= 0 || end <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

function sanitizePositiveRatio(v, max = 100) {
  if (v == null || !Number.isFinite(v) || v <= 0 || v > max) return null;
  return v;
}

function sanitizeYield(v, min = -0.25, max = 0.25) {
  if (v == null || !Number.isFinite(v) || v < min || v > max) return null;
  return v;
}

function normalizeMarketCapUsd(v) {
  const raw = asNum(v);
  if (raw == null) return null;
  // Finnhub commonly returns market cap in millions while the rest of the
  // trading stack expects raw USD.
  return raw > 1_000_000 ? raw : raw * 1_000_000;
}

function normalizeDateEpoch(dateValue) {
  const n = Number(dateValue);
  if (!Number.isFinite(n)) return null;
  if (n > 1e12) return n;
  if (n > 1e9) return n * 1000;
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
  return cagr(series[3].value, series[0].value, 3);
}

async function httpJson(url) {
  const parsed = new URL(url);
  const label = `${parsed.hostname}${parsed.pathname}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'playground-trading-console/1.0',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${label}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Non-JSON response (${res.status}) from ${label}`);
  }
  return res.json();
}

async function fetchYahooFundamentalsSnapshot(symbol) {
  const annualRowsRaw = await yahooFinance.fundamentalsTimeSeries(symbol, {
    period1: '2018-01-01',
    period2: new Date().toISOString().slice(0, 10),
    type: 'annual',
    module: 'all',
  });

  const annualRows = dedupeAndSortByDateDesc(annualRowsRaw);
  if (annualRows.length === 0) {
    throw new Error('No annual fundamentals rows returned');
  }

  const revenueSeries = pickMetricSeries(annualRows, 'totalRevenue');
  const fcfSeries = annualRows
    .map((r) => {
      const cfo = asNum(r.operatingCashFlow);
      const capex = asNum(r.capitalExpenditure);
      if (cfo == null || capex == null) return null;
      return { date: r.date, value: cfo + capex };
    })
    .filter(Boolean)
    .sort((a, b) => b.date - a.date);

  const revenueCagr3y = get3yCagrFromSeries(revenueSeries);
  const fcfCagr3y = get3yCagrFromSeries(fcfSeries);

  const latest = annualRows[0];
  const latestRevenue = asNum(latest.totalRevenue);
  const latestFcf = (() => {
    const cfo = asNum(latest.operatingCashFlow);
    const capex = asNum(latest.capitalExpenditure);
    return cfo == null || capex == null ? null : cfo + capex;
  })();

  const operatingIncome = asNum(latest.operatingIncome);
  const taxRate = asNum(latest.taxRateForCalcs);
  const normalizedTaxRate = taxRate == null ? 0.21 : Math.min(Math.max(taxRate, 0), 0.35);
  const nopat = operatingIncome == null ? null : operatingIncome * (1 - normalizedTaxRate);

  const totalEquity = asNum(latest.stockholdersEquity);
  const longTermDebt = asNum(latest.longTermDebtAndCapitalLeaseObligation);
  const shortTermDebt = asNum(latest.currentDebtAndCapitalLeaseObligation);
  const cash = asNum(latest.cashAndCashEquivalents);
  const investedCapitalRaw = [totalEquity, longTermDebt, shortTermDebt]
    .filter((v) => v != null)
    .reduce((a, b) => a + b, 0);
  const investedCapital = investedCapitalRaw > 0 ? investedCapitalRaw - (cash ?? 0) : null;

  const roic = safeDiv(nopat, investedCapital);
  const fcfMargin = safeDiv(latestFcf, latestRevenue);
  const totalAssets = asNum(latest.totalAssets);
  const assetTurnover = safeDiv(latestRevenue, totalAssets);
  const depreciation = asNum(latest.depreciationAndAmortization);
  const ebitdaApprox =
    operatingIncome == null ? null : operatingIncome + (depreciation == null ? 0 : depreciation);
  const totalDebt = asNum(latest.totalDebt) ??
    [longTermDebt, shortTermDebt].filter((v) => v != null).reduce((a, b) => a + b, 0);
  const debtToEbitda = safeDiv(totalDebt, ebitdaApprox);

  let summary = {};
  try {
    summary = await yahooFinance.quoteSummary(symbol, {
      modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile'],
    });
  } catch {
    summary = {};
  }

  const marketCap = asNum(summary?.price?.marketCap) ??
    asNum(summary?.summaryDetail?.marketCap) ??
    asNum(summary?.defaultKeyStatistics?.marketCap);
  const enterpriseValue = asNum(summary?.defaultKeyStatistics?.enterpriseValue) ??
    asNum(summary?.financialData?.enterpriseValue);

  return {
    symbol,
    revenueCagr3y,
    fcfCagr3y,
    roic,
    fcfMargin,
    debtToEbitda,
    assetTurnover,
    sector: String(summary?.assetProfile?.sector || '').toUpperCase(),
    industry: String(summary?.assetProfile?.industry || '').toUpperCase(),
    marketCap,
    enterpriseValue,
    trailingPe: sanitizePositiveRatio(
      asNum(summary?.summaryDetail?.trailingPE) ??
      asNum(summary?.defaultKeyStatistics?.trailingPE)
    ),
    forwardPe: sanitizePositiveRatio(
      asNum(summary?.summaryDetail?.forwardPE) ??
      asNum(summary?.defaultKeyStatistics?.forwardPE)
    ),
    priceToSales: sanitizePositiveRatio(
      asNum(summary?.summaryDetail?.priceToSalesTrailing12Months) ??
      asNum(summary?.defaultKeyStatistics?.priceToSalesTrailing12Months)
    ),
    enterpriseToEbitda: sanitizePositiveRatio(
      asNum(summary?.defaultKeyStatistics?.enterpriseToEbitda) ??
      (enterpriseValue != null && ebitdaApprox != null ? safeDiv(enterpriseValue, ebitdaApprox) : null),
      80
    ),
    enterpriseToRevenue: sanitizePositiveRatio(
      asNum(summary?.defaultKeyStatistics?.enterpriseToRevenue) ??
      (enterpriseValue != null && latestRevenue != null ? safeDiv(enterpriseValue, latestRevenue) : null),
      50
    ),
    fcfYield: sanitizeYield(marketCap != null && latestFcf != null ? safeDiv(latestFcf, marketCap) : null),
    provider: 'yahoo',
  };
}

async function fetchFinnhubBasicSnapshot(symbol, apiKey) {
  const encoded = encodeURIComponent(symbol);
  const [profile, basic] = await Promise.all([
    httpJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${encoded}&token=${encodeURIComponent(apiKey)}`),
    httpJson(`https://finnhub.io/api/v1/stock/metric?symbol=${encoded}&metric=all&token=${encodeURIComponent(apiKey)}`),
  ]);
  const metric = basic?.metric || {};

  return {
    symbol,
    revenueCagr3y: null,
    fcfCagr3y: null,
    roic: asNum(metric?.roiCAnnual),
    fcfMargin: asNum(metric?.fcfMarginAnnual),
    debtToEbitda:
      asNum(metric?.netDebtToEBITDAAnnual) ??
      asNum(metric?.netDebtToEbitdaAnnual) ??
      asNum(metric?.totalDebtToEBITDAAnnual) ??
      asNum(metric?.totalDebtToEbitdaAnnual),
    assetTurnover: asNum(metric?.assetTurnoverAnnual),
    sector: '',
    industry: String(profile?.finnhubIndustry || '').toUpperCase(),
    marketCap: normalizeMarketCapUsd(profile?.marketCapitalization),
    enterpriseValue: null,
    trailingPe: sanitizePositiveRatio(asNum(metric?.peBasicExclExtraTTM)),
    forwardPe: sanitizePositiveRatio(asNum(metric?.peNormalizedAnnual)),
    priceToSales: sanitizePositiveRatio(asNum(metric?.psTTM)),
    enterpriseToEbitda: sanitizePositiveRatio(asNum(metric?.evToEbitdaAnnual), 80),
    enterpriseToRevenue: sanitizePositiveRatio(asNum(metric?.evToSalesAnnual), 50),
    fcfYield: sanitizeYield(asNum(metric?.fcfYieldTTM)),
    provider: 'finnhub',
  };
}

function mergeSnapshots(primary, fallback) {
  const merged = { ...fallback, ...primary };
  for (const key of Object.keys(fallback || {})) {
    if (merged[key] == null || merged[key] === '') {
      merged[key] = fallback[key];
    }
  }
  return merged;
}

export async function createFundamentalsDataClient(root = process.cwd()) {
  await loadLocalEnv(root);
  const hasFinnhub = Boolean(process.env.FINNHUB_API_KEY);

  return {
    providerOrder: hasFinnhub ? ['finnhub', 'yahoo'] : ['yahoo'],

    async getFundamentalsSnapshot(symbol) {
      let yahooSnapshot = null;
      let finnhubSnapshot = null;

      if (hasFinnhub) {
        try {
          finnhubSnapshot = await fetchFinnhubBasicSnapshot(symbol, process.env.FINNHUB_API_KEY);
        } catch {
          finnhubSnapshot = null;
        }
      }

      try {
        yahooSnapshot = await fetchYahooFundamentalsSnapshot(symbol);
      } catch (err) {
        if (!finnhubSnapshot) throw err;
      }

      if (finnhubSnapshot && yahooSnapshot) {
        return mergeSnapshots(finnhubSnapshot, yahooSnapshot);
      }
      return finnhubSnapshot || yahooSnapshot;
    },

    async getEarningsCalendar(fromDate, toDate, symbols = []) {
      if (!hasFinnhub) return [];
      const json = await httpJson(`https://finnhub.io/api/v1/calendar/earnings?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}&token=${encodeURIComponent(process.env.FINNHUB_API_KEY)}`);
      const rows = Array.isArray(json?.earningsCalendar) ? json.earningsCalendar : [];
      const allow = new Set((symbols || []).map((s) => String(s || '').toUpperCase()).filter(Boolean));

      return rows
        .filter((row) => !allow.size || allow.has(String(row.symbol || '').toUpperCase()))
        .map((row) => ({
          ticker: String(row.symbol || '').toUpperCase(),
          report_date: row.date || '',
          eps_estimate: asNum(row.epsEstimate),
          revenue_estimate: asNum(row.revenueEstimate),
          hour: row.hour || '',
          provider: 'finnhub',
        }));
    },

    async getCompanyNews(symbol, fromDate, toDate) {
      if (!hasFinnhub) return [];
      const encoded = encodeURIComponent(symbol);
      const json = await httpJson(`https://finnhub.io/api/v1/company-news?symbol=${encoded}&from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}&token=${encodeURIComponent(process.env.FINNHUB_API_KEY)}`);
      return (Array.isArray(json) ? json : []).map((row) => ({
        ticker: symbol,
        source: row.source || '',
        headline: row.headline || '',
        summary: row.summary || '',
        published_at: row.datetime ? new Date(row.datetime * 1000).toISOString() : '',
        url: row.url || '',
        provider: 'finnhub',
      }));
    },
  };
}
