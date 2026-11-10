import { useEffect, useId, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import CompareView from "../components/CompareView";
import {
  MAX_COMPARE, compareReducer, createColumnLoader, emptyCompareState, parseTickerList,
  type ColumnLoader, type SignalFilter, type SignalSort,
} from "../lib/companyCompare";

const list = (items: string[]) => items.join(", ");

/**
 * Side-by-side company comparison. The selected tickers live in the URL
 * (?t=AAPL,MSFT) so a comparison can be bookmarked; nothing is stored in the
 * browser and nothing is sent anywhere except the existing research endpoint.
 */
export default function Compare() {
  const [params, setParams] = useSearchParams();
  const fromUrl = useMemo(() => parseTickerList(params.get("t") ?? ""), [params]);
  const selected = fromUrl.tickers;
  const selectedKey = selected.join(",");

  const [state, dispatch] = useReducer(compareReducer, selected, (tickers) =>
    compareReducer(emptyCompareState, { type: "set", tickers }));
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<SignalFilter>("all");
  const [sort, setSort] = useState<SignalSort>("spread");
  const inputId = useId();
  const helpId = useId();

  useEffect(() => {
    dispatch({ type: "set", tickers: selectedKey ? selectedKey.split(",") : [] });
  }, [selectedKey]);

  // The loader owns every in-flight request; disposing it on cleanup means no
  // response can land after unmount (or after Strict Mode's discarded first mount).
  const loader = useRef<ColumnLoader | null>(null);
  useEffect(() => {
    const created = createColumnLoader(
      (url, init) => fetch(url, init),
      (ticker, result) => dispatch({ type: "resolved", ticker, result }),
    );
    loader.current = created;
    return () => {
      created.dispose();
      loader.current = null;
    };
  }, []);
  useEffect(() => {
    loader.current?.sync(state.columns);
  }, [state]);

  const writeTickers = (tickers: string[]) => {
    const next = new URLSearchParams(params);
    if (tickers.length) next.set("t", tickers.join(","));
    else next.delete("t");
    setParams(next);
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    const merged = parseTickerList(`${selectedKey} ${draft}`);
    const added = merged.tickers.filter((t) => !selected.includes(t));
    const problems: string[] = [];
    if (merged.rejected.length) problems.push(`Not a ticker symbol: ${list(merged.rejected)}.`);
    if (merged.overLimit.length) {
      problems.push(`Only ${MAX_COMPARE} companies fit side by side; left out ${list(merged.overLimit)}.`);
    }
    if (!added.length && !problems.length) {
      problems.push(draft.trim() ? "Already in the comparison." : "Enter a ticker symbol.");
    }
    setNotice(problems.length ? problems.join(" ") : null);
    if (added.length) {
      writeTickers(merged.tickers);
      setDraft("");
    }
  };

  const full = selected.length >= MAX_COMPARE;
  const urlProblems = [
    fromUrl.rejected.length ? `Ignored from the link: ${list(fromUrl.rejected)}.` : null,
    fromUrl.overLimit.length ? `The link listed more than ${MAX_COMPARE} companies; left out ${list(fromUrl.overLimit)}.` : null,
  ].filter(Boolean).join(" ");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Compare companies</h1>
        <p className="text-sm text-sigil-muted mt-1">
          Line up two to {MAX_COMPARE} companies using what Sigil already has for each. Missing values stay missing.
        </p>
      </div>

      <form onSubmit={add} className="flex flex-wrap gap-3 items-end" noValidate>
        <div className="flex-1 min-w-[14rem]">
          <label htmlFor={inputId} className="block text-xs font-semibold uppercase tracking-wider text-sigil-muted mb-1">
            Add tickers
          </label>
          <input
            id={inputId} type="text" value={draft} disabled={full}
            onChange={(e) => setDraft(e.target.value)}
            aria-describedby={helpId} autoComplete="off" autoCapitalize="characters" spellCheck={false}
            placeholder={full ? "Remove a company to add another" : "e.g. AAPL, MSFT"}
            className="w-full px-4 py-2.5 bg-sigil-surface border border-sigil-border rounded-lg text-sigil-text placeholder-sigil-muted focus:outline-none focus:border-sigil-accent disabled:opacity-50"
          />
        </div>
        <button
          type="submit" disabled={full}
          className="px-6 py-2.5 bg-sigil-accent text-sigil-bg rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          Add
        </button>
        {selected.length > 0 && (
          <button
            type="button" onClick={() => { writeTickers([]); setNotice(null); }}
            className="px-4 py-2.5 border border-sigil-border rounded-lg text-sm text-sigil-muted hover:text-sigil-text focus:outline-none focus:border-sigil-accent"
          >
            Clear all
          </button>
        )}
        <p id={helpId} className="basis-full text-xs text-sigil-muted">
          Separate symbols with commas or spaces. {selected.length} of {MAX_COMPARE} selected.
        </p>
      </form>

      {notice && <p role="alert" className="text-sm text-sigil-warn">{notice}</p>}
      {urlProblems && <p role="status" className="text-sm text-sigil-warn">{urlProblems}</p>}

      <CompareView
        state={state} filter={filter} sort={sort} onFilter={setFilter} onSort={setSort}
        onRemove={(ticker) => { writeTickers(selected.filter((t) => t !== ticker)); setNotice(null); }}
        onRetry={(ticker) => dispatch({ type: "retry", ticker })}
      />

      <section aria-labelledby={`${helpId}-sources`} className="text-xs text-sigil-muted space-y-1 border-t border-sigil-border pt-4">
        <h2 id={`${helpId}-sources`} className="font-semibold uppercase tracking-wider">Where these values come from</h2>
        <p>
          Saved score, confidence, gate result and signal values are read from the latest completed
          pipeline run at the moment each company loads; the run time is shown per company.
        </p>
        <p>
          Company facts (sector, industry, market cap, price, 52-week range) are requested by the Sigil
          backend from Yahoo Finance when the company loads and may be up to ten minutes old. They are
          current values, not the values at the time of the saved run.
        </p>
        <p>
          Position in the 52-week range and the Difference column are computed in your browser from the
          numbers shown. Trade history and account data are not shown on this page.
        </p>
      </section>
    </div>
  );
}
