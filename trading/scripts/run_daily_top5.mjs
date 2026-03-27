#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { asNum, ensureDir, n, pct, readCsv, readJson, toCsv, todayDate } from './lib.mjs';

const root = process.cwd();

function riskNote(row) {
  const notes = [];
  const debt = asNum(row.debt_to_ebitda);
  const fcfMargin = asNum(row.fcf_margin);
  const confidence = asNum(row.confidence);

  if (debt != null && debt > 1.5) notes.push('Leverage above comfort zone');
  if (fcfMargin != null && fcfMargin < 0.12) notes.push('Thin FCF margin');
  if (confidence != null && confidence < 0.55) notes.push('Lower signal confidence');
  if (notes.length === 0) notes.push('No major metric flags');
  return notes.join('; ');
}

export async function run() {
  const profilePath = path.join(root, 'trading', 'config', 'profile.json');
  const positionsPath = path.join(root, 'trading', 'data', 'positions.csv');
  const ranksPath = path.join(root, 'trading', 'data', 'ranks', 'latest_ranks.csv');
  const ideasDir = path.join(root, 'trading', 'ideas');

  const profile = await readJson(profilePath);
  const held = new Set((await readCsv(positionsPath)).map((r) => (r.symbol || '').trim().toUpperCase()));

  let ranks = [];
  try {
    ranks = await readCsv(ranksPath);
  } catch {
    throw new Error('No rank file found at trading/data/ranks/latest_ranks.csv. Run trading:alpha first.');
  }

  const targetCount = Number(profile?.investor_profile?.target_new_ideas_per_day ?? 5);

  const candidates = ranks
    .filter((r) => String(r.eligible || '').toLowerCase() !== 'false')
    .filter((r) => !held.has((r.ticker || '').toUpperCase()))
    .sort((a, b) => (asNum(b.final_alpha_score) ?? 0) - (asNum(a.final_alpha_score) ?? 0));

  const top = candidates.slice(0, targetCount).map((r) => ({
    date: todayDate(profile.timezone),
    symbol: (r.ticker || '').toUpperCase(),
    final_alpha_score: n(asNum(r.final_alpha_score), 4),
    confidence: n(asNum(r.confidence), 3),
    quality_score: n(asNum(r.quality_score), 3),
    growth_score: n(asNum(r.growth_score), 3),
    alt_momentum_score: n(asNum(r.alt_momentum_score), 3),
    peer_relative_score: n(asNum(r.peer_relative_score), 3),
    value_score: n(asNum(r.value_score), 3),
    expected_kpi_surprise: pct(asNum(r.expected_kpi_surprise), 2),
    expected_stock_reaction: r.expected_stock_reaction || 'Mixed / neutral expected reaction',
    strongest_drivers: r.strongest_drivers || '',
    historical_backtest: r.historical_backtest || '',
    why_now: `Alpha rank ${r.rank || '?'} with strong factor mix (${r.strongest_drivers || 'multi-factor'})`,
    why_risky: riskNote(r),
  }));

  await ensureDir(ideasDir);
  const date = todayDate(profile.timezone);
  const csvOut = path.join(ideasDir, `${date}-top${targetCount}-ideas.csv`);
  const mdOut = path.join(ideasDir, `${date}-top${targetCount}-ideas.md`);

  const headers = [
    'date', 'symbol', 'final_alpha_score', 'confidence', 'quality_score', 'growth_score',
    'alt_momentum_score', 'peer_relative_score', 'value_score', 'expected_kpi_surprise',
    'expected_stock_reaction', 'strongest_drivers', 'historical_backtest', 'why_now', 'why_risky',
  ];

  await fs.writeFile(csvOut, toCsv(top, headers), 'utf8');

  const md = [
    `# Top ${targetCount} New Ideas - ${date}`,
    '',
    '- Source: trading/data/ranks/latest_ranks.csv',
    `- Current holdings excluded: ${held.size}`,
    '',
    '| Rank | Ticker | Alpha Score | Confidence | KPI Proxy | Reaction | Strongest Drivers | Risk Notes |',
    '|---:|---|---:|---:|---:|---|---|---|',
    ...top.map((r, i) => `| ${i + 1} | ${r.symbol} | ${r.final_alpha_score} | ${r.confidence} | ${r.expected_kpi_surprise} | ${r.expected_stock_reaction} | ${r.strongest_drivers || 'n/a'} | ${r.why_risky} |`),
    '',
    '## Notes',
    '',
    '- Ideas are rank-driven only (no independent rescoring in this script).',
    '- This is a research watchlist, not investment advice.',
  ].join('\n');

  await fs.writeFile(mdOut, md, 'utf8');

  console.log(`Wrote: ${csvOut}`);
  console.log(`Wrote: ${mdOut}`);
  console.log(`Selected tickers: ${top.map((x) => x.symbol).join(', ')}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}


