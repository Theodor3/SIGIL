#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { asNum, ensureDir, parseCsv, readJson, toCsv, todayDate } from '../scripts/lib.mjs';
import { createReferenceDataClient } from '../providers/reference_data.mjs';

const root = process.cwd();

const DEFAULT_POLICY = {
  close_after_days: 90,
  reopen_cooldown_days: 21,
  max_open_trades: 10,
  stop_loss_pct: -12,
  take_profit_pct: 20,
  close_on_hit_stop_or_take: false,
};

function daysBetween(a, b) {
  const da = new Date(`${a}T00:00:00Z`);
  const db = new Date(`${b}T00:00:00Z`);
  if (Number.isNaN(da.valueOf()) || Number.isNaN(db.valueOf())) return 0;
  return Math.max(0, Math.round((db - da) / 86400000));
}

function parsePct(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.endsWith('%')) return asNum(s.slice(0, -1));
  return asNum(s);
}

function expectedToDate(exp20, exp90, daysOpen) {
  const e20 = exp20 ?? 0;
  const e90 = exp90 ?? e20;
  if (daysOpen <= 20) return e20 * (daysOpen / 20);
  if (daysOpen >= 90) return e90;
  const t = (daysOpen - 20) / 70;
  return e20 + (e90 - e20) * t;
}

async function readCsvMaybe(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return parseCsv(text);
  } catch {
    return [];
  }
}

async function fetchPriceMap(symbols) {
  const client = await createReferenceDataClient(root);
  const quoteMap = await client.getQuoteMap(symbols);
  const out = new Map();
  for (const [symbol, quote] of quoteMap.entries()) {
    const px = asNum(quote?.price);
    if (px != null) out.set(symbol, px);
  }
  return out;
}

