export type Dataset = {
  schemaVersion: 1;
  label: string;
  kind: "synthetic" | "imported";
  prices: { date: string; close: number }[];
  events: {
    id: string; firstObservedAt: string; periodEnd: string;
    baselineCarloads: number; evaluationCarloads: number; sourceUrl: string;
  }[];
};
export type StrategyConfig = { declineThresholdPct: number; holdingCalendarDays: number; costBpsPerSide: number };
export const strategyVersion = "freight-long-cash-v1";
export const defaultConfig: StrategyConfig = { declineThresholdPct: 5, holdingCalendarDays: 20, costBpsPerSide: 10 };
export type Trade = { eventId: string; declinePct: number; entryDate: string; exitDate: string; entryClose: number; exitClose: number; grossReturnPct: number; netReturnPct: number };
export type Skip = { eventId: string; reason: string };
export type EquityPoint = { date: string; strategy: number; buyHold: number };
export type StrategyResult = {
  trades: Trade[]; skips: Skip[]; equity: EquityPoint[];
  metrics: { tradeCount: number; totalReturnPct: number; buyHoldReturnPct: number; excessReturnPct: number; maxDrawdownPct: number; exposureCalendarPct: number; winRatePct: number | null; evaluatedStart: string | null; evaluatedEnd: string | null };
  warnings: string[];
};
const DAY = 86_400_000;
function dateValue(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must be YYYY-MM-DD.`);
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new Error(`${field} is not a valid calendar date.`);
  return parsed;
}
function numberValue(value: unknown, field: string, allowZero = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${field} must be a finite ${allowZero ? "nonnegative" : "positive"} number.`);
  return value;
}
function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a nonempty string.`);
  return value;
}
export function validateDataset(value: unknown): Dataset {
  const data = record(value, "Dataset");
  if (data.schemaVersion !== 1) throw new Error("schemaVersion must be 1.");
  if (data.kind !== "synthetic" && data.kind !== "imported") throw new Error("kind must be synthetic or imported.");
  if (!Array.isArray(data.prices) || data.prices.length === 0) throw new Error("prices must be a nonempty array.");
  if (!Array.isArray(data.events)) throw new Error("events must be an array.");
  const dates = new Set<string>();
  const prices = data.prices.map((value, i) => {
    const row = record(value, `prices[${i}]`);
    dateValue(row.date, `prices[${i}].date`);
    const date = row.date as string;
    if (dates.has(date)) throw new Error(`Duplicate price date: ${date}.`);
    dates.add(date);
    return { date, close: numberValue(row.close, `prices[${i}].close`) };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const ids = new Set<string>();
  const events = data.events.map((value, i) => {
    const row = record(value, `events[${i}]`);
    const id = text(row.id, `events[${i}].id`);
    if (ids.has(id)) throw new Error(`Duplicate event id: ${id}.`);
    ids.add(id);
    const observed = text(row.firstObservedAt, `events[${i}].firstObservedAt`);
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(observed) || !Number.isFinite(Date.parse(observed))) throw new Error(`events[${i}].firstObservedAt must be an ISO timestamp with timezone.`);
    dateValue(observed.slice(0, 10), `events[${i}].firstObservedAt date`);
    const end = dateValue(row.periodEnd, `events[${i}].periodEnd`);
    if (Date.parse(observed) < end) throw new Error(`events[${i}].firstObservedAt cannot precede periodEnd in UTC.`);
    const sourceUrl = text(row.sourceUrl, `events[${i}].sourceUrl`);
    try { if (!["https:", "http:"].includes(new URL(sourceUrl).protocol)) throw new Error(); }
    catch { throw new Error(`events[${i}].sourceUrl must be an absolute HTTP(S) URL.`); }
    return { id, firstObservedAt: observed, periodEnd: row.periodEnd as string,
      baselineCarloads: numberValue(row.baselineCarloads, `events[${i}].baselineCarloads`),
      evaluationCarloads: numberValue(row.evaluationCarloads, `events[${i}].evaluationCarloads`, true), sourceUrl };
  }).sort((a, b) => Date.parse(a.firstObservedAt) - Date.parse(b.firstObservedAt) || a.id.localeCompare(b.id));
  return { schemaVersion: 1, label: text(data.label, "label"), kind: data.kind, prices, events };
}

export function evaluateStrategy(input: Dataset, config: StrategyConfig = defaultConfig): StrategyResult {
  const data = validateDataset(input);
  if (!Number.isFinite(config.declineThresholdPct) || config.declineThresholdPct < 0 || config.declineThresholdPct > 100) throw new Error("declineThresholdPct must be between 0 and 100.");
  if (!Number.isInteger(config.holdingCalendarDays) || config.holdingCalendarDays < 1 || config.holdingCalendarDays > 3650) throw new Error("holdingCalendarDays must be an integer from 1 to 3650.");
  if (!Number.isFinite(config.costBpsPerSide) || config.costBpsPerSide < 0 || config.costBpsPerSide >= 10000) throw new Error("costBpsPerSide must be between 0 and 10000 (exclusive).");
  const { prices } = data;
  const cost = config.costBpsPerSide / 10000;
  const trades: Trade[] = [], skips: Skip[] = [];
  let occupiedUntil = -1, start = prices.length, finish = -1;
  const warnings = [
    data.kind === "synthetic" ? "Synthetic demonstration only: these generated observations and prices are not historical market evidence." : "Imported data is user supplied. Original publication times, source accuracy and availability remain unverified.",
    "Experimental rule, not a validated investment strategy. Four-week originated non-intermodal counts must use comparable definitions; the evaluator cannot verify them.",
    "Entry uses the first close on a strictly later UTC calendar date than firstObservedAt. Exits use calendar days, not trading days. Gaps can delay execution.",
    "Close-only returns exclude dividends, taxes, cash interest, slippage beyond the specified costs, and corporate-action validation. Use consistently adjusted price data.",
    "The comparison window spans every complete candidate signal horizon, before threshold or overlap decisions. It is independent of which trades are selected. Buy-and-hold pays the same per-side costs once. No statistical significance or out-of-sample edge is established.",
    "Signals observed on or before an existing position's exit UTC date are ignored, including the exit day: close-only data cannot prove they arrived after liquidation.",
    "Threshold and holding-period changes are exploratory, not optimization evidence. Close availability and the trading calendar are unverified; the first available close is assumed executable.",
    "Aggregate counts cannot establish eight complete reporting weeks (four baseline plus four evaluation weeks), consistent coverage, or original publication proof. Those checks require underlying source records.",
    "Per-trade net return is (exit close / entry close) × (1 − cost per side)² − 1. Cash allocation and market exposure differ from continuously invested buy-and-hold.",
  ];
  if (prices.some((p, i) => i > 0 && dateValue(p.date, "price date") - dateValue(prices[i - 1].date, "price date") > 4 * DAY)) warnings.push("Price gaps exceed four calendar days. Entries and exits may be substantially delayed; missing observations are not filled.");
  const candidates: { event: Dataset["events"][number]; observedDate: string; entry: number; exit: number }[] = [];
  // Establish the comparable window from data availability only, before any
  // parameter-dependent threshold or position-overlap decision can select it.
  for (const event of data.events) {
    const observedDate = new Date(event.firstObservedAt).toISOString().slice(0, 10);
    const entry = prices.findIndex(p => p.date > observedDate);
    if (entry < 0) { skips.push({ eventId: event.id, reason: "No close after the observation date." }); continue; }
    const exitTarget = dateValue(prices[entry].date, "entry date") + config.holdingCalendarDays * DAY;
    const exit = prices.findIndex((p, i) => i > entry && dateValue(p.date, "price date") >= exitTarget);
    if (exit < 0) { skips.push({ eventId: event.id, reason: "Missing exit close at or after the full holding horizon; no trade or partial return recorded." }); continue; }
    start = Math.min(start, entry); finish = Math.max(finish, exit);
    candidates.push({ event, observedDate, entry, exit });
  }
  for (const { event, observedDate, entry, exit } of candidates) {
    if (occupiedUntil >= 0 && observedDate <= prices[occupiedUntil].date) {
      skips.push({ eventId: event.id, reason: "Overlapping signal: observed on or before the existing position's exit UTC date; intraday close timing is unavailable." }); continue;
    }
    const declinePct = (1 - event.evaluationCarloads / event.baselineCarloads) * 100;
    if (!Number.isFinite(declinePct)) throw new Error(`Event ${event.id} has a freight ratio outside the supported numeric range.`);
    // Ratio comparison avoids floating-point noise at the exact threshold.
    if (event.evaluationCarloads <= event.baselineCarloads * (1 - config.declineThresholdPct / 100)) {
      skips.push({ eventId: event.id, reason: `Cash signal: freight decline ${declinePct.toFixed(2)}% meets the ${config.declineThresholdPct}% threshold.` }); continue;
    }
    occupiedUntil = exit;
    const ratio = prices[exit].close / prices[entry].close;
    if (!Number.isFinite(ratio * 100)) throw new Error(`Event ${event.id} has a price ratio outside the supported numeric range.`);
    trades.push({ eventId: event.id, declinePct, entryDate: prices[entry].date, exitDate: prices[exit].date,
      entryClose: prices[entry].close, exitClose: prices[exit].close, grossReturnPct: (ratio - 1) * 100,
      netReturnPct: (ratio * (1 - cost) ** 2 - 1) * 100 });
  }
  const equity: EquityPoint[] = [];
  let cash = 1, shares = 0, active: Trade | undefined, nextTrade = 0, peak = 1, maxDrawdown = 0;
  for (let i = start; i <= finish; i++) {
    const price = prices[i];
    if (trades[nextTrade]?.entryDate === price.date) {
      active = trades[nextTrade++]; shares = cash * (1 - cost) / price.close; cash = 0;
    }
    if (active?.exitDate === price.date) { cash = shares * price.close * (1 - cost); shares = 0; active = undefined; }
    const strategy = cash + shares * price.close;
    const buyHold = prices[i].close / prices[start].close * (1 - cost) * (i === finish ? 1 - cost : 1);
    if (!Number.isFinite(strategy * 100) || !Number.isFinite(buyHold * 100)) throw new Error("Compounded equity exceeds the supported numeric range.");
    peak = Math.max(peak, strategy); maxDrawdown = Math.max(maxDrawdown, (1 - strategy / peak) * 100);
    equity.push({ date: price.date, strategy, buyHold });
  }
  const last = equity[equity.length - 1];
  const totalReturnPct = last ? (last.strategy - 1) * 100 : 0;
  const buyHoldReturnPct = last ? (last.buyHold - 1) * 100 : 0;
  const windowDays = last ? (dateValue(prices[finish].date, "end") - dateValue(prices[start].date, "start")) / DAY : 0;
  const investedDays = trades.reduce((sum, trade) => sum + (dateValue(trade.exitDate, "exit") - dateValue(trade.entryDate, "entry")) / DAY, 0);
  if (!last) warnings.push("No complete evaluation window is available. Zero returns mean no evaluation, not observed performance.");
  return { trades, skips, equity, warnings, metrics: { tradeCount: trades.length, totalReturnPct, buyHoldReturnPct,
    excessReturnPct: totalReturnPct - buyHoldReturnPct, maxDrawdownPct: maxDrawdown, exposureCalendarPct: windowDays ? investedDays / windowDays * 100 : 0,
    winRatePct: trades.length ? trades.filter(t => t.netReturnPct > 0).length / trades.length * 100 : null,
    evaluatedStart: last ? prices[start].date : null, evaluatedEnd: last ? prices[finish].date : null } };
}

// Fixed artificial series with no random state or downloaded market observations.
export const sampleDataset: Dataset = {
  schemaVersion: 1, label: "Synthetic freight slowdown and recovery", kind: "synthetic",
  prices: Array.from({ length: 126 }, (_, i) => {
    const date = new Date(Date.UTC(2025, 0, 1) + i * DAY);
    return { date: date.toISOString().slice(0, 10), close: Math.round((100 + i * 0.08 + Math.sin(i / 8) * 5) * 100) / 100 };
  }).filter(p => ![0, 6].includes(new Date(`${p.date}T00:00:00Z`).getUTCDay())),
  events: [0, 28, 56, 84].map((day, i) => ({ id: `synthetic-${i + 1}`,
    firstObservedAt: new Date(Date.UTC(2025, 0, 2 + day, 17)).toISOString(),
    periodEnd: new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10),
    baselineCarloads: 10000, evaluationCarloads: [9800, 9000, 9600, 10300][i],
    sourceUrl: "https://example.invalid/synthetic-freight-fixture" })),
};
