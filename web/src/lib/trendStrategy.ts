export const trendStrategyVersion = "spy-sma200-next-close-v1";
export const trendLookback = 200;
export type TrendDataset = {
  symbol: string; sourceUrl: string; retrievedAt: string;
  prices: { date: string; close: number; adjustedClose: number }[];
};
export type TrendOptions = { startDate?: string; endDate?: string; costBpsPerSide?: number };
export type PassiveMixResult = {
  label: string;
  metrics: { startDate: string; endDate: string; totalReturnPct: number; cagrPct: number; maxDrawdownPct: number };
  equity: { date: string; value: number; stockWeightPct: number }[];
};
export type TrendResult = {
  version: string;
  metrics: { startDate: string; endDate: string; observations: number; totalReturnPct: number; cagrPct: number; maxDrawdownPct: number; benchmarkReturnPct: number; benchmarkCagrPct: number; benchmarkMaxDrawdownPct: number; excessReturnPct: number; transitions: number; exposurePct: number };
  equity: { date: string; strategy: number; buyHold: number; invested: boolean }[];
  transitions: { signalDate: string; date: string; action: "buy" | "sell"; reason: string }[];
  warnings: string[];
};
const DAY = 86400000;
function dateMs(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must be YYYY-MM-DD.`);
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw new Error(`${field} is invalid.`);
  return ms;
}
export function validateTrendDataset(value: unknown): TrendDataset {
  if (!value || typeof value !== "object") throw new Error("Dataset must be an object.");
  const data = value as TrendDataset;
  if (data.symbol !== "SPY") throw new Error("This fixed experiment requires symbol SPY.");
  try { if (!["http:", "https:"].includes(new URL(data.sourceUrl).protocol)) throw new Error(); }
  catch { throw new Error("sourceUrl must be an absolute HTTP(S) URL."); }
  if (typeof data.retrievedAt !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(data.retrievedAt) || !Number.isFinite(Date.parse(data.retrievedAt))) throw new Error("retrievedAt must include a valid timezone.");
  if (!Array.isArray(data.prices) || data.prices.length < trendLookback + 2) throw new Error("At least 202 complete prices are required for warmup and evaluation.");
  const seen = new Set<string>();
  const prices = data.prices.map((row, i) => {
    if (!row || typeof row !== "object") throw new Error(`prices[${i}] is incomplete.`);
    dateMs(row.date, `prices[${i}].date`);
    if (seen.has(row.date)) throw new Error(`Duplicate price date: ${row.date}.`);
    seen.add(row.date);
    for (const field of ["close", "adjustedClose"] as const) if (typeof row[field] !== "number" || !Number.isFinite(row[field]) || row[field] <= 0) throw new Error(`prices[${i}].${field} must be finite and positive.`);
    if (dateMs(row.date, "Price date") > Date.parse(data.retrievedAt)) throw new Error("Price date cannot follow retrieval time.");
    return { date: row.date, close: row.close, adjustedClose: row.adjustedClose };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { symbol: data.symbol, sourceUrl: data.sourceUrl, retrievedAt: data.retrievedAt, prices };
}
export function evaluateTrend(input: TrendDataset, options: TrendOptions = {}): TrendResult {
  const data = validateTrendDataset(input), prices = data.prices;
  const costBps = options.costBpsPerSide ?? 10;
  if (!Number.isFinite(costBps) || costBps < 0 || costBps >= 10000) throw new Error("costBpsPerSide must be between 0 and 10000 (exclusive).");
  const requestedStart = options.startDate === undefined ? -Infinity : dateMs(options.startDate, "startDate");
  const requestedEnd = options.endDate === undefined ? Infinity : dateMs(options.endDate, "endDate");
  if (requestedStart > requestedEnd) throw new Error("startDate must not follow endDate.");
  const start = prices.findIndex((p, i) => i >= trendLookback && dateMs(p.date, "Price date") >= requestedStart);
  let end = prices.length - 1;
  while (end >= 0 && dateMs(prices[end].date, "Price date") > requestedEnd) end--;
  if (start < 0 || end <= start) throw new Error("No complete evaluation window after the 200-observation warmup.");
  const costFactor = 1 - costBps / 10000;
  let strategy = 1, buyHold = costFactor, invested = false, exposedIntervals = 0;
  let peak = 1, benchmarkPeak = 1, maxDD = 0, benchmarkDD = 0;
  const equity: TrendResult["equity"] = [], transitions: TrendResult["transitions"] = [];
  // Each decision uses exactly the 200 supplied closes ending one observation earlier.
  // An existing position earns today's interval return before today's close execution.
  for (let i = start; i <= end; i++) {
    if (i > start) {
      const ratio = prices[i].adjustedClose / prices[i - 1].adjustedClose;
      buyHold *= ratio;
      if (invested) { strategy *= ratio; exposedIntervals++; }
    }
    if (i === end) {
      if (invested) {
        strategy *= costFactor; invested = false;
        transitions.push({ signalDate: prices[i].date, date: prices[i].date, action: "sell", reason: "End-of-window liquidation, not a signal." });
      }
      buyHold *= costFactor;
    } else {
      // Anchor on the previous close so a flat non-integer series remains exactly
      // equal to its mean rather than spuriously crossing due to rounding.
      const anchor = prices[i - 1].adjustedClose;
      const average = anchor + prices.slice(i - trendLookback, i).reduce((sum, p) => sum + (p.adjustedClose - anchor) / trendLookback, 0);
      const desired = prices[i - 1].adjustedClose > average;
      if (desired !== invested) {
        strategy *= costFactor; invested = desired;
        transitions.push({ signalDate: prices[i - 1].date, date: prices[i].date, action: desired ? "buy" : "sell", reason: desired ? "Prior close above its 200-observation average." : "Prior close at or below its 200-observation average." });
      }
    }
    if (![strategy, buyHold].every(x => Number.isFinite(x) && x > 0)) throw new Error("Numeric overflow or underflow in the equity calculation.");
    peak = Math.max(peak, strategy); benchmarkPeak = Math.max(benchmarkPeak, buyHold);
    maxDD = Math.max(maxDD, 1 - strategy / peak); benchmarkDD = Math.max(benchmarkDD, 1 - buyHold / benchmarkPeak);
    equity.push({ date: prices[i].date, strategy, buyHold, invested });
  }
  const years = (dateMs(prices[end].date, "End") - dateMs(prices[start].date, "Start")) / DAY / 365.25;
  const cagr = (Math.pow(strategy, 1 / years) - 1) * 100;
  const benchmarkCagr = (Math.pow(buyHold, 1 / years) - 1) * 100;
  if (![cagr, benchmarkCagr].every(Number.isFinite)) throw new Error("Numeric overflow in annualized return.");
  const warnings = [
    "A fixed, retrospective research candidate, not evidence of a profitable live strategy. The 2023+ slice is chronological and has not been an untouched prospective holdout.",
    "Signals use the prior 200 supplied adjusted closes and execute at the next supplied close. Missing sessions and close executability are not independently verified.",
    "Provider-adjusted close ratios are a retrospective total-return proxy, not tradable prices. Provider adjustments and revisions have not been independently audited.",
    "Cash earns zero. Per-side costs apply to every switch and final liquidation; taxes, market impact and additional slippage are omitted. Fractional, fully invested exposure is assumed.",
    "The benchmark buys at the same starting close and sells at the same ending close, paying identical per-side costs. Exposure is the fraction of observed close-to-close intervals invested.",
    "SPY and this rule were selected with knowledge of market history; one fixed comparison does not establish significance or remove selection bias. No parameter search was performed.",
  ];
  if (prices.some((p, i) => i > 0 && dateMs(p.date, "Price date") - dateMs(prices[i - 1].date, "Price date") > 4 * DAY)) warnings.push("The source contains gaps longer than four calendar days. Missing sessions are not filled; signals and execution can be delayed.");
  return { version: trendStrategyVersion, metrics: { startDate: prices[start].date, endDate: prices[end].date, observations: end - start + 1, totalReturnPct: (strategy - 1) * 100, cagrPct: cagr, maxDrawdownPct: maxDD * 100, benchmarkReturnPct: (buyHold - 1) * 100, benchmarkCagrPct: benchmarkCagr, benchmarkMaxDrawdownPct: benchmarkDD * 100, excessReturnPct: (strategy - buyHold) * 100, transitions: transitions.length, exposurePct: exposedIntervals / (end - start) * 100 }, equity, transitions, warnings };
}

/** Fixed exploratory simplicity comparator: initial 70% SPY /
 * 30% zero-yield cash; no rebalancing, so the stock weight drifts. */
export function evaluatePassiveMix(input: TrendDataset, options: TrendOptions = {}): PassiveMixResult {
  const data = validateTrendDataset(input);
  // Reuse the exact validated evaluation boundaries and fee convention.
  const { metrics } = evaluateTrend(data, options);
  const prices = data.prices.filter(p => p.date >= metrics.startDate && p.date <= metrics.endDate);
  const factor = 1 - (options.costBpsPerSide ?? 10) / 10000;
  let peak = 1, maxDD = 0;
  const equity = prices.map((p, i) => {
    const terminal = i === prices.length - 1;
    const stock = 0.7 * factor * p.adjustedClose / prices[0].adjustedClose * (terminal ? factor : 1);
    const value = 0.3 + stock;
    if (!Number.isFinite(value) || value <= 0) throw new Error("Numeric overflow in passive comparison.");
    peak = Math.max(peak, value); maxDD = Math.max(maxDD, 1 - value / peak);
    return { date: p.date, value, stockWeightPct: terminal ? 0 : stock / value * 100 };
  });
  const final = equity[equity.length - 1].value;
  const years = (dateMs(metrics.endDate, "End") - dateMs(metrics.startDate, "Start")) / DAY / 365.25;
  const cagr = (Math.pow(final, 1 / years) - 1) * 100;
  if (!Number.isFinite(cagr)) throw new Error("Numeric overflow in passive annualized return.");
  return { label: "70% SPY / 30% cash initially, no rebalancing", metrics: { startDate: metrics.startDate, endDate: metrics.endDate, totalReturnPct: (final - 1) * 100, cagrPct: cagr, maxDrawdownPct: maxDD * 100 }, equity };
}
