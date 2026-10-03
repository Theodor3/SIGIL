import { useEffect, useState } from "react";
import { useDashboard } from "../hooks/useDashboard";

interface Coverage {
  snapshots: number;
  first: string | null;
  last: string | null;
}

interface HorizonResult {
  n: number;
  hit_rate?: number | null;
  avg_alpha?: number | null;
  estimated_net_alpha?: number | null;
  eligible_calls?: number;
  skipped_stock_window?: number;
  skipped_benchmark_window?: number;
  long_calls?: number;
  short_calls?: number;
  long_hit_rate?: number | null;
  short_hit_rate?: number | null;
}

interface BacktestResult {
  signal?: string;
  version?: string;
  snapshots_usable?: number;
  snapshots_replayed?: number;
  total_calls?: number;
  date_range?: [string, string];
  horizons?: Record<string, HorizonResult>;
  note?: string;
  error?: string;
  methodology?: { round_trip_cost_bps: number | null };
}

export default function Lab() {
  const { data } = useDashboard();
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [selected, setSelected] = useState("");
  const [costBps, setCostBps] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);

  useEffect(() => {
    fetch("/api/research/backtest-coverage")
      .then((r) => r.json())
      .then(setCoverage)
      .catch(() => {});
  }, []);

  const signals = (data?.signals || []).map((s: any) => s.name).sort();

  async function runBacktest() {
    if (!selected) return;
    setRunning(true);
    setResult(null);
    try {
      const cost = costBps.trim();
      if (cost && (!Number.isFinite(Number(cost)) || Number(cost) < 0)) {
        setResult({ error: "Enter a nonnegative round-trip cost, or leave it blank." });
        return;
      }
      const res = await fetch(`/api/research/backtest/${selected}?horizons=5,20,60${cost ? `&round_trip_cost_bps=${encodeURIComponent(cost)}` : ""}`);
      setResult(await res.json());
    } catch {
      setResult({ error: "request failed" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Signal Lab</h1>
      <p className="text-sigil-muted text-sm max-w-2xl">
        Replay a signal over recorded pipeline history and compare its calls
        with SPY over matching dates. Horizons use calendar days. Date-only
        snapshots do not prove that prices were available when a signal formed,
        and overlapping calls are not independent evidence. These results screen
        hypotheses; they do not establish portfolio performance.
      </p>

      {/* Coverage */}
      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-3">
          Recorded History
        </h2>
        {coverage ? (
          coverage.snapshots > 0 ? (
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-2xl font-bold text-sigil-accent">
                  {coverage.snapshots}
                </span>
                <span className="text-sigil-muted ml-2">
                  daily snapshot{coverage.snapshots === 1 ? "" : "s"}
                </span>
              </div>
              <div className="text-sigil-muted self-center">
                {coverage.first} → {coverage.last}
              </div>
              <div className="text-sigil-muted self-center text-xs">
                one snapshot lands per pipeline run; horizons become gradable
                once snapshots are older than them
              </div>
            </div>
          ) : (
            <p className="text-sigil-muted text-sm">
              No snapshots recorded yet — the next pipeline run archives the
              first one.
            </p>
          )
        ) : (
          <p className="text-sigil-muted text-sm">Loading…</p>
        )}
      </div>

      {/* Run a backtest */}
      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-3">
          Run a Backtest
        </h2>
        <div className="flex flex-wrap gap-3 items-center">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="bg-sigil-bg border border-sigil-border rounded-lg px-3 py-2 text-sm text-sigil-text"
          >
            <option value="">Select a signal…</option>
            {signals.map((name: string) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <label className="text-xs text-sigil-muted">
            Assumed round-trip cost (bps)
            <input
              type="number" min="0" step="any" value={costBps}
              onChange={(e) => setCostBps(e.target.value)}
              placeholder="Not specified"
              className="block bg-sigil-bg border border-sigil-border rounded-lg px-3 py-2 text-sm text-sigil-text"
            />
          </label>
          <button
            onClick={runBacktest}
            disabled={!selected || running}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-sigil-accent/20 border border-sigil-accent/40 text-sigil-accent hover:bg-sigil-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {running ? "Replaying…" : "Run backtest"}
          </button>
          {running && (
            <span className="text-xs text-sigil-muted">
              replaying snapshots and downloading grading prices…
            </span>
          )}
        </div>
        <p className="text-xs text-sigil-muted mt-2">
          1 bp = 0.01%. Include your assumed fees, spread, slippage and borrow
          costs. A flat cost per forecast does not model portfolio turnover.
        </p>

        {result && (
          <div className="mt-4 space-y-3">
            {result.error && (
              <div className="text-sigil-danger text-sm">{result.error}</div>
            )}
            {result.note && (
              <div className="rounded-lg bg-sigil-bg border border-sigil-border/50 p-3 text-sm text-sigil-muted">
                {result.note}
              </div>
            )}
            {result.signal && !result.error && (
              <div className="text-sm text-sigil-muted">
                <span className="text-sigil-accent font-semibold">
                  {result.signal}
                </span>{" "}
                v{result.version}
                {result.date_range && (
                  <> · {result.date_range[0]} → {result.date_range[1]}</>
                )}
                {result.snapshots_replayed != null && (
                  <> · {result.snapshots_replayed} snapshots</>
                )}
                {result.total_calls != null && (
                  <> · {result.total_calls} calls</>
                )}
              </div>
            )}
            {result.horizons && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {Object.entries(result.horizons).map(([h, r]) => (
                  <div
                    key={h}
                    className="rounded-lg bg-sigil-bg border border-sigil-border/30 p-3"
                  >
                    <div className="text-sigil-muted text-[10px] uppercase mb-1">
                      {h} calendar horizon
                    </div>
                    {r.n > 0 ? (
                      <>
                        <div
                          className={`text-lg font-bold ${(r.hit_rate ?? 0) >= 0.5 ? "text-sigil-accent" : "text-sigil-danger"}`}
                        >
                          {r.hit_rate == null ? "Hit rate unavailable" : `${(r.hit_rate * 100).toFixed(1)}% hit`}
                        </div>
                        <div
                          className={`text-sm font-mono ${(r.avg_alpha ?? 0) >= 0 ? "text-sigil-accent" : "text-sigil-danger"}`}
                        >
                          {r.avg_alpha == null ? "Gross alpha unavailable" : `${(r.avg_alpha * 100).toFixed(2)}% gross α`} · n={r.n}
                        </div>
                        <div className="text-xs text-sigil-muted">
                          {r.estimated_net_alpha == null
                            ? "Net estimate unavailable — no cost assumption"
                            : `${(r.estimated_net_alpha * 100).toFixed(2)}% estimated net α (${result.methodology?.round_trip_cost_bps} bps assumed)`}
                        </div>
                        <div className="text-[11px] text-sigil-muted mt-1">
                          {r.long_calls ?? 0} long
                          {r.long_hit_rate != null &&
                            ` (${(r.long_hit_rate * 100).toFixed(0)}%)`}{" "}
                          · {r.short_calls ?? 0} short
                          {r.short_hit_rate != null &&
                            ` (${(r.short_hit_rate * 100).toFixed(0)}%)`}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-sigil-muted">
                        No SPY-matched calls; alpha unavailable.
                      </div>
                    )}
                    <div className="text-[11px] text-sigil-muted mt-2">
                      {r.eligible_calls ?? r.n} eligible · {r.skipped_stock_window ?? 0} missing stock windows · {r.skipped_benchmark_window ?? 0} unmatched benchmark windows
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* How a signal earns weight */}
      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-3">
          How a New Signal Earns Weight
        </h2>
        <div className="text-sm text-sigil-muted space-y-1">
          <p>1. Write it — copy <code className="text-sigil-accent bg-sigil-bg px-1 rounded">api/signals/template.py</code>; the registry auto-discovers it with zero weight</p>
          <p>2. Backtest it here — it must clear the promotion gates on recorded history</p>
          <p>3. Let it trade on paper — forward evaluations must confirm the backtest</p>
          <p>4. Only then does it get a budget in <code className="text-sigil-accent bg-sigil-bg px-1 rounded">alpha_model.json</code></p>
        </div>
      </div>
    </div>
  );
}
