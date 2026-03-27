#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import YahooFinance from 'yahoo-finance2';
import { asNum, ensureDir, n, pct, readCsv, readJson, todayDate } from './lib.mjs';

const root = process.cwd();
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

function toYahooSymbol(symbol) {
  const s = (symbol || '').toUpperCase();
  return `${s}-USD`;
}

function msDays(days) {
  return days * 24 * 60 * 60 * 1000;
}

function normalizePctInput(value) {
  const v = asNum(value);
  if (v == null) return null;
  // Yahoo quote often returns percent points (e.g. -3.2), not decimal.
  return Math.abs(v) > 1 ? v / 100 : v;
}

async function fetchWeeklyMove(yfSymbol) {
  try {
    const period1 = new Date(Date.now() - msDays(10));
    const chart = await yf.chart(yfSymbol, {
      period1,
      interval: '1d',
    });

    const quotes = Array.isArray(chart?.quotes) ? chart.quotes.filter((q) => asNum(q.close) != null) : [];
    if (quotes.length < 2) return null;

    const end = asNum(quotes[quotes.length - 1].close);
    const startIdx = Math.max(0, quotes.length - 8);
    const start = asNum(quotes[startIdx].close);
    if (start == null || end == null || start <= 0) return null;

    return (end / start) - 1;
  } catch {
    return null;
  }
}

function classifyAlert(daily, weekly, cfg) {
  const dailyAbs = Math.abs(daily ?? 0);
  const weeklyAbs = Math.abs(weekly ?? 0);

  if (dailyAbs >= cfg.severity_daily_pct || weeklyAbs >= cfg.severity_weekly_pct) {
    return 'HIGH';
  }
  if (dailyAbs >= cfg.daily_move_pct || weeklyAbs >= cfg.weekly_move_pct) {
    return 'MEDIUM';
  }
  return 'NONE';
}

export async function run() {
  const profile = await readJson(path.join(root, 'trading', 'config', 'profile.json'));
  const cryptoRows = await readCsv(path.join(root, 'trading', 'data', 'crypto_positions.csv'));

  const cfg = {
    daily_move_pct: asNum(profile?.crypto_alerts?.daily_move_pct) ?? 0.06,
    weekly_move_pct: asNum(profile?.crypto_alerts?.weekly_move_pct) ?? 0.10,
    severity_daily_pct: asNum(profile?.crypto_alerts?.severity_daily_pct) ?? 0.10,
    severity_weekly_pct: asNum(profile?.crypto_alerts?.severity_weekly_pct) ?? 0.15,
  };

  const rows = [];
  for (const c of cryptoRows) {
    const symbol = (c.symbol || '').toUpperCase();
    const yfSymbol = toYahooSymbol(symbol);

    let q = null;
    try {
      q = await yf.quote(yfSymbol);
    } catch {
      q = null;
    }

    const price = asNum(q?.regularMarketPrice) ?? asNum(c.price);
    const daily = normalizePctInput(q?.regularMarketChangePercent);
    const weekly = await fetchWeeklyMove(yfSymbol);

    const level = classifyAlert(daily, weekly, cfg);
    const triggerParts = [];
    if (daily != null && Math.abs(daily) >= cfg.daily_move_pct) {
      triggerParts.push(`daily move ${pct(daily)}`);
    }
    if (weekly != null && Math.abs(weekly) >= cfg.weekly_move_pct) {
      triggerParts.push(`7d move ${pct(weekly)}`);
    }

    rows.push({
      symbol,
      price: n(price, 4),
      daily_change: pct(daily),
      weekly_change: pct(weekly),
      alert_level: level,
      trigger: triggerParts.join('; ') || 'none',
    });
  }

  const bySeverity = { HIGH: 0, MEDIUM: 0, NONE: 0 };
  rows.forEach((r) => {
    bySeverity[r.alert_level] += 1;
  });

  const date = todayDate(profile.timezone);
  const reportsDir = path.join(root, 'trading', 'reports');
  await ensureDir(reportsDir);
  const outPath = path.join(reportsDir, `${date}-crypto-alerts.md`);

  const alerted = rows.filter((r) => r.alert_level !== 'NONE');

  const md = [
    `# Crypto Alerts - ${date}`,
    '',
    `- Tracked assets: ${rows.length}`,
    `- HIGH alerts: ${bySeverity.HIGH}`,
    `- MEDIUM alerts: ${bySeverity.MEDIUM}`,
    `- Thresholds: daily >= ${pct(cfg.daily_move_pct)}, 7d >= ${pct(cfg.weekly_move_pct)}`,
    '',
    '## Alerted Moves',
    '',
    alerted.length
      ? '| Symbol | Price | Daily | 7d | Level | Trigger |\n|---|---:|---:|---:|---|---|\n' + alerted.map((r) => `| ${r.symbol} | $${r.price} | ${r.daily_change || 'n/a'} | ${r.weekly_change || 'n/a'} | ${r.alert_level} | ${r.trigger} |`).join('\n')
      : '- No meaningful crypto moves above your thresholds.',
    '',
    '## Full Watchlist',
    '',
    '| Symbol | Price | Daily | 7d | Level |',
    '|---|---:|---:|---:|---|',
    ...rows.map((r) => `| ${r.symbol} | $${r.price} | ${r.daily_change || 'n/a'} | ${r.weekly_change || 'n/a'} | ${r.alert_level} |`),
  ].join('\n');

  await fs.writeFile(outPath, md, 'utf8');

  console.log(`Wrote: ${outPath}`);
  console.log(`Alerts: HIGH=${bySeverity.HIGH}, MEDIUM=${bySeverity.MEDIUM}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}

