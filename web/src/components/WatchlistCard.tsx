import { useCallback, useEffect, useState } from "react";

interface WatchlistEntry {
  ticker: string;
  added_at: string;
  note: string | null;
}

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export default function WatchlistCard({
  onSelect,
}: {
  onSelect: (ticker: string) => void;
}) {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      const json = await res.json();
      setEntries(json.tickers ?? []);
    } catch {
      /* card degrades to empty; pipeline is unaffected */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(async () => {
    const ticker = input.trim().toUpperCase();
    if (!ticker || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      const json = await res.json();
      setMessage(json.message ?? json.error ?? "Done");
      setInput("");
      await refresh();
    } catch {
      setMessage("Request failed");
    } finally {
      setBusy(false);
    }
  }, [input, busy, refresh]);

  const remove = useCallback(
    async (ticker: string) => {
      setMessage(null);
      try {
        const res = await fetch(`/api/watchlist/${ticker}`, { method: "DELETE" });
        const json = await res.json();
        setMessage(json.message ?? json.error ?? "Done");
        await refresh();
      } catch {
        setMessage("Request failed");
      }
    },
    [refresh],
  );

  return (
    <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="text-sigil-muted text-xs uppercase tracking-wider">
          Watchlist
        </div>
        <span className="text-xs text-sigil-muted">
          {entries.length > 0 ? entries.length : ""}
        </span>
        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-sigil-border text-sigil-muted">
          research-only — never traded
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="text-sm text-sigil-muted mb-3">
          No watchlist tickers. Add one to force it through every signal on
          the next pipeline run.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mb-3">
          {entries.map((e) => (
            <span
              key={e.ticker}
              className="group inline-flex items-center gap-1.5 rounded-lg border border-sigil-border
                         bg-sigil-bg px-2.5 py-1.5 text-sm"
              title={`${e.note ? e.note + " · " : ""}added ${daysAgo(e.added_at)}`}
            >
              <button
                onClick={() => onSelect(e.ticker)}
                className="font-semibold text-sigil-text hover:text-sigil-accent transition-colors"
              >
                {e.ticker}
              </button>
              <button
                onClick={() => remove(e.ticker)}
                aria-label={`Remove ${e.ticker}`}
                className="text-sigil-muted hover:text-sigil-danger transition-colors text-xs px-0.5"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add ticker"
          className="w-36 px-3 py-1.5 bg-sigil-bg border border-sigil-border rounded-lg text-sm
                     text-sigil-text placeholder-sigil-muted focus:outline-none focus:border-sigil-accent"
        />
        <button
          onClick={add}
          disabled={busy || !input.trim()}
          className="px-4 py-1.5 rounded-lg bg-sigil-accent/15 text-sigil-accent text-sm font-medium
                     hover:bg-sigil-accent/25 disabled:opacity-40 transition-all"
        >
          {busy ? "Adding..." : "Add"}
        </button>
        {message && (
          <span className="self-center text-xs text-sigil-muted">{message}</span>
        )}
      </div>
    </div>
  );
}