async function loadPolicy(configPath) {
  try {
    const cfg = await readJson(configPath);
    return { ...DEFAULT_POLICY, ...(cfg || {}) };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

export async function run() {
  const tradingDir = path.join(root, 'trading');
  const tz = 'America/New_York';
  const asOf = todayDate(tz);

  const ideasDir = path.join(tradingDir, 'ideas');
  const forwardDir = path.join(tradingDir, 'forward');
  const snapshotsDir = path.join(forwardDir, 'snapshots');
  const ledgerPath = path.join(forwardDir, 'paper_trades.csv');
  const policyPath = path.join(tradingDir, 'config', 'forward_policy.json');

  await ensureDir(forwardDir);
  await ensureDir(snapshotsDir);

  const policy = await loadPolicy(policyPath);

  const ideaFiles = await fs.readdir(ideasDir).catch(() => []);
  const finalIdeas = ideaFiles.filter((f) => /-final-top\d+\.csv$/i.test(f)).sort();
  if (!finalIdeas.length) throw new Error('No final-top ideas file found. Run trading:alpha first.');

  const latestIdeasPath = path.join(ideasDir, finalIdeas[finalIdeas.length - 1]);
  const latestIdeas = parseCsv(await fs.readFile(latestIdeasPath, 'utf8'));

  const ledger = await readCsvMaybe(ledgerPath);

  // First update existing OPEN trades before considering new adds.
  const symbolsAll = [...new Set(ledger.map((r) => String(r.symbol || '').toUpperCase()).filter(Boolean))];
  const priceMapAll = await fetchPriceMap(symbolsAll);

  for (const r of ledger) {
    const symbol = String(r.symbol || '').toUpperCase();
    if (!symbol) continue;

    const px = priceMapAll.get(symbol);
    if (px != null) r.last_price = px.toFixed(4);

    const status = String(r.status || 'OPEN').toUpperCase();
    if (status !== 'OPEN') continue;

    const daysOpen = daysBetween(String(r.opened_date || asOf), asOf);
    r.days_open = daysOpen;
    if (!r.entry_price && px != null) r.entry_price = px.toFixed(4);

    const entry = asNum(r.entry_price);
    const last = asNum(r.last_price);
    const exp20 = asNum(r.expected_alpha_20d_pct);
    const exp90 = asNum(r.expected_alpha_90d_pct);

    const expected = expectedToDate(exp20, exp90, daysOpen);
    r.expected_alpha_to_date_pct = Number.isFinite(expected) ? expected.toFixed(4) : '';

    let realizedPct = null;
    if (entry != null && last != null && entry > 0) {
      realizedPct = ((last / entry) - 1) * 100;
      r.realized_return_pct = realizedPct.toFixed(4);
      const diff = realizedPct - (asNum(r.expected_alpha_to_date_pct) ?? 0);
      r.alpha_vs_expected_pct = diff.toFixed(4);
    }

    let closeReason = '';
    if (daysOpen >= Number(policy.close_after_days)) {
      closeReason = `MAX_DAYS_${Number(policy.close_after_days)}`;
    }

    if (!closeReason && policy.close_on_hit_stop_or_take && realizedPct != null) {
      if (realizedPct <= Number(policy.stop_loss_pct)) {
        closeReason = `STOP_LOSS_${Number(policy.stop_loss_pct)}`;
      } else if (realizedPct >= Number(policy.take_profit_pct)) {
        closeReason = `TAKE_PROFIT_${Number(policy.take_profit_pct)}`;
      }
    }

    if (closeReason) {
      r.status = 'CLOSED';
      r.closed_date = asOf;
      r.close_reason = closeReason;
    }
  }

  const openAfterUpdate = ledger.filter((r) => String(r.status || 'OPEN').toUpperCase() === 'OPEN');
  const slotsLeft = Math.max(0, Number(policy.max_open_trades) - openAfterUpdate.length);

  const lastClosedBySymbol = new Map();
  for (const r of ledger) {
    const symbol = String(r.symbol || '').toUpperCase();
    if (!symbol || String(r.status || '').toUpperCase() !== 'CLOSED' || !r.closed_date) continue;
    const prior = lastClosedBySymbol.get(symbol);
    if (!prior || String(r.closed_date) > prior) lastClosedBySymbol.set(symbol, String(r.closed_date));
  }

  const openSymbols = new Set(openAfterUpdate.map((r) => String(r.symbol || '').toUpperCase()));

  const candidates = latestIdeas
    .map((i) => ({
      symbol: String(i.symbol || '').toUpperCase(),
      expected20: parsePct(i.expected_alpha_20d),
      expected90: parsePct(i.expected_alpha_90d),
    }))
    .filter((c) => c.symbol)
    .filter((c) => !openSymbols.has(c.symbol))
    .filter((c) => {
      const lastClosed = lastClosedBySymbol.get(c.symbol);
      if (!lastClosed) return true;
      return daysBetween(lastClosed, asOf) >= Number(policy.reopen_cooldown_days);
    })
    .slice(0, slotsLeft);

  const newPriceMap = await fetchPriceMap(candidates.map((c) => c.symbol));

  for (const c of candidates) {
    const px = newPriceMap.get(c.symbol);
    ledger.push({
      opened_date: asOf,
      closed_date: '',
      status: 'OPEN',
      close_reason: '',
      symbol: c.symbol,
      entry_price: px != null ? px.toFixed(4) : '',
      last_price: px != null ? px.toFixed(4) : '',
      days_open: 0,
      expected_alpha_20d_pct: c.expected20 ?? '',
      expected_alpha_90d_pct: c.expected90 ?? '',
      expected_alpha_to_date_pct: '0.0000',
      realized_return_pct: '0.0000',
      alpha_vs_expected_pct: '0.0000',
      source_file: path.basename(latestIdeasPath),
    });
  }

  const openRows = ledger.filter((r) => String(r.status || 'OPEN').toUpperCase() === 'OPEN');
  const closedRows = ledger.filter((r) => String(r.status || '').toUpperCase() === 'CLOSED');

  const hitCount = openRows.filter((r) => (asNum(r.realized_return_pct) ?? -Infinity) > 0).length;
  const hitRate = openRows.length ? (hitCount / openRows.length) : null;
  const avgAlphaDiff = openRows.length
    ? openRows.reduce((a, b) => a + (asNum(b.alpha_vs_expected_pct) ?? 0), 0) / openRows.length
    : null;

  const headers = [
    'opened_date',
    'closed_date',
    'status',
    'close_reason',
    'symbol',
    'entry_price',
    'last_price',
    'days_open',
    'expected_alpha_20d_pct',
    'expected_alpha_90d_pct',
    'expected_alpha_to_date_pct',
    'realized_return_pct',
    'alpha_vs_expected_pct',
    'source_file',
  ];

  await fs.writeFile(ledgerPath, toCsv(ledger, headers), 'utf8');

  const snapshot = openRows.map((r) => ({ ...r, as_of_date: asOf }));
  const snapshotHeaders = ['as_of_date', ...headers];
  const snapCsv = path.join(snapshotsDir, `${asOf}-forward-snapshot.csv`);
  await fs.writeFile(snapCsv, toCsv(snapshot, snapshotHeaders), 'utf8');

  const snapMd = path.join(snapshotsDir, `${asOf}-forward-snapshot.md`);
  const md = [
    `# Forward Test Report - ${asOf}`,
    '',
    `- Open paper trades: ${openRows.length}`,
    `- Closed paper trades: ${closedRows.length}`,
    `- Max open policy: ${Number(policy.max_open_trades)}`,
    `- Reopen cooldown (days): ${Number(policy.reopen_cooldown_days)}`,
    `- Hit rate (open): ${hitRate == null ? 'n/a' : (hitRate * 100).toFixed(2) + '%'}`,
    `- Avg alpha vs expected (pct pts): ${avgAlphaDiff == null ? 'n/a' : avgAlphaDiff.toFixed(4)}`,
    '',
    '| Symbol | Days Open | Realized % | Expected-to-date % | Alpha vs Expected % |',
    '|---|---:|---:|---:|---:|',
    ...snapshot.map((r) => `| ${r.symbol} | ${r.days_open} | ${r.realized_return_pct || 'n/a'} | ${r.expected_alpha_to_date_pct || 'n/a'} | ${r.alpha_vs_expected_pct || 'n/a'} |`),
  ].join('\n');

  await fs.writeFile(snapMd, md, 'utf8');

  console.log(`Wrote: ${ledgerPath}`);
  console.log(`Wrote: ${snapCsv}`);
  console.log(`Wrote: ${snapMd}`);
  console.log(`Open trades: ${openRows.length}; Closed trades: ${closedRows.length}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
