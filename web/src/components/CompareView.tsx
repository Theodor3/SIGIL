import type { ReactNode } from "react";
import { formatSavedScore, scoreStatusLabel } from "../lib/savedScores";
import {
  arrangeSignalRows, buildSignalRows, failureMessage, formatMarketCap, formatPoints, formatPrice,
  formatRunTime, hasNoCompanyFacts, rangePosition, runAlignment,
  type ColumnState, type CompanyColumn, type CompareState, type SignalFilter, type SignalSort,
} from "../lib/companyCompare";

interface Props {
  state: CompareState;
  filter: SignalFilter;
  sort: SignalSort;
  onFilter: (filter: SignalFilter) => void;
  onSort: (sort: SignalSort) => void;
  onRemove: (ticker: string) => void;
  onRetry: (ticker: string) => void;
}

const FILTERS: { value: SignalFilter; label: string }[] = [
  { value: "all", label: "All signals" },
  { value: "shared", label: "Saved for every company" },
  { value: "gaps", label: "Missing or not loaded for at least one" },
];
const SORTS: { value: SignalSort; label: string }[] = [
  { value: "spread", label: "Largest difference first" },
  { value: "name", label: "Signal name" },
];

const Missing = ({ children }: { children: ReactNode }) => (
  <span className="text-sigil-muted italic">{children}</span>
);

/** One body cell: a value for a loaded company, and a plain-words placeholder otherwise. */
function Cell({ column, missing, value }: {
  column: ColumnState; missing: string; value: (c: CompanyColumn) => string | null;
}) {
  let content: ReactNode;
  if (column.status === "loading") content = <Missing>Loading…</Missing>;
  else if (column.status === "error") content = <Missing>Not loaded</Missing>;
  else {
    const shown = value(column.column);
    content = shown === null ? <Missing>{missing}</Missing> : shown;
  }
  return <td className="px-3 py-2 text-sm font-mono text-sigil-text align-top">{content}</td>;
}

