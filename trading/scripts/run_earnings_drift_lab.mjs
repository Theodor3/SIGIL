import fs from 'node:fs/promises';
import path from 'node:path';
import { asNum, ensureDir, readCsv, toCsv, todayDate } from './lib.mjs';

const root = process.cwd();
const tradingDir = path.join(root, 'trading');

function mean(values) {
  return values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : null;
}

function safeNum(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return asNum(text);
}

function normalizedStatus(row) {
  return String(row.status || '').trim().toUpperCase() || 'OPEN';
}

function buildOutcomeIndex(rows) {
  const grouped = new Map();
  for (const row of (rows || [])) {
    const ticker = String(row.ticker || '').toUpperCase();
    const postReturn = asNum(row.post_earnings_return_5d);
    const revenueSurprise = asNum(row.revenue_surprise_pct);
    if (!ticker || postReturn == null) continue;
    const current = grouped.get(ticker) || [];
    current.push({
      report_date: String(row.report_date || ''),
      post_earnings_return_5d: postReturn,
      revenue_surprise_pct: revenueSurprise,
    });
    grouped.set(ticker, current);
  }

  const summary = new Map();
  for (const [ticker, entries] of grouped.entries()) {
    const returns = entries.map((entry) => entry.post_earnings_return_5d).filter((value) => value != null);
    const surprises = entries.map((entry) => entry.revenue_surprise_pct).filter((value) => value != null);
    const positives = returns.filter((value) => value > 0).length;
    const sortedEntries = entries.slice().sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)));
    summary.set(ticker, {
      sample_n: entries.length,
      avg_post_earnings_return_5d: mean(returns),
      hit_rate: returns.length ? positives / returns.length : null,
      avg_revenue_surprise_pct: mean(surprises),
      last_report_date: sortedEntries[0]?.report_date || '',
      recent_returns: sortedEntries.slice(0, 3),
    });
  }
  return summary;
}

function buildForwardIndex(rows) {
  const map = new Map();
  for (const row of (rows || [])) {
    const ticker = String(row.symbol || row.ticker || '').toUpperCase();
    if (!ticker) continue;
    map.set(ticker, {
      status: normalizedStatus(row),
      opened_date: String(row.opened_date || ''),
      closed_date: String(row.closed_date || ''),
      days_open: asNum(row.days_open),
      realized_return_pct: asNum(row.realized_return_pct),
      alpha_vs_expected_pct: asNum(row.alpha_vs_expected_pct),
      expected_alpha_to_date_pct: asNum(row.expected_alpha_to_date_pct),
      source_file: String(row.source_file || ''),
    });
  }
  return map;
}

