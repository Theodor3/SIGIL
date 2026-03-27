#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { asNum, ensureDir, n, pct, readCsv, readJson, todayDate } from './lib.mjs';

const root = process.cwd();

function scoreLevel(ok, warnLabel) {
  return ok ? 'OK' : warnLabel;
}

export async function run() {
  const profile = await readJson(path.join(root, 'trading', 'config', 'profile.json'));
  const positions = await readCsv(path.join(root, 'trading', 'data', 'positions.csv'));

  let cryptoRows = [];
  try {
    cryptoRows = await readCsv(path.join(root, 'trading', 'data', 'crypto_positions.csv'));
  } catch {
    cryptoRows = [];
  }

  const cleaned = positions.map((p) => ({
    symbol: (p.symbol || '').toUpperCase(),
    equity: asNum(p.equity) ?? 0,
    price: asNum(p.price) ?? 0,
    shares: asNum(p.shares) ?? 0,
  }));

  const totalEquity = cleaned.reduce((s, p) => s + p.equity, 0);
  const targetEquity = asNum(profile?.allocation?.equities_usd) ?? totalEquity;

  const cryptoActual = cryptoRows.reduce((s, p) => s + (asNum(p.equity) ?? 0), 0);
  const cryptoTarget = asNum(profile?.allocation?.crypto_usd) ?? cryptoActual;

  const cashActual = asNum(profile?.allocation?.cash_usd) ?? 0;
  const account = asNum(profile?.investor_profile?.account_size_usd) ?? (totalEquity + cryptoActual + cashActual);

  const withWeights = cleaned
    .map((p) => ({ ...p, weight: totalEquity > 0 ? p.equity / totalEquity : 0 }))
    .sort((a, b) => b.weight - a.weight);

  const top5 = withWeights.slice(0, 5);
  const top5Weight = top5.reduce((s, p) => s + p.weight, 0);
  const hhi = withWeights.reduce((s, p) => s + p.weight * p.weight, 0);

  const leveragedSymbols = new Set(['TQQQ', 'SQQQ', 'SPXL', 'SPXS', 'SOXL', 'SOXS', 'UPRO', 'UVXY']);
  const leveragedExposure = withWeights
    .filter((p) => leveragedSymbols.has(p.symbol))
    .reduce((s, p) => s + p.weight, 0);

  const microCaps = withWeights.filter((p) => p.equity > 0 && p.equity < 100).length;
  const tinyPositionsWeight = withWeights.filter((p) => p.equity < 100).reduce((s, p) => s + p.weight, 0);

  const maxPos = top5[0]?.weight ?? 0;
  const maxOptionsRisk = asNum(profile?.investor_profile?.risk?.max_options_risk_per_trade_usd) ?? 150;
  const maxConcurrentOptions = Math.max(1, Math.floor((account * 0.05) / maxOptionsRisk));

  const checks = [
    {
      metric: 'Largest single position',
      value: pct(maxPos),
      status: scoreLevel(maxPos <= 0.12, 'WATCH'),
      note: 'Target <= 12% of equity sleeve',
    },
    {
      metric: 'Top-5 concentration',
      value: pct(top5Weight),
      status: scoreLevel(top5Weight <= 0.5, 'WATCH'),
      note: 'Target <= 50%',
    },
    {
      metric: 'Concentration index (HHI)',
      value: n(hhi, 3),
      status: scoreLevel(hhi <= 0.09, 'WATCH'),
      note: 'Lower is better diversified',
    },
    {
      metric: 'Leveraged ETF exposure',
      value: pct(leveragedExposure),
      status: scoreLevel(leveragedExposure <= 0.05, 'WATCH'),
      note: 'Keep small due to path dependency',
    },
    {
      metric: 'Tiny-position drag (<$100)',
      value: `${microCaps} names / ${pct(tinyPositionsWeight)}`,
      status: scoreLevel(tinyPositionsWeight <= 0.2, 'WATCH'),
      note: 'Too many tiny lots can dilute focus',
    },
  ];

  const date = todayDate(profile.timezone);
  const reportsDir = path.join(root, 'trading', 'reports');
  await ensureDir(reportsDir);
  const outPath = path.join(reportsDir, `${date}-risk-board.md`);

  const md = [
    `# Portfolio Risk Board - ${date}`,
    '',
    `- Account size (configured): $${n(account, 2)}`,
    `- Equity sleeve (actual): $${n(totalEquity, 2)} (target $${n(targetEquity, 2)})`,
    `- Crypto sleeve (actual): $${n(cryptoActual, 2)} (target $${n(cryptoTarget, 2)})`,
    `- Cash sleeve (configured): $${n(cashActual, 2)}`,
    `- Cash/other implied drift: $${n(account - totalEquity - cryptoActual - cashActual, 2)}`,
    '',
    '## Guardrails',
    '',
    '| Metric | Value | Status | Note |',
    '|---|---:|---|---|',
    ...checks.map((c) => `| ${c.metric} | ${c.value} | ${c.status} | ${c.note} |`),
    '',
    '## Largest Positions',
    '',
    '| Ticker | Equity | Weight |',
    '|---|---:|---:|',
    ...top5.map((p) => `| ${p.symbol} | $${n(p.equity, 2)} | ${pct(p.weight)} |`),
    '',
    '## Crypto Sleeve',
    '',
    '| Symbol | Equity | Weight of Crypto |',
    '|---|---:|---:|',
    ...(cryptoRows.length
      ? cryptoRows.map((c) => {
          const eq = asNum(c.equity) ?? 0;
          const w = cryptoActual > 0 ? eq / cryptoActual : 0;
          return `| ${(c.symbol || '').toUpperCase()} | $${n(eq, 2)} | ${pct(w)} |`;
        })
      : ['| n/a | $0.00 | 0.00% |']),
    '',
    '## Options Risk Budget',
    '',
    `- Max risk per options trade: $${n(maxOptionsRisk, 2)}`,
    `- Suggested concurrent options trades: <= ${maxConcurrentOptions}`,
    '- Prefer defined-risk structures while account size is small (debit spreads / protective puts).',
  ].join('\n');

  await fs.writeFile(outPath, md, 'utf8');

  console.log(`Wrote: ${outPath}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}

