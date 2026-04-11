#!/usr/bin/env node
/**
 * Robinhood Portfolio Tracker
 * Reads robinhood_portfolio.json, fetches current prices, computes P&L,
 * and overlays SIGIL alpha signals for each position.
 *
 * Output: trading/data/portfolio/robinhood_snapshot.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });
import { asNum, ensureDir, parseCsv, readJson, todayDate } from '../scripts/lib.mjs';
import { loadLocalEnv } from '../providers/env.mjs';

const ETF_LABEL = 'ETF — no individual signal';
const OTC_LABEL = 'OTC/Foreign — no coverage';
const BANKRUPT_LABEL = 'Bankrupt/delisted';

const root = process.cwd();
const tradingDir = path.join(root, 'trading');

// ── Price fetching via yahoo-finance2 ────────────────────────────────────────

async function fetchPricesYahoo(tickers) {
  const prices = new Map();
  await Promise.all(tickers.map(async (ticker) => {
    try {
      const q = await yahooFinance.quote(ticker);
      if (q?.regularMarketPrice != null) {
        prices.set(ticker.toUpperCase(), {
          price: q.regularMarketPrice,
          name: q.shortName || q.displayName || ticker,
        });
      }
    } catch {
      // skip — price stays missing
    }
  }));

  return prices;
}

// ── SIGIL signal overlay ──────────────────────────────────────────────────────

function loadSignalIndex(features) {
  const idx = new Map();
  for (const f of features) {
    const ticker = (f.ticker || '').toUpperCase();
    idx.set(ticker, {
      final_alpha_score: asNum(f.final_alpha_score),
      quality_score: asNum(f.quality_score),
      growth_score: asNum(f.growth_score),
      pead_score: asNum(f.pead_score),
      value_score: asNum(f.value_score),
      confidence: asNum(f.confidence),
      next_earnings_date: f.next_earnings_date || null,
      days_to_earnings: asNum(f.days_to_earnings),
      eligible: f.eligible === 'true',
      strongest_drivers: f.strongest_drivers || '',
    });
  }
  return idx;
}

function sigilAction(signal, gainPct, trimRules, assetType = 'stock') {
  if (assetType === 'etf') return { action: 'ETF', reason: ETF_LABEL };
  if (assetType === 'otc') return { action: 'OTC', reason: OTC_LABEL };
  if (assetType === 'bankrupt') return { action: 'WORTHLESS', reason: BANKRUPT_LABEL };
  if (!signal) return { action: 'PENDING', reason: 'Not yet in SIGIL universe — will score after next pipeline run' };

  const alpha = signal.final_alpha_score ?? 0;
  const confidence = signal.confidence ?? 0;

  // Trim rules based on gain
  if (gainPct >= 1.20 && trimRules) return { action: 'TRIM_20', reason: `+${(gainPct*100).toFixed(0)}% gain — trim 20% per schedule` };
  if (gainPct >= 0.75 && trimRules) return { action: 'TRIM_15', reason: `+${(gainPct*100).toFixed(0)}% gain — trim 15% per schedule` };
  if (gainPct >= 0.40 && trimRules) return { action: 'TRIM_10', reason: `+${(gainPct*100).toFixed(0)}% gain — trim 10% per schedule` };
  if (gainPct >= 0.20 && trimRules) return { action: 'TRIM_10', reason: `+${(gainPct*100).toFixed(0)}% gain — trim 10% per schedule` };

  // Signal-based
  if (!signal.eligible) return { action: 'REVIEW', reason: 'Failed eligibility gate (leverage/confidence)' };
  if (alpha >= 0.35 && confidence >= 0.60) return { action: 'HOLD_STRONG', reason: `Strong signal (alpha=${alpha.toFixed(2)}, conf=${confidence.toFixed(2)})` };
  if (alpha >= 0.20) return { action: 'HOLD', reason: `Decent signal (alpha=${alpha.toFixed(2)})` };
  if (alpha < 0.10) return { action: 'CONSIDER_EXIT', reason: `Weak signal (alpha=${alpha.toFixed(2)}) — consider rotating capital` };

  return { action: 'HOLD', reason: `Signal neutral (alpha=${alpha.toFixed(2)})` };
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function run() {
  await loadLocalEnv(root);

  const portfolio = await readJson(path.join(tradingDir, 'config', 'robinhood_portfolio.json'));
  const profile = await readJson(path.join(tradingDir, 'config', 'profile.json'));
  const watchlist = await readJson(path.join(tradingDir, 'config', 'watchlist.json')).catch(() => ({}));
  const trimRules = profile?.trim_rules || {};

  const etfSet = new Set((watchlist.etfs || []).map((t) => t.toUpperCase()));
  const otcSet = new Set((watchlist.otc_or_unscorable || []).map((t) => t.toUpperCase()));

  function assetType(ticker) {
    if (ticker === 'SEELQ') return 'bankrupt';
    if (etfSet.has(ticker)) return 'etf';
    if (otcSet.has(ticker)) return 'otc';
    return 'stock';
  }

  // Load SIGIL features for signal overlay
  let features = [];
  try {
    const text = await fs.readFile(path.join(tradingDir, 'data', 'features', 'latest_features.csv'), 'utf8');
    features = parseCsv(text);
  } catch { /* no features yet */ }
  const signalIndex = loadSignalIndex(features);

  const positions = portfolio.positions || [];
  const crypto = portfolio.crypto || [];
  const cashUsd = asNum(portfolio.cash_usd) ?? 0;
  const asOf = todayDate(profile?.timezone || 'America/New_York');

  // Collect all tickers to price
  const stockTickers = positions
    .map((p) => (p.ticker || '').toUpperCase())
    .filter((t) => t && t !== 'SEELQ'); // skip bankrupt

  console.log(`Fetching prices for ${stockTickers.length} positions...`);
  const priceMap = await fetchPricesYahoo(stockTickers);

  // Enrich each position
  let totalEquityUsd = 0;
  let totalCostBasis = 0;
  let totalUnrealizedPL = 0;

  const enriched = positions.map((p) => {
    const ticker = (p.ticker || '').toUpperCase();
    const shares = asNum(p.shares) ?? 0;
    const avgCost = asNum(p.avg_cost) ?? 0;
    const costBasis = shares * avgCost;

    const priceData = priceMap.get(ticker);
    const currentPrice = priceData?.price ?? null;
    const currentValue = currentPrice != null ? shares * currentPrice : null;
    const unrealizedPL = currentValue != null ? currentValue - costBasis : null;
    const gainPct = costBasis > 0 && unrealizedPL != null ? unrealizedPL / costBasis : null;

    const signal = signalIndex.get(ticker) || null;
    const type = assetType(ticker);
    const action = sigilAction(signal, gainPct ?? 0, trimRules, type);

    if (currentValue != null) totalEquityUsd += currentValue;
    totalCostBasis += costBasis;
    if (unrealizedPL != null) totalUnrealizedPL += unrealizedPL;

    return {
      ticker,
      name: priceData?.name || p.notes || ticker,
      shares,
      avg_cost: avgCost,
      current_price: currentPrice,
      current_value: currentValue,
      cost_basis: costBasis,
      unrealized_pl: unrealizedPL,
      gain_pct: gainPct,
      // SIGIL overlay
      in_sigil_universe: signal != null,
      alpha_score: signal?.final_alpha_score ?? null,
      quality_score: signal?.quality_score ?? null,
      growth_score: signal?.growth_score ?? null,
      pead_score: signal?.pead_score ?? null,
      confidence: signal?.confidence ?? null,
      next_earnings_date: signal?.next_earnings_date ?? null,
      days_to_earnings: signal?.days_to_earnings ?? null,
      sigil_action: action.action,
      sigil_reason: action.reason,
      notes: p.notes || '',
    };
  });

  // Sort: biggest gainers first, then by value
  enriched.sort((a, b) => (b.gain_pct ?? -999) - (a.gain_pct ?? -999));

  // Crypto summary (static prices from portfolio file — update manually or wire later)
  const cryptoSummary = crypto.map((c) => {
    const qty = asNum(c.quantity) ?? 0;
    const avgCost = asNum(c.avg_cost) ?? 0;
    const costBasis = qty * avgCost;
    // We'd need a crypto price API here — for now flag as needs_price
    return {
      ticker: (c.ticker || '').toUpperCase(),
      quantity: qty,
      avg_cost: avgCost,
      cost_basis: costBasis,
      notes: c.notes || '',
      current_price: null, // TODO: wire crypto prices
      current_value: null,
      unrealized_pl: null,
      gain_pct: null,
    };
  });

  // Summary stats
  const totalPortfolio = totalEquityUsd + cashUsd;
  const overallGainPct = totalCostBasis > 0 ? totalUnrealizedPL / totalCostBasis : null;

  // Positions in SIGIL universe with strong/weak signals
  const inUniverse = enriched.filter((p) => p.in_sigil_universe);
  const trimCandidates = enriched.filter((p) => p.sigil_action?.startsWith('TRIM'));
  const exitCandidates = enriched.filter((p) => p.sigil_action === 'CONSIDER_EXIT');
  const strongHolds = enriched.filter((p) => p.sigil_action === 'HOLD_STRONG');

  const snapshot = {
    as_of_date: asOf,
    summary: {
      total_equity_usd: totalEquityUsd,
      total_cost_basis: totalCostBasis,
      total_unrealized_pl: totalUnrealizedPL,
      overall_gain_pct: overallGainPct,
      cash_usd: cashUsd,
      total_portfolio_usd: totalPortfolio,
      position_count: enriched.length,
      in_sigil_universe: inUniverse.length,
      trim_candidates: trimCandidates.length,
      exit_candidates: exitCandidates.length,
      strong_holds: strongHolds.length,
    },
    positions: enriched,
    crypto: cryptoSummary,
    alerts: [
      ...trimCandidates.map((p) => ({ level: 'INFO', ticker: p.ticker, message: `${p.sigil_action}: ${p.sigil_reason}` })),
      ...exitCandidates.map((p) => ({ level: 'WARN', ticker: p.ticker, message: `CONSIDER_EXIT: ${p.sigil_reason}` })),
    ],
  };

  await ensureDir(path.join(tradingDir, 'data', 'portfolio'));
  const outPath = path.join(tradingDir, 'data', 'portfolio', 'robinhood_snapshot.json');
  await fs.writeFile(outPath, JSON.stringify(snapshot, null, 2), 'utf8');

  // Console summary
  console.log(`\n════ Robinhood Portfolio — ${asOf} ════`);
  console.log(`  Equity:       $${totalEquityUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
  console.log(`  Cost basis:   $${totalCostBasis.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
  console.log(`  Unrealized:   ${totalUnrealizedPL >= 0 ? '+' : ''}$${totalUnrealizedPL.toLocaleString('en-US', { maximumFractionDigits: 0 })} (${overallGainPct != null ? ((overallGainPct)*100).toFixed(1)+'%' : 'n/a'})`);
  console.log(`  Cash:         $${cashUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
  console.log(`  In SIGIL:     ${inUniverse.length}/${enriched.length} positions tracked`);

  if (trimCandidates.length) {
    console.log(`\n  🔔 Trim candidates: ${trimCandidates.map((p) => p.ticker).join(', ')}`);
  }
  if (exitCandidates.length) {
    console.log(`  ⚠  Exit candidates: ${exitCandidates.map((p) => p.ticker).join(', ')}`);
  }
  if (strongHolds.length) {
    console.log(`  ✓  Strong holds:    ${strongHolds.map((p) => p.ticker).join(', ')}`);
  }

  console.log(`\n  Wrote: ${outPath}`);
  return snapshot;
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
