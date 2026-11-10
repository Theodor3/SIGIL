// Side-by-side company comparison: pure logic, no React and no ambient I/O.
//
// Everything shown comes from the existing GET /api/research/ticker/{T} response.
// The rules this module holds to:
//   - a value that is absent, non-finite or the wrong type becomes null, never 0;
//   - nothing is estimated, filled forward or borrowed from another company;
//   - the endpoint also returns trade history and evaluations -- those are never read.
import type { ScoreStatus } from "./savedScores";

export const MAX_COMPARE = 4;

// One to six letters/digits starting with a letter, optional class suffix (BRK.B, BF-B).
const TICKER = /^[A-Z][A-Z0-9]{0,5}(?:[.-][A-Z0-9]{1,2})?$/;

const SCORE_STATUSES: readonly ScoreStatus[] = [
  "saved", "no_run", "legacy_unavailable", "invalid_snapshot",
  "serialization_unavailable", "ticker_unavailable",
];

export interface TickerList {
  /** Valid, upper-cased, de-duplicated, in first-seen order, at most `max`. */
  tickers: string[];
  /** Entries that are not ticker-shaped, shortened for display. */
  rejected: string[];
  /** Valid tickers left out because the list was already full. */
  overLimit: string[];
}

/** Parses user- or URL-supplied text. Never throws; unusable input is reported, not guessed at. */
export function parseTickerList(raw: unknown, max: number = MAX_COMPARE): TickerList {
  const result: TickerList = { tickers: [], rejected: [], overLimit: [] };
  if (typeof raw !== "string") return result;
  // Bound the work a hostile or pasted-by-mistake query string can cause.
  const parts = raw.slice(0, 400).split(/[\s,;]+/).filter(Boolean).slice(0, 40);
  for (const part of parts) {
    const symbol = part.toUpperCase();
    if (!TICKER.test(symbol)) {
      const shown = part.length > 12 ? `${part.slice(0, 12)}…` : part;
      if (!result.rejected.includes(shown)) result.rejected.push(shown);
    } else if (result.tickers.includes(symbol) || result.overLimit.includes(symbol)) {
      continue;
    } else if (result.tickers.length >= max) {
      result.overLimit.push(symbol);
    } else {
      result.tickers.push(symbol);
    }
  }
  return result;
}

export interface CompanyColumn {
  ticker: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  price: number | null;
  low52: number | null;
  high52: number | null;
  finalScore: number | null;
  confidence: number | null;
  eligible: boolean | null;
  scoreStatus: ScoreStatus | undefined;
  /** Instant of the saved run these scores belong to, as canonical UTC ISO text (see parseRunInstant). */
  runDate: string | null;
  /** Saved signal values by signal name, in the order sent. Only finite numbers are kept. */
  signals: Map<string, number>;
  /** Signal entries the backend sent that could not be used. */
  malformedSignals: number;
}

const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const positive = (v: unknown): number | null => {
  const n = finite(v);
  return n !== null && n > 0 ? n : null;
};
const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const RUN_STAMP =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Reads the backend's `run_date` as an instant (milliseconds since the epoch).
 *
 * Contract, from the backend source: the pipeline runner stamps a run with
 * `datetime.utcnow()`, the column has no timezone, and the research route sends
 * `started_at.isoformat()`. So a stamp without an offset is UTC -- it is never
 * read in the browser's own timezone. A stamp that does carry `Z` or an offset
 * keeps it. Anything else (date only, impossible calendar values, other text)
 * is rejected as null rather than guessed at.
 */
