export const diversifiedVersion = "four-sleeve-monthly-sma200-bil-v1";
export const riskSymbols = ["SPY", "EFA", "IEF", "GLD"] as const;
export const symbols = [...riskSymbols, "BIL"] as const;
export const diversifiedLookback = 200;
export type Symbol = typeof symbols[number];
export type Weights = Record<Symbol, number>;
export type PriceRow = Weights & { date: string };
export type DiversifiedDataset = { schemaVersion: 1; retrievedAt: string; sources: { symbol: Symbol; sourceUrl: string; sha256: string; retrievedAt: string }[]; rows: PriceRow[] };
export type PortfolioMetrics = { totalReturnPct: number; cagrPct: number; maxDrawdownPct: number; turnover: number; costPaid: number; costPctInitial: number; meanRiskExposurePct: number; rebalanceCount: number };
export type DiversifiedResult = {
  version: string;
  metrics: { startDate: string; endDate: string; observations: number; strategy: PortfolioMetrics; benchmark: PortfolioMetrics };
  equity: { date: string; strategy: number; benchmark: number; riskExposurePct: number }[];
  rebalances: { date: string; signalDate: string; strategyTarget: Weights; benchmarkTarget: Weights; strategyFee: number; benchmarkFee: number }[];
  warnings: string[];
};
export type DiversifiedOptions = { startDate?: string; endDate?: string; costBpsPerSide?: number };
const DAY = 86400000;
const empty = (): Weights => ({ SPY: 0, EFA: 0, IEF: 0, GLD: 0, BIL: 0 });
const total = (v: Weights) => symbols.reduce((sum, s) => sum + v[s], 0);
function dateMs(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Price and option dates must be YYYY-MM-DD.");
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw new Error("Invalid calendar date.");
  return ms;
}
function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Retrieval timestamps must include a timezone.");
  return Date.parse(value);
}
export function validateDiversifiedDataset(value: unknown): DiversifiedDataset {
  if (!value || typeof value !== "object") throw new Error("Dataset must be an object.");
  const data = value as DiversifiedDataset;
  if (data.schemaVersion !== 1) throw new Error("Unsupported dataset version.");
  const retrieved = timestamp(data.retrievedAt);
  if (!Array.isArray(data.sources) || data.sources.length !== symbols.length) throw new Error("One source receipt per ETF is required.");
  const sourceSymbols = new Set<string>();
  for (const source of data.sources) {
    if (!source || !symbols.includes(source.symbol) || sourceSymbols.has(source.symbol)) throw new Error("Invalid or duplicate source symbol.");
    sourceSymbols.add(source.symbol);
    try { if (new URL(source.sourceUrl).protocol !== "https:") throw new Error(); } catch { throw new Error("Source URL must use HTTPS."); }
    if (!/^[a-f0-9]{64}$/i.test(source.sha256)) throw new Error("Missing source SHA256.");
    timestamp(source.retrievedAt);
  }
  if (!Array.isArray(data.rows) || data.rows.length < 202) throw new Error("At least 202 aligned observations are required.");
  const rows = data.rows.map(row => {
    if (!row || typeof row !== "object") throw new Error("Incomplete row.");
    if (dateMs(row.date) >= Math.floor(retrieved / DAY) * DAY) throw new Error("Only completed dates before retrieval UTC date are accepted.");
    const copy = { date: row.date, ...empty() };
    for (const symbol of symbols) {
      if (typeof row[symbol] !== "number" || !Number.isFinite(row[symbol]) || row[symbol] <= 0) throw new Error(`Missing or invalid ${symbol} observation.`);
      copy[symbol] = row[symbol];
    }
    return copy;
  }).sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < rows.length; i++) {
    const gap = dateMs(rows[i].date) - dateMs(rows[i - 1].date);
    if (gap === 0) throw new Error("Duplicate observation date.");
    if (gap > 4 * DAY) throw new Error("Gap exceeds four calendar days; reconcile missing sessions before evaluation.");
  }
  return { schemaVersion: 1, retrievedAt: data.retrievedAt, sources: data.sources.map(s => ({ ...s })), rows };
}
type State = { holdings: Weights; cash: number; peak: number; maxDD: number; turnover: number; costPaid: number; exposureSum: number; rebalances: number };
const state = (): State => ({ holdings: empty(), cash: 1, peak: 1, maxDD: 0, turnover: 0, costPaid: 0, exposureSum: 0, rebalances: 0 });
function rebalance(p: State, target: Weights, cost: number): number {
  const before = total(p.holdings) + p.cash;
  // Solve post-fee capital E = before - c * sum(abs(target * E - holdings)).
  // This charges buys AND sells, including BIL, without borrowing for fees.
  let low = 0, high = before;
  for (let n = 0; n < 80; n++) {
    const capital = (low + high) / 2;
    const notional = symbols.reduce((sum, s) => sum + Math.abs(target[s] * capital - p.holdings[s]), 0);
    if (capital + cost * notional > before) high = capital; else low = capital;
  }
  const capital = (low + high) / 2;
  const notional = symbols.reduce((sum, s) => sum + Math.abs(target[s] * capital - p.holdings[s]), 0);
  const fee = cost * notional;
  p.holdings = Object.fromEntries(symbols.map(s => [s, target[s] * capital])) as Weights;
  p.cash = 0; p.costPaid += fee; p.turnover += notional / before; p.rebalances++;
  return fee;
}
function liquidate(p: State, cost: number) {
  const held = total(p.holdings), before = held + p.cash;
  p.cash += held * (1 - cost); p.holdings = empty();
  p.costPaid += held * cost; p.turnover += held / before;
}
function observe(p: State): number {
  const value = total(p.holdings) + p.cash;
  if (!Number.isFinite(value) || value <= 0) throw new Error("Non-finite portfolio value.");
  p.peak = Math.max(p.peak, value); p.maxDD = Math.max(p.maxDD, 1 - value / p.peak);
  return value;
}
export function evaluateDiversified(input: DiversifiedDataset, options: DiversifiedOptions = {}): DiversifiedResult {
  const { rows } = validateDiversifiedDataset(input);
  const costBps = options.costBpsPerSide ?? 10;
  if (!Number.isFinite(costBps) || costBps < 0 || costBps >= 10000) throw new Error("Invalid cost assumption.");
  const cost = costBps / 10000;
  const startDate = options.startDate === undefined ? -Infinity : dateMs(options.startDate);
  const endDate = options.endDate === undefined ? Infinity : dateMs(options.endDate);
  if (startDate > endDate) throw new Error("Start follows end.");
  const isMonthChange = (i: number) => i > 0 && rows[i].date.slice(0, 7) !== rows[i - 1].date.slice(0, 7);
  const start = rows.findIndex((row, i) => i >= diversifiedLookback && dateMs(row.date) >= startDate && isMonthChange(i));
  let end = rows.length - 1;
  while (end >= 0 && dateMs(rows[end].date) > endDate) end--;
  if (start < 0 || end <= start) throw new Error("No complete window after warmup and next-month execution.");
  const strategy = state(), benchmark = state();
  const benchmarkTarget: Weights = { SPY: .25, EFA: .25, IEF: .25, GLD: .25, BIL: 0 };
  const equity: DiversifiedResult["equity"] = [], rebalances: DiversifiedResult["rebalances"] = [];
  for (let i = start; i <= end; i++) {
    if (i > start) for (const portfolio of [strategy, benchmark]) {
      const before = total(portfolio.holdings) + portfolio.cash;
      portfolio.exposureSum += riskSymbols.reduce((sum, s) => sum + portfolio.holdings[s], 0) / before;
      for (const symbol of symbols) portfolio.holdings[symbol] *= rows[i][symbol] / rows[i - 1][symbol];
    }
    if (i === end) { liquidate(strategy, cost); liquidate(benchmark, cost); }
    else if (isMonthChange(i)) {
      const target = empty();
      for (const symbol of riskSymbols) {
        const anchor = rows[i - 1][symbol];
        const mean = anchor + rows.slice(i - diversifiedLookback, i).reduce((sum, row) => sum + (row[symbol] - anchor) / diversifiedLookback, 0);
        target[anchor > mean ? symbol : "BIL"] += .25;
      }
      const strategyFee = rebalance(strategy, target, cost), benchmarkFee = rebalance(benchmark, benchmarkTarget, cost);
      rebalances.push({ date: rows[i].date, signalDate: rows[i - 1].date, strategyTarget: target, benchmarkTarget: { ...benchmarkTarget }, strategyFee, benchmarkFee });
    }
    const strategyValue = observe(strategy), benchmarkValue = observe(benchmark);
    equity.push({ date: rows[i].date, strategy: strategyValue, benchmark: benchmarkValue, riskExposurePct: riskSymbols.reduce((sum, s) => sum + strategy.holdings[s], 0) / strategyValue * 100 });
  }
  const years = (dateMs(rows[end].date) - dateMs(rows[start].date)) / DAY / 365.25;
  const metrics = (p: State): PortfolioMetrics => {
    const value = total(p.holdings) + p.cash, cagr = (Math.pow(value, 1 / years) - 1) * 100;
    if (!Number.isFinite(cagr)) throw new Error("Annualized return overflow.");
    return { totalReturnPct: (value - 1) * 100, cagrPct: cagr, maxDrawdownPct: p.maxDD * 100, turnover: p.turnover, costPaid: p.costPaid, costPctInitial: p.costPaid * 100, meanRiskExposurePct: p.exposureSum / (end - start) * 100, rebalanceCount: p.rebalances };
  };
  return { version: diversifiedVersion, metrics: { startDate: rows[start].date, endDate: rows[end].date, observations: end - start + 1, strategy: metrics(strategy), benchmark: metrics(benchmark) }, equity, rebalances, warnings: [
    "Calendar completeness is unverified. A missing month-end session can pass the four-calendar-day gap check and change the signal date, trailing 200 observations and allocation; a missing next session can delay execution. Decisions use the last supplied close, not a verified exchange month-end. Reconcile the full evaluation and warmup window against authoritative exchange sessions before treating it as calendar-complete. This warning does not establish that this dataset has missing sessions.",
    "Retrospective current-vintage adjusted-close ratios are total-return proxies, not executable prices. Corporate actions and original vintage have not been independently reconciled.",
    "Four 25% sleeves are fixed in advance. Monthly decisions use the prior completed month's last supplied observation and its trailing 200 observations; execution is the next supplied close. No same-close execution or parameter search.",
    "BIL is an investable Treasury-bill ETF proxy, not a guaranteed cash account. Its adjusted returns already include provider distribution adjustments; no additional cash interest is added.",
    "The static comparator rebalances the same four ETFs monthly. Both portfolios pay costs on all traded ETF notional, including BIL, and terminal liquidation. Fractional holdings are assumed; taxes, additional slippage and market impact are omitted.",
    "Exposure is the average pre-return portfolio share in SPY/EFA/IEF/GLD across observed intervals. Turnover sums gross traded notional divided by pre-trade equity, including entry and final exit; cumulative fees are in initial-capital units.",
    "Full history and the 2023+ slice are retrospective comparisons, not untouched holdouts. Universe and rule selection reflect existing market knowledge. No significance, future profitability or equal-risk comparison is established.",
    "All five ETF observations are required each date; no filling or dynamic universe substitution occurs. Gaps longer than four calendar days fail, but an exchange-calendar audit is still required to prove every session is present.",
  ] };
}
