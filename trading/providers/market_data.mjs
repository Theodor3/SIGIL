import YahooFinance from 'yahoo-finance2';
import { loadLocalEnv } from './env.mjs';

const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });

function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function normalizeBars(rows, provider, symbol) {
  return (rows || [])
    .map((row) => {
      const rawClose = row?.close ?? null;
      const rawAdjClose = row?.adjClose ?? row?.adjclose ?? null;
      const close = rawClose == null ? (rawAdjClose == null ? null : Number(rawAdjClose)) : Number(rawClose);
      const adjClose = rawAdjClose == null ? close : Number(rawAdjClose);

      return {
        date: isoDate(row.date),
        open: row.open == null ? null : Number(row.open),
        high: row.high == null ? null : Number(row.high),
        low: row.low == null ? null : Number(row.low),
        close,
        adjClose,
        volume: row.volume == null ? null : Number(row.volume),
        provider,
        symbol,
      };
    })
    .filter((row) => row.close != null || row.adjClose != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

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

async function fetchPolygonDailyBars(symbol, startDate, endDate, apiKey) {
  const encodedSymbol = encodeURIComponent(symbol);
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodedSymbol}/range/1/day/${startDate}/${endDate}?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(apiKey)}`;
  const json = await httpJson(url);
  const results = Array.isArray(json?.results) ? json.results : [];

  return normalizeBars(results.map((row) => ({
    date: row.t,
    open: row.o,
    high: row.h,
    low: row.l,
    close: row.c,
    adjClose: row.c,
    volume: row.v,
  })), 'polygon', symbol);
}

async function fetchFinnhubDailyBars(symbol, startDate, endDate, apiKey) {
  const from = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
  const to = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000);
  const encodedSymbol = encodeURIComponent(symbol);
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodedSymbol}&resolution=D&from=${from}&to=${to}&token=${encodeURIComponent(apiKey)}`;
  const json = await httpJson(url);

  if (json?.s !== 'ok') {
    throw new Error(`Finnhub candle response was ${json?.s || 'unknown'} for ${symbol}`);
  }

  const rows = Array.isArray(json?.t)
    ? json.t.map((ts, idx) => ({
      date: ts * 1000,
      open: Array.isArray(json.o) ? json.o[idx] : null,
      high: Array.isArray(json.h) ? json.h[idx] : null,
      low: Array.isArray(json.l) ? json.l[idx] : null,
      close: Array.isArray(json.c) ? json.c[idx] : null,
      adjClose: Array.isArray(json.c) ? json.c[idx] : null,
      volume: Array.isArray(json.v) ? json.v[idx] : null,
    }))
    : [];

  return normalizeBars(rows, 'finnhub', symbol);
}

async function fetchYahooDailyBars(symbol, startDate, endDate) {
  const chart = await yahooFinance.chart(symbol, {
    period1: startDate,
    period2: endDate,
    interval: '1d',
    events: 'history',
    return: 'array',
  }, {
    validateResult: false,
  });
  return normalizeBars(chart?.quotes || [], 'yahoo', symbol);
}

function buildProviderOrder() {
  const preferred = String(process.env.TRADING_MARKET_DATA_PROVIDER || 'polygon').toLowerCase();
  const order = [];

  if ((preferred === 'polygon' || preferred === 'massive') && (process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY)) {
    order.push('polygon');
  }
  if (preferred === 'finnhub' && process.env.FINNHUB_API_KEY) {
    order.push('finnhub');
  }
  if (!order.includes('polygon') && (process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY)) {
    order.push('polygon');
  }
  if (!order.includes('finnhub') && process.env.FINNHUB_API_KEY) {
    order.push('finnhub');
  }

  order.push('yahoo');
  return order;
}

export async function createMarketDataClient(root = process.cwd()) {
  await loadLocalEnv(root);
  const providerOrder = buildProviderOrder();

  return {
    providerOrder,
    async getDailyBars(symbol, startDate, endDate) {
      const errors = [];

      for (const provider of providerOrder) {
        try {
          if (provider === 'polygon') {
            const apiKey = process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY;
            if (!apiKey) continue;
            return await fetchPolygonDailyBars(symbol, startDate, endDate, apiKey);
          }

          if (provider === 'finnhub') {
            const apiKey = process.env.FINNHUB_API_KEY;
            if (!apiKey) continue;
            return await fetchFinnhubDailyBars(symbol, startDate, endDate, apiKey);
          }

          if (provider === 'yahoo') {
            return await fetchYahooDailyBars(symbol, startDate, endDate);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${provider}: ${msg}`);
        }
      }

      throw new Error(`No market data provider succeeded for ${symbol}. ${errors.join(' | ')}`);
    },
  };
}