export function parseRunInstant(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = RUN_STAMP.exec(raw.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const millis = m[7] === undefined ? 0 : Number(m[7].padEnd(3, "0").slice(0, 3));
  if (hour > 23 || minute > 59 || second > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  const check = new Date(utc);
  // Date.UTC rolls 02-30 over into March; an impossible date is refused instead.
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const zone = m[8];
  if (zone === undefined || zone === "Z") return utc;
  const digits = zone.slice(1).replace(":", "");
  const offsetHours = Number(digits.slice(0, 2));
  const offsetMinutes = Number(digits.slice(2));
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  const offset = (offsetHours * 60 + offsetMinutes) * 60_000;
  return zone[0] === "+" ? utc - offset : utc + offset;
}

/** `2026-01-05 14:00 UTC` for a canonical run instant; the same text on every device. */
export const formatRunTime = (runDate: string | null): string | null =>
  runDate === null ? null : `${runDate.slice(0, 16).replace("T", " ")} UTC`;

/**
 * Validates one untrusted ticker response. Returns null when the body is not an
 * object or describes a different ticker than the one requested; otherwise every
 * field is taken individually and anything unusable becomes null.
 */
export function normalizeTickerPayload(raw: unknown, requested: string): CompanyColumn | null {
  if (!record(raw) || typeof raw.ticker !== "string") return null;
  if (raw.ticker.toUpperCase() !== requested.toUpperCase()) return null;

  const company = record(raw.company) ? raw.company : {};
  const signals = new Map<string, number>();
  let malformedSignals = 0;
  if (Array.isArray(raw.signals)) {
    for (const entry of raw.signals.slice(0, 200)) {
      const name = record(entry) ? text(entry.signal) : null;
      const score = record(entry) ? finite(entry.score) : null;
      if (name === null || score === null || signals.has(name)) malformedSignals += 1;
      else signals.set(name, score);
    }
  } else if (raw.signals !== undefined && raw.signals !== null) {
    malformedSignals = 1;
  }

  const status = SCORE_STATUSES.find((s) => s === raw.score_status);
  const runInstant = parseRunInstant(raw.run_date);
  const runDate = runInstant === null ? null : new Date(runInstant).toISOString();
  const name = text(company.name);

  return {
    ticker: requested.toUpperCase(),
    // The backend falls back to the symbol itself when it has no name.
    name: name && name.toUpperCase() !== requested.toUpperCase() ? name : null,
    sector: text(company.sector),
    industry: text(company.industry),
    marketCap: positive(company.market_cap),
    price: positive(company.price),
    low52: positive(company.fifty_two_week_low),
    high52: positive(company.fifty_two_week_high),
    finalScore: finite(raw.final_score),
    confidence: finite(raw.confidence),
    eligible: typeof raw.eligible === "boolean" ? raw.eligible : null,
    scoreStatus: status,
    runDate,
    signals,
    malformedSignals,
  };
}

/** True when the backend returned no usable company fact at all (often a mistyped symbol). */
export function hasNoCompanyFacts(c: CompanyColumn): boolean {
  return [c.name, c.sector, c.industry, c.marketCap, c.price, c.low52, c.high52].every((v) => v === null);
}

/**
 * Where the price sits between the 52-week low (0) and high (1). Derived in the
 * browser from three displayed numbers; null unless all three are present and
 * mutually consistent, so a stale or crossed quote yields "unavailable", not a guess.
 */
export function rangePosition(c: Pick<CompanyColumn, "price" | "low52" | "high52">): number | null {
  const { price, low52, high52 } = c;
  if (price === null || low52 === null || high52 === null) return null;
  if (!(high52 > low52) || price < low52 || price > high52) return null;
  return (price - low52) / (high52 - low52);
}

export type LoadFailure = "unauthorized" | "http_error" | "network_error" | "invalid_response";
export type LoadResult =
  | { status: "ready"; column: CompanyColumn }
  | { status: "error"; reason: LoadFailure; httpStatus?: number }
  | { status: "aborted" };

type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Loads one column from the existing research endpoint. Never throws. */
export async function fetchCompanyColumn(
  ticker: string, fetchImpl: FetchLike, signal: AbortSignal,
): Promise<LoadResult> {
  try {
    const response = await fetchImpl(`/api/research/ticker/${encodeURIComponent(ticker)}`, {
      signal, headers: { Accept: "application/json" },
    });
    if (signal.aborted) return { status: "aborted" };
    if (response.status === 401 || response.status === 403) {
      return { status: "error", reason: "unauthorized", httpStatus: response.status };
    }
    if (!response.ok) return { status: "error", reason: "http_error", httpStatus: response.status };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return signal.aborted ? { status: "aborted" } : { status: "error", reason: "invalid_response" };
    }
    if (signal.aborted) return { status: "aborted" };
    const column = normalizeTickerPayload(body, ticker);
    return column ? { status: "ready", column } : { status: "error", reason: "invalid_response" };
  } catch {
    return signal.aborted ? { status: "aborted" } : { status: "error", reason: "network_error" };
  }
}

export function failureMessage(reason: LoadFailure, httpStatus?: number): string {
  switch (reason) {
    case "unauthorized": return "Sign-in required or session expired.";
    case "http_error": return `The Sigil backend answered with HTTP ${httpStatus ?? "error"}.`;
    case "network_error": return "Could not reach the Sigil backend.";
    case "invalid_response": return "The response was not in the expected format, so nothing is shown.";
  }
}

export type ColumnState =
  | { ticker: string; status: "loading" }
  | { ticker: string; status: "ready"; column: CompanyColumn }
  | { ticker: string; status: "error"; reason: LoadFailure; httpStatus?: number };

export interface CompareState { columns: ColumnState[] }
export type CompareAction =
  | { type: "set"; tickers: string[] }
  | { type: "resolved"; ticker: string; result: LoadResult }
  | { type: "retry"; ticker: string };

export const emptyCompareState: CompareState = { columns: [] };

export function compareReducer(state: CompareState, action: CompareAction): CompareState {
  switch (action.type) {
    case "set": {
      const same = action.tickers.length === state.columns.length
        && action.tickers.every((t, i) => state.columns[i].ticker === t);
      if (same) return state;
      // Keep what is already loaded for tickers that stay; only new ones load.
      return {
        columns: action.tickers.map((ticker) =>
          state.columns.find((c) => c.ticker === ticker) ?? { ticker, status: "loading" }),
      };
    }
    case "resolved": {
      if (action.result.status === "aborted") return state;
      const result = action.result;
      // A response for a ticker that was removed meanwhile is dropped.
      if (!state.columns.some((c) => c.ticker === action.ticker && c.status === "loading")) return state;
      return {
        columns: state.columns.map((c) => c.ticker !== action.ticker ? c
          : result.status === "ready"
            ? { ticker: c.ticker, status: "ready", column: result.column }
            : { ticker: c.ticker, status: "error", reason: result.reason, httpStatus: result.httpStatus }),
      };
    }
    case "retry":
      return {
        columns: state.columns.map((c) =>
          c.ticker === action.ticker && c.status === "error" ? { ticker: c.ticker, status: "loading" } : c),
      };
  }
}

export interface ColumnLoader {
  /** Start requests for loading columns that have none in flight; abort those for removed columns. */
  sync(columns: ColumnState[]): void;
  /** Abort everything in flight. Nothing is reported after this. */
  dispose(): void;
}

/**
 * Owns the in-flight requests so the page cannot leak one: at most one request per
 * ticker, removed tickers are aborted, and after dispose() no result is delivered.
 */
export function createColumnLoader(
  fetchImpl: FetchLike, onResult: (ticker: string, result: LoadResult) => void,
): ColumnLoader {
  // A request stays here after it has answered, marked delivered, until a sync
  // shows the page no longer has that company as loading. The page can sync
  // once more with its old state before it has rendered the answer; forgetting
  // the request at delivery made that sync ask for the company a second time.
  const requests = new Map<string, { controller: AbortController; delivered: boolean }>();
  let disposed = false;
  return {
    sync(columns) {
      if (disposed) return;
      const loading = new Set(columns.filter((c) => c.status === "loading").map((c) => c.ticker));
      for (const [ticker, request] of requests) {
        if (loading.has(ticker)) continue;
        if (!request.delivered) request.controller.abort();
        requests.delete(ticker);
      }
      for (const ticker of loading) {
        if (requests.has(ticker)) continue;
        const request = { controller: new AbortController(), delivered: false };
        requests.set(ticker, request);
        void fetchCompanyColumn(ticker, fetchImpl, request.controller.signal).then((result) => {
          if (requests.get(ticker) !== request) return; // superseded or disposed
          if (result.status === "aborted") { requests.delete(ticker); return; }
          request.delivered = true;
          onResult(ticker, result);
        });
      }
    },
    dispose() {
      disposed = true;
      for (const request of requests.values()) if (!request.delivered) request.controller.abort();
      requests.clear();
    },
  };
}

export type RunAlignment = "not_applicable" | "same_run" | "different_runs" | "unknown";

/** Whether the loaded columns' saved scores all belong to one pipeline run. */
export function runAlignment(columns: CompanyColumn[]): RunAlignment {
  if (columns.length < 2) return "not_applicable";
  if (columns.some((c) => c.runDate === null)) return "unknown";
  const instants = new Set(columns.map((c) => c.runDate));
  return instants.size === 1 ? "same_run" : "different_runs";
}

export interface SignalRow {
  signal: string;
  /**
   * One entry per selected column, in column order; null where there is no saved
   * value to show -- either the company has none, or the company is not loaded.
   */
  values: (number | null)[];
  /** Columns with a saved value. */
  present: number;
  /** Selected columns that are not loaded (loading or failed): unknown, not "missing". */
  unavailable: number;
  /** Highest minus lowest saved value; null unless at least two companies have one. */
  spread: number | null;
}

/**
 * Union of saved signals, aligned by signal name across EVERY selected column.
 * Pass null for a column that is still loading or failed to load: it keeps its
 * place, contributes no value, and stops a row from counting as saved for every
 * company -- what an unloaded company holds is not known.
 */
export function buildSignalRows(columns: (CompanyColumn | null)[]): SignalRow[] {
  const names: string[] = [];
  for (const column of columns) {
    if (column === null) continue;
    for (const name of column.signals.keys()) if (!names.includes(name)) names.push(name);
  }
  const unavailable = columns.filter((c) => c === null).length;
  return names.map((signal) => {
    const values = columns.map((c) => c?.signals.get(signal) ?? null);
    const saved = values.filter((v): v is number => v !== null);
    return {
      signal, values, present: saved.length, unavailable,
      spread: saved.length >= 2 ? Math.max(...saved) - Math.min(...saved) : null,
    };
  });
}

export type SignalFilter = "all" | "shared" | "gaps";
export type SignalSort = "spread" | "name";

/**
 * Filters and orders signal rows without changing them. "shared" keeps only rows
 * with a saved value in every selected column, so a row is never called shared
 * while a company is loading or failed; "gaps" is exactly the rest.
 */
export function arrangeSignalRows(rows: SignalRow[], filter: SignalFilter, sort: SignalSort): SignalRow[] {
  const kept = rows.filter((row) => {
    const complete = row.present === row.values.length;
    return filter === "all" || (filter === "shared" ? complete : !complete);
  });
  const byName = (a: SignalRow, b: SignalRow) => (a.signal < b.signal ? -1 : a.signal > b.signal ? 1 : 0);
  return [...kept].sort(sort === "name" ? byName : (a, b) => {
    // Rows with no measurable difference go last; they are not "zero difference".
    if (a.spread === null || b.spread === null) {
      return a.spread === b.spread ? byName(a, b) : a.spread === null ? 1 : -1;
    }
    return b.spread - a.spread || byName(a, b);
  });
}

export function formatMarketCap(value: number | null): string | null {
  if (value === null) return null;
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export const formatPrice = (value: number | null): string | null =>
  value === null ? null : `$${value.toFixed(2)}`;

/** Signal values and differences are shown on the same 0-100 scale the Research page uses. */
export const formatPoints = (value: number | null): string | null =>
  value === null ? null : (value * 100).toFixed(1);