function Choice<T extends string>({ legend, name, options, value, onChange }: {
  legend: string; name: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <legend className="text-xs font-semibold uppercase tracking-wider text-sigil-muted mb-1">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-1.5 text-sm text-sigil-text">
          <input
            type="radio" name={name} value={option.value}
            checked={value === option.value} onChange={() => onChange(option.value)}
            className="accent-sigil-accent"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

// The first column stays put while a table scrolls sideways, so on a narrow
// screen every value still has its row label next to it. It needs its own
// background or the scrolled values would show through.
// Long signal names wrap rather than widen it past a phone screen.
const pinned = "sticky left-0 z-10 bg-sigil-surface max-w-[7rem] sm:max-w-none [overflow-wrap:anywhere]";
const rowHead = `${pinned} px-3 py-2 text-left text-sm font-medium text-sigil-muted align-top`;
const cornerHead = `${pinned} px-3 py-2 text-left text-xs text-sigil-muted font-medium w-28 sm:w-44`;
const tableClass = "w-full min-w-[36rem] border-collapse";
const caption = "caption-top text-left text-sm font-semibold uppercase tracking-wider text-sigil-muted pb-2";

export default function CompareView({ state, filter, sort, onFilter, onSort, onRemove, onRetry }: Props) {
  const { columns } = state;
  if (columns.length === 0) {
    return (
      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5 text-sm text-sigil-muted">
        <p className="text-sigil-text font-medium">No companies selected yet.</p>
        <p className="mt-1">
          Add two to four tickers above to line up their company facts, saved pipeline score and saved
          signal values. Nothing is requested until you add a ticker.
        </p>
      </div>
    );
  }

  const ready = columns.flatMap((c) => (c.status === "ready" ? [c.column] : []));
  const alignment = runAlignment(ready);
  // Signal rows cover every selected column. A company still loading or failed
  // keeps its place and counts as unknown, so no row is called "saved for every
  // company" until every company has actually loaded.
  const notLoaded = columns.length - ready.length;
  const allRows = buildSignalRows(columns.map((c) => (c.status === "ready" ? c.column : null)));
  const rows = arrangeSignalRows(allRows, filter, sort);

  const head = (
    <thead>
      <tr className="border-b border-sigil-border">
        <th scope="col" className={cornerHead}>Measure</th>
        {columns.map((column) => (
          <th key={column.ticker} scope="col" className="px-3 py-2 text-left align-top">
            <span className="text-base font-bold text-sigil-accent">{column.ticker}</span>
            {column.status === "ready" && column.column.name && (
              <span className="block text-xs font-normal text-sigil-text">{column.column.name}</span>
            )}
          </th>
        ))}
      </tr>
    </thead>
  );

  return (
    <div className="space-y-6">
      {/* Per-company controls and load state */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Selected companies">
        {columns.map((column) => (
          <li key={column.ticker} className="rounded-lg border border-sigil-border bg-sigil-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-sigil-accent">{column.ticker}</span>
              <button
                type="button" onClick={() => onRemove(column.ticker)}
                aria-label={`Remove ${column.ticker} from comparison`}
                className="text-xs px-2 py-1 rounded border border-sigil-border text-sigil-muted hover:text-sigil-text focus:outline-none focus:border-sigil-accent"
              >
                Remove
              </button>
            </div>
            {column.status === "loading" && (
              <p role="status" className="mt-2 text-xs text-sigil-muted">Loading {column.ticker}…</p>
            )}
            {column.status === "error" && (
              <div role="alert" className="mt-2 text-xs text-sigil-danger">
                <p>{failureMessage(column.reason, column.httpStatus)}</p>
                <button
                  type="button" onClick={() => onRetry(column.ticker)}
                  aria-label={`Retry loading ${column.ticker}`}
                  className="mt-1 underline text-sigil-text focus:outline-none focus:text-sigil-accent"
                >
                  Retry
                </button>
              </div>
            )}
            {column.status === "ready" && (
              <div className="mt-2 text-xs text-sigil-muted space-y-1">
                <p>{scoreStatusLabel(column.column.scoreStatus)}</p>
                {hasNoCompanyFacts(column.column) && (
                  <p className="text-sigil-warn">No company facts were returned. Check the symbol.</p>
                )}
                {column.column.malformedSignals > 0 && (
                  <p className="text-sigil-warn">
                    {column.column.malformedSignals} saved signal{column.column.malformedSignals === 1 ? " entry was" : " entries were"} unreadable and left out.
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {columns.length === 1 && (
        <p role="status" className="text-sm text-sigil-muted">Add at least one more company to compare.</p>
      )}
      {alignment === "different_runs" && (
        <p role="alert" className="rounded-lg border border-sigil-warn/40 bg-sigil-warn/10 px-4 py-3 text-sm text-sigil-warn">
          These companies were loaded from different saved pipeline runs. Their scores and signal values
          were not computed together; compare the run times below before reading across a row.
        </p>
      )}
      {alignment === "unknown" && (
        <p role="status" className="text-sm text-sigil-muted">
          At least one company has no saved run time, so it cannot be confirmed that these scores come from the same run.
        </p>
      )}

      {/* The padding belongs to the card, not the scrolling area, so nothing scrolls past the pinned labels. */}
      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <div className="overflow-x-auto">
        <table className={tableClass}>
          <caption className={caption}>Company facts and saved score</caption>
          {head}
          <tbody className="divide-y divide-sigil-border">
            <tr><th scope="row" className={rowHead}>Sector</th>
              {columns.map((c) => <Cell key={c.ticker} column={c} missing="Unavailable" value={(x) => x.sector} />)}</tr>
            <tr><th scope="row" className={rowHead}>Industry</th>
              {columns.map((c) => <Cell key={c.ticker} column={c} missing="Unavailable" value={(x) => x.industry} />)}</tr>
            <tr><th scope="row" className={rowHead}>Market cap</th>
              {columns.map((c) => <Cell key={c.ticker} column={c} missing="Unavailable" value={(x) => formatMarketCap(x.marketCap)} />)}</tr>
            <tr><th scope="row" className={rowHead}>Price</th>
              {columns.map((c) => <Cell key={c.ticker} column={c} missing="Unavailable" value={(x) => formatPrice(x.price)} />)}</tr>
            <tr><th scope="row" className={rowHead}>52-week low</th>
              {columns.map((c) => <Cell key={c.ticker} column={c} missing="Unavailable" value={(x) => formatPrice(x.low52)} />)}</tr>
            <tr><th scope="row" className={rowHead}>52-week high</th>
              {columns.map((c) => <Cell key={c.ticker} column={c} missing="Unavailable" value={(x) => formatPrice(x.high52)} />)}</tr>
            <tr><th scope="row" className={rowHead}>Position in 52-week range <span className="block text-xs font-normal">0% = low, 100% = high; computed here</span></th>
              {columns.map((c) => <Cell key={c.ticker} column={c} missing="Unavailable" value={(x) => {
                const position = rangePosition(x);
                return position === null ? null : `${(position * 100).toFixed(0)}%`;
              }} />)}</tr>
            <tr><th scope="row" className={rowHead}>Saved pipeline score</th>
              {columns.map((c) => <Cell key={c.ticker} column={c} missing="Not saved" value={(x) => x.finalScore === null ? null : formatSavedScore(x.finalScore)} />)}</tr>
            <tr><th scope="row" className={rowHead}>Confidence</th>
              {columns.map((c) => <Cell key={c.ticker} column={c} missing="Not saved" value={(x) => x.confidence === null ? null : formatSavedScore(x.confidence, 0, "%")} />)}</tr>
            <tr><th scope="row" className={rowHead}>Passed confidence gate</th>
              {columns.map((c) => <Cell key={c.ticker} column={c} missing="Not saved" value={(x) => x.eligible === null ? null : x.eligible ? "Yes" : "No"} />)}</tr>
            <tr><th scope="row" className={rowHead}>Saved run time</th>
              {columns.map((c) => <Cell key={c.ticker} column={c} missing="No completed run" value={(x) => formatRunTime(x.runDate)} />)}</tr>
          </tbody>
        </table>
        </div>
      </div>

      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5 space-y-4">
        {allRows.length > 0 && (
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <Choice legend="Show" name="compare-filter" options={FILTERS} value={filter} onChange={onFilter} />
            <Choice legend="Order by" name="compare-sort" options={SORTS} value={sort} onChange={onSort} />
          </div>
        )}
        {allRows.length > 0 && notLoaded > 0 && (
          <p role="status" className="text-sm text-sigil-warn">
            {notLoaded} of {columns.length} selected companies {notLoaded === 1 ? "is" : "are"} not loaded.
            Until every company loads, no signal can be confirmed as saved for every company, and each
            difference covers the loaded companies only.
          </p>
        )}
        {/* Outside the scrolling area so it can be read without scrolling sideways. */}
        <p id="compare-signal-scale" className="text-xs text-sigil-muted">
          On a 0–100 scale. Difference is the highest saved value minus the lowest in that row. These
          values are not additive attribution, and a larger difference is not a recommendation.
        </p>
        <div className="overflow-x-auto">
          <table className={tableClass} aria-describedby="compare-signal-scale">
            <caption className={caption}>Saved signal values</caption>
            <thead>
              <tr className="border-b border-sigil-border">
                <th scope="col" className={cornerHead}>Signal</th>
                {columns.map((column) => (
                  <th key={column.ticker} scope="col" className="px-3 py-2 text-left text-base font-bold text-sigil-accent">{column.ticker}</th>
                ))}
                <th scope="col" className="px-3 py-2 text-left text-xs text-sigil-muted font-medium">Difference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sigil-border">
              {rows.map((row) => (
                <tr key={row.signal}>
                  <th scope="row" className={rowHead}>{row.signal}</th>
                  {columns.map((c, i) => <Cell key={c.ticker} column={c} missing="Not saved" value={() => formatPoints(row.values[i])} />)}
                  <td className="px-3 py-2 text-sm font-mono text-sigil-text align-top">
                    {row.spread === null
                      ? <Missing>Needs two saved values</Missing>
                      : formatPoints(row.spread)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 2} className="px-3 py-4 text-sm text-sigil-muted">
                    {allRows.length === 0
                      ? (ready.length === 0
                        ? "No company has loaded yet."
                        : "No saved signal values for the selected companies.")
                      : filter === "shared" && notLoaded > 0
                        ? "No signal can be confirmed as saved for every company until every company has loaded."
                        : "No signals match this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
