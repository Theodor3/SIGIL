import YahooFinance from 'yahoo-finance2';
import { loadLocalEnv } from './env.mjs';

const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'], validation: { logErrors: false, logOptionsErrors: false } });

async function httpJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'playground-trading-console/1.0',
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${url} ${body.slice(0, 180)}`.trim());
  }

  return res.json();
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeMarketCapUsd(value, provider) {
  const raw = asNumber(value);
  if (raw == null) return null;
  if (provider === 'finnhub' && raw <= 1_000_000) return raw * 1_000_000;
  return raw;
}

function normalizeQuote(row, provider, symbol) {
  return {
    symbol,
    price: asNumber(
      row?.price ??
      row?.regularMarketPrice ??
      row?.current ??
      row?.c ??
      row?.close
    ),
    previousClose: asNumber(
      row?.previousClose ??
      row?.pc
    ),
    avgDailyVolume: asNumber(
      row?.avgDailyVolume ??
      row?.averageDailyVolume3Month ??
      row?.averageDailyVolume10Day ??
      row?.volume ??
      row?.regularMarketVolume
    ),
    marketCap: asNumber(
      normalizeMarketCapUsd(
        row?.marketCap ??
        row?.marketCapitalization,
        provider,
      )
    ),
    provider,
  };
}

function normalizeProfile(row, provider, symbol) {
  return {
    symbol,
    sector: String(row?.sector || row?.finnhubIndustry || row?.industry || '').trim(),
    industry: String(row?.industry || row?.finnhubIndustry || '').trim(),
    marketCap: asNumber(
      normalizeMarketCapUsd(
        row?.marketCap ??
        row?.marketCapitalization,
        provider,
      )
    ),
    provider,
  };
}

function buildQuoteProviderOrder() {
  const preferred = String(process.env.TRADING_MARKET_DATA_PROVIDER || process.env.TRADING_FUNDAMENTALS_PROVIDER || 'finnhub').toLowerCase();
  const order = [];

  if (preferred === 'finnhub' && process.env.FINNHUB_API_KEY) {
    order.push('finnhub');
  }
  if ((preferred === 'polygon' || preferred === 'massive') && (process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY)) {
    order.push('polygon');
  }
  if (!order.includes('finnhub') && process.env.FINNHUB_API_KEY) {
    order.push('finnhub');
  }
  if (!order.includes('polygon') && (process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY)) {
    order.push('polygon');
  }

  order.push('yahoo');
  return order;
}

async function fetchFinnhubQuote(symbol, apiKey) {
  const encodedSymbol = encodeURIComponent(symbol);
  const quote = await httpJson(`https://finnhub.io/api/v1/quote?symbol=${encodedSymbol}&token=${encodeURIComponent(apiKey)}`);
  let profile = {};
  try {
    profile = await httpJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodedSymbol}&token=${encodeURIComponent(apiKey)}`);
  } catch {
    profile = {};
  }

  return {
    ...normalizeQuote(quote, 'finnhub', symbol),
    ...normalizeProfile(profile, 'finnhub', symbol),
  };
}

async function fetchPolygonQuote(symbol, apiKey) {
  const encodedSymbol = encodeURIComponent(symbol);
  const snapshot = await httpJson(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${encodedSymbol}?apiKey=${encodeURIComponent(apiKey)}`);
  const ticker = snapshot?.ticker || {};
  const prevDay = ticker?.prevDay || {};
  const day = ticker?.day || {};
  const details = ticker?.details || {};

  return {
    ...normalizeQuote({
      price: day?.c ?? ticker?.min?.c,
      previousClose: prevDay?.c,
      avgDailyVolume: details?.average_volume,
      marketCap: details?.market_cap,
    }, 'polygon', symbol),
    ...normalizeProfile({
      sector: details?.sic_description || '',
      industry: details?.type || '',
      marketCap: details?.market_cap,
    }, 'polygon', symbol),
  };
}

async function fetchYahooQuote(symbol) {
  const quote = await yahooFinance.quote(symbol);
  let summary = {};
  try {
    summary = await yahooFinance.quoteSummary(symbol, {
      modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile'],
    });
  } catch {
    summary = {};
  }

  return {
    ...normalizeQuote({
      regularMarketPrice: quote?.regularMarketPrice ?? quote?.postMarketPrice ?? quote?.preMarketPrice,
      previousClose: quote?.regularMarketPreviousClose,
      averageDailyVolume3Month: quote?.averageDailyVolume3Month,
      averageDailyVolume10Day: quote?.averageDailyVolume10Day,
      regularMarketVolume: quote?.regularMarketVolume,
      marketCap: quote?.marketCap ?? summary?.price?.marketCap ?? summary?.summaryDetail?.marketCap,
    }, 'yahoo', symbol),
    ...normalizeProfile({
      sector: summary?.assetProfile?.sector,
      industry: summary?.assetProfile?.industry,
      marketCap: summary?.price?.marketCap ?? summary?.summaryDetail?.marketCap,
    }, 'yahoo', symbol),
  };
}

export async function createReferenceDataClient(root = process.cwd()) {
  await loadLocalEnv(root);
  const providerOrder = buildQuoteProviderOrder();

  return {
    providerOrder,
    async getQuote(symbol) {
      const errors = [];

      for (const provider of providerOrder) {
        try {
          if (provider === 'finnhub') {
            const apiKey = process.env.FINNHUB_API_KEY;
            if (!apiKey) continue;
            return await fetchFinnhubQuote(symbol, apiKey);
          }

          if (provider === 'polygon') {
            const apiKey = process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY;
            if (!apiKey) continue;
            return await fetchPolygonQuote(symbol, apiKey);
          }

          if (provider === 'yahoo') {
            return await fetchYahooQuote(symbol);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${provider}: ${msg}`);
        }
      }

      throw new Error(`No quote provider succeeded for ${symbol}. ${errors.join(' | ')}`);
    },

    async getQuoteMap(symbols) {
      const out = new Map();
      await Promise.all((symbols || []).map(async (symbol) => {
        try {
          out.set(symbol, await this.getQuote(symbol));
        } catch {
          out.set(symbol, {
            symbol,
            price: null,
            previousClose: null,
            avgDailyVolume: null,
            marketCap: null,
            sector: '',
            industry: '',
            provider: 'none',
          });
        }
      }));
      return out;
    },
  };
}