export function buildEarningsDriftLab({
  featuresRows,
  outcomesRows,
  consensusRows,
  earningsRows,
  forwardRows,
  asOfDate,
}) {
  const outcomeByTicker = buildOutcomeIndex(outcomesRows);
  const forwardByTicker = buildForwardIndex(forwardRows);
  const consensusByTicker = new Map(
    (consensusRows || []).map((row) => [String(row.ticker || '').toUpperCase(), row]).filter(([ticker]) => ticker)
  );
  const earningsByTicker = new Map(
    (earningsRows || []).map((row) => [String(row.ticker || '').toUpperCase(), row]).filter(([ticker]) => ticker)
  );

  const rows = (featuresRows || [])
    .map((row) => {
      const ticker = String(row.ticker || '').toUpperCase();
      if (!ticker) return null;
      const expectedKpi = safeNum(row.expected_kpi_surprise);
      const probability = safeNum(row.probability_post_earnings_outperform);
      const confidence = safeNum(row.confidence);
      const daysToEarnings = safeNum(row.days_to_earnings);
      const nextEarningsDate = String(row.next_earnings_date || earningsByTicker.get(ticker)?.report_date || '');
      const historical = outcomeByTicker.get(ticker) || null;
      const forward = forwardByTicker.get(ticker) || null;
      const consensus = consensusByTicker.get(ticker) || {};
      const driftScore = (expectedKpi ?? 0) * (confidence ?? 0) * Math.max(probability ?? 0, 0.25);

      return {
        ticker,
        next_earnings_date: nextEarningsDate,
        days_to_earnings: daysToEarnings,
        confidence,
        expected_kpi_surprise: expectedKpi,
        probability_post_earnings_outperform: probability,
        deviation_vs_consensus: safeNum(row.deviation_vs_consensus),
        expected_stock_reaction: String(row.expected_stock_reaction || ''),
        historical_backtest: String(row.historical_backtest || ''),
        consensus_revenue_growth_yoy: safeNum(consensus.consensus_revenue_growth_yoy),
        consensus_revenue_surprise_pct: safeNum(consensus.consensus_revenue_surprise_pct),
        eligible: String(row.eligible || '').toLowerCase() !== 'false',
        drift_score: Number.isFinite(driftScore) ? driftScore : null,
        historical,
        forward,
      };
    })
    .filter(Boolean);

  const upcoming = rows
    .filter((row) => row.days_to_earnings != null && row.days_to_earnings >= 0 && row.days_to_earnings <= 120)
    .sort((a, b) => {
      const scoreDiff = (b.drift_score ?? -Infinity) - (a.drift_score ?? -Infinity);
      if (scoreDiff !== 0) return scoreDiff;
      const daysDiff = (a.days_to_earnings ?? Infinity) - (b.days_to_earnings ?? Infinity);
      if (daysDiff !== 0) return daysDiff;
      return String(a.ticker).localeCompare(String(b.ticker));
    });

  const activeOverlap = upcoming.filter((row) => row.forward && row.forward.status === 'OPEN');
  const historicalCoverage = upcoming.filter((row) => row.historical?.sample_n > 0);
  const avgUpcomingDriftScore = mean(upcoming.map((row) => row.drift_score).filter((value) => value != null));

  return {
    as_of_date: asOfDate,
    summary: {
      upcoming_count: upcoming.length,
      active_overlap_count: activeOverlap.length,
      historical_coverage_count: historicalCoverage.length,
      avg_upcoming_drift_score: avgUpcomingDriftScore == null ? null : Number(avgUpcomingDriftScore.toFixed(4)),
      top_setup: upcoming[0]
        ? {
            ticker: upcoming[0].ticker,
            next_earnings_date: upcoming[0].next_earnings_date,
            drift_score: upcoming[0].drift_score == null ? null : Number(upcoming[0].drift_score.toFixed(4)),
          }
        : null,
    },
    upcoming_setups: upcoming.slice(0, 20).map((row, index) => ({
      rank: index + 1,
      ticker: row.ticker,
      next_earnings_date: row.next_earnings_date,
      days_to_earnings: row.days_to_earnings,
      drift_score: row.drift_score == null ? null : Number(row.drift_score.toFixed(4)),
      confidence: row.confidence == null ? null : Number(row.confidence.toFixed(4)),
      expected_kpi_surprise: row.expected_kpi_surprise == null ? null : Number(row.expected_kpi_surprise.toFixed(4)),
      probability_post_earnings_outperform: row.probability_post_earnings_outperform == null ? null : Number(row.probability_post_earnings_outperform.toFixed(4)),
      deviation_vs_consensus: row.deviation_vs_consensus == null ? null : Number(row.deviation_vs_consensus.toFixed(4)),
      expected_stock_reaction: row.expected_stock_reaction,
      eligible: row.eligible,
      historical_sample_n: row.historical?.sample_n ?? 0,
      historical_avg_return_5d: row.historical?.avg_post_earnings_return_5d == null ? null : Number(row.historical.avg_post_earnings_return_5d.toFixed(4)),
      historical_hit_rate: row.historical?.hit_rate == null ? null : Number(row.historical.hit_rate.toFixed(4)),
      forward_status: row.forward?.status || '',
      forward_days_open: row.forward?.days_open ?? null,
      forward_alpha_vs_expected_pct: row.forward?.alpha_vs_expected_pct ?? null,
    })),
    active_overlap: activeOverlap.slice(0, 12).map((row) => ({
      ticker: row.ticker,
      next_earnings_date: row.next_earnings_date,
      days_to_earnings: row.days_to_earnings,
      drift_score: row.drift_score == null ? null : Number(row.drift_score.toFixed(4)),
      forward_days_open: row.forward?.days_open ?? null,
      forward_realized_return_pct: row.forward?.realized_return_pct ?? null,
      forward_alpha_vs_expected_pct: row.forward?.alpha_vs_expected_pct ?? null,
    })),
  };
}

export async function run() {
  const featuresPath = path.join(tradingDir, 'data', 'features', 'latest_features.csv');
  const outcomesPath = path.join(tradingDir, 'data', 'alt', 'earnings_outcomes.csv');
  const consensusPath = path.join(tradingDir, 'data', 'alt', 'consensus_estimates.csv');
  const calendarPath = path.join(tradingDir, 'data', 'alt', 'earnings_calendar.csv');
  const forwardPath = path.join(tradingDir, 'forward', 'paper_trades.csv');
  const outDir = path.join(tradingDir, 'data', 'alpha_lab');

  const [featuresRows, outcomesRows, consensusRows, earningsRows, forwardRows] = await Promise.all([
    readCsv(featuresPath),
    readCsv(outcomesPath),
    readCsv(consensusPath).catch(() => []),
    readCsv(calendarPath).catch(() => []),
    readCsv(forwardPath).catch(() => []),
  ]);

  const payload = buildEarningsDriftLab({
    featuresRows,
    outcomesRows,
    consensusRows,
    earningsRows,
    forwardRows,
    asOfDate: todayDate('America/New_York'),
  });

  await ensureDir(outDir);
  const jsonPath = path.join(outDir, 'latest_earnings_drift_lab.json');
  const csvPath = path.join(outDir, 'latest_earnings_drift_lab.csv');

  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  await fs.writeFile(csvPath, toCsv(payload.upcoming_setups, [
    'rank',
    'ticker',
    'next_earnings_date',
    'days_to_earnings',
    'drift_score',
    'confidence',
    'expected_kpi_surprise',
    'probability_post_earnings_outperform',
    'deviation_vs_consensus',
    'expected_stock_reaction',
    'eligible',
    'historical_sample_n',
    'historical_avg_return_5d',
    'historical_hit_rate',
    'forward_status',
    'forward_days_open',
    'forward_alpha_vs_expected_pct',
  ]), 'utf8');

  console.log(`Wrote: ${jsonPath}`);
  console.log(`Wrote: ${csvPath}`);
}

if (process.env.TRADING_EMBEDDED !== '1') {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
