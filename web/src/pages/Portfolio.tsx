import { useCallback, useEffect, useState } from "react";

interface PortfolioData {
  account: {
    equity: number;
    cash: number;
    buying_power: number;
    portfolio_value: number;
    is_demo: boolean;
  };
  positions: {
    ticker: string;
    qty: number;
    side: string;
    avg_entry: number;
    current_price: number;
    market_value: number;
    unrealized_pnl: number;
    unrealized_pnl_pct: number;
  }[];
  open_trades: {
    id: number;
    ticker: string;
    side: string;
    shares: number;
    entry_price: number | null;
    opened_at: string;
    signal_drivers: Record<string, number> | null;
    regime_at_entry: string | null;
  }[];
  closed_trades: {
    id: number;
    ticker: string;
    side: string;
    shares: number;
    entry_price: number | null;
    exit_price: number | null;
    realized_pnl: number | null;
    opened_at: string;
    closed_at: string | null;
  }[];
  sector_exposure: Record<string, number>;
  stats: {
    total_trades: number;
    open_count: number;
    closed_count: number;
    total_realized_pnl: number;
    win_rate: number;
  };
}

interface Target {
  ticker: string;
  weight: number;
  shares: number;
  side: string;
  final_score: number;
  confidence: number;
  signal_scores: Record<string, number>;
}

interface TargetsData {
  run_id: string;
  capital: number;
  is_demo: boolean;
  targets: Target[];
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "--";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function PnlText({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-sigil-muted">--</span>;
  const color =
    value > 0
      ? "text-sigil-accent"
      : value < 0
        ? "text-sigil-danger"
        : "text-sigil-muted";
  return (
    <span className={color}>
      {value > 0 ? "+" : ""}${fmt(value)}
    </span>
  );
}

export default function Portfolio() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [targets, setTargets] = useState<TargetsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<string | null>(null);
  const [tab, setTab] = useState<"positions" | "targets" | "history">(
    "positions",
  );

  const fetchPortfolio = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio");
      setData(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPortfolio();
    const interval = setInterval(fetchPortfolio, 30_000);
    return () => clearInterval(interval);
  }, [fetchPortfolio]);

  async function generateTargets() {
    setGenerating(true);
    try {
      const res = await fetch("/api/portfolio/generate-targets", {
        method: "POST",
      });
      setTargets(await res.json());
      setTab("targets");
    } catch {
      /* ignore */
    } finally {
      setGenerating(false);
    }
  }

  async function closeTrade(tradeId: number) {
    try {
      await fetch(`/api/portfolio/close/${tradeId}`, { method: "POST" });
      await fetchPortfolio();
    } catch {}
  }

  async function closeAllTrades() {
    try {
      await fetch("/api/portfolio/close-all", { method: "POST" });
      await fetchPortfolio();
    } catch {}
  }

  async function executeTargets() {
    setExecuting(true);
    setExecResult(null);
    try {
      const res = await fetch("/api/portfolio/execute", { method: "POST" });
      const json = await res.json();
      setExecResult(json.message || "Executed");
      await fetchPortfolio();
      setTab("positions");
    } catch {
      setExecResult("Execution failed");
    } finally {
      setExecuting(false);
    }
  }

  if (loading)
    return <div className="text-sigil-muted">Loading portfolio...</div>;

  const acct = data?.account;
  const stats = data?.stats;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Portfolio</h1>
          <p className="text-sigil-muted text-sm mt-1">
            {acct?.is_demo ? "Demo Mode" : "Paper Trading"} — position sizing
            and trade execution
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={generateTargets}
            disabled={generating}
            className="px-4 py-2 rounded-lg border border-sigil-border text-sm text-sigil-muted
                       hover:border-sigil-accent hover:text-sigil-accent disabled:opacity-50 transition-all"
          >
            {generating ? "Generating..." : "Generate Targets"}
          </button>
        </div>
      </div>

      {execResult && (
        <div className="rounded-xl border border-sigil-accent/30 bg-sigil-accent/10 p-3 text-sm text-sigil-accent flex items-center justify-between">
          <span>{execResult}</span>
          <button
            onClick={() => setExecResult(null)}
            className="text-xs text-sigil-muted hover:text-sigil-text"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Account Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
          <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">
            Equity
          </div>
          <div className="text-2xl font-bold">${fmt(acct?.equity)}</div>
        </div>
        <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
          <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">
            Cash
          </div>
          <div className="text-2xl font-bold">${fmt(acct?.cash)}</div>
        </div>
        <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
          <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">
            Holdings
          </div>
          <div className="text-2xl font-bold">{stats?.open_count ?? 0}</div>
        </div>
        <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
          <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">
            Realized P&L
          </div>
          <div className="text-2xl font-bold">
            <PnlText value={stats?.total_realized_pnl} />
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-sigil-border">
        {(
          [
            ["positions", "Positions"],
            ["targets", "Targets"],
            ["history", "Trade History"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px ${
              tab === key
                ? "border-sigil-accent text-sigil-accent"
                : "border-transparent text-sigil-muted hover:text-sigil-text"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Positions Tab */}
      {tab === "positions" && (
        <div className="space-y-4">
          {/* Live broker positions */}
          {(data?.positions?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-sigil-border bg-sigil-surface overflow-hidden">
              <div className="px-4 py-3 border-b border-sigil-border">
                <span className="text-sm font-semibold">Broker Positions</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-sigil-muted text-xs uppercase border-b border-sigil-border">
                    <th className="text-left px-4 py-2">Ticker</th>
                    <th className="text-right px-4 py-2">Qty</th>
                    <th className="text-right px-4 py-2">Entry</th>
                    <th className="text-right px-4 py-2">Current</th>
                    <th className="text-right px-4 py-2">Value</th>
                    <th className="text-right px-4 py-2">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.positions.map((p) => (
                    <tr
                      key={p.ticker}
                      className="border-b border-sigil-border/50 hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-2.5 font-semibold">{p.ticker}</td>
                      <td className="text-right px-4 py-2.5">{p.qty}</td>
                      <td className="text-right px-4 py-2.5">
                        ${fmt(p.avg_entry)}
                      </td>
                      <td className="text-right px-4 py-2.5">
                        ${fmt(p.current_price)}
                      </td>
                      <td className="text-right px-4 py-2.5">
                        ${fmt(p.market_value)}
                      </td>
                      <td className="text-right px-4 py-2.5">
                        <PnlText value={p.unrealized_pnl} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* DB-tracked open trades */}
          {(data?.open_trades?.length ?? 0) > 0 ? (
            <div className="rounded-xl border border-sigil-border bg-sigil-surface overflow-hidden">
              <div className="px-4 py-3 border-b border-sigil-border flex items-center justify-between">
                <span className="text-sm font-semibold">Open Trades</span>
                <button
                  onClick={closeAllTrades}
                  className="text-xs px-3 py-1 rounded-lg border border-sigil-danger/50 text-sigil-danger hover:bg-sigil-danger/10 transition-colors"
                >
                  Close All
                </button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-sigil-muted text-xs uppercase border-b border-sigil-border">
                    <th className="text-left px-4 py-2">Ticker</th>
                    <th className="text-left px-4 py-2">Side</th>
                    <th className="text-right px-4 py-2">Shares</th>
                    <th className="text-right px-4 py-2">Entry</th>
                    <th className="text-left px-4 py-2">Regime</th>
                    <th className="text-left px-4 py-2">Opened</th>
                    <th className="text-right px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {data?.open_trades.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-sigil-border/50 hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-2.5 font-semibold">{t.ticker}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={
                            t.side === "long"
                              ? "text-sigil-accent"
                              : "text-sigil-danger"
                          }
                        >
                          {t.side}
                        </span>
                      </td>
                      <td className="text-right px-4 py-2.5">{t.shares}</td>
                      <td className="text-right px-4 py-2.5">
                        {t.entry_price ? `$${fmt(t.entry_price)}` : "market"}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {t.regime_at_entry && (
                          <span className="px-2 py-0.5 rounded-full border border-sigil-accent/30 text-sigil-accent bg-sigil-accent/10">
                            {t.regime_at_entry}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-sigil-muted text-xs">
                        {new Date(t.opened_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => closeTrade(t.id)}
                          className="text-xs px-2 py-1 rounded border border-sigil-danger/40 text-sigil-danger hover:bg-sigil-danger/10 transition-colors"
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-sigil-border/50 bg-sigil-surface/50 p-8 text-center">
              <p className="text-sigil-muted text-sm">
                No open positions. Click "Generate Targets" to create portfolio
                targets from the latest pipeline run.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Targets Tab */}
      {tab === "targets" && (
        <div className="space-y-4">
          {targets?.targets && targets.targets.length > 0 ? (
            <>
              <div className="flex items-center justify-between">
                <div className="text-sm text-sigil-muted">
                  {targets.targets.length} targets from ${fmt(targets.capital)}{" "}
                  capital
                  {targets.is_demo && (
                    <span className="ml-2 text-yellow-400 text-xs">
                      (demo prices)
                    </span>
                  )}
                </div>
                <button
                  onClick={executeTargets}
                  disabled={executing}
                  className="px-4 py-2 rounded-lg bg-sigil-accent text-sigil-bg font-semibold text-sm
                             hover:bg-sigil-accent/90 disabled:opacity-50 transition-all"
                >
                  {executing ? "Executing..." : "Execute All"}
                </button>
              </div>

              <div className="rounded-xl border border-sigil-border bg-sigil-surface overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-sigil-muted text-xs uppercase border-b border-sigil-border">
                      <th className="text-left px-4 py-2">Ticker</th>
                      <th className="text-right px-4 py-2">Weight</th>
                      <th className="text-right px-4 py-2">Shares</th>
                      <th className="text-right px-4 py-2">Score</th>
                      <th className="text-right px-4 py-2">Confidence</th>
                      <th className="text-left px-4 py-2">Top Signals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targets.targets.map((t) => {
                      const topSignals = Object.entries(t.signal_scores)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 3);
                      return (
                        <tr
                          key={t.ticker}
                          className="border-b border-sigil-border/50 hover:bg-white/[0.02]"
                        >
                          <td className="px-4 py-2.5 font-semibold">
                            {t.ticker}
                          </td>
                          <td className="text-right px-4 py-2.5">
                            {(t.weight * 100).toFixed(1)}%
                          </td>
                          <td className="text-right px-4 py-2.5">{t.shares}</td>
                          <td className="text-right px-4 py-2.5 text-sigil-accent">
                            {t.final_score.toFixed(4)}
                          </td>
                          <td className="text-right px-4 py-2.5">
                            {(t.confidence * 100).toFixed(0)}%
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex gap-2">
                              {topSignals.map(([name, score]) => (
                                <span
                                  key={name}
                                  className="text-[10px] text-sigil-muted bg-sigil-bg px-1.5 py-0.5 rounded"
                                >
                                  {name}: {(score as number).toFixed(2)}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Weight distribution bar */}
              <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
                <div className="text-xs font-semibold text-sigil-muted uppercase tracking-wider mb-3">
                  Weight Distribution
                </div>
                <div className="space-y-2">
                  {targets.targets.map((t) => (
                    <div key={t.ticker} className="flex items-center gap-3">
                      <span className="text-xs font-mono w-12 text-right">
                        {t.ticker}
                      </span>
                      <div className="flex-1 bg-sigil-bg rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-sigil-accent h-full rounded-full transition-all"
                          style={{ width: `${t.weight * 100 * 5}%` }}
                        />
                      </div>
                      <span className="text-xs text-sigil-muted w-12 text-right">
                        {(t.weight * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-sigil-border/50 bg-sigil-surface/50 p-8 text-center">
              <p className="text-sigil-muted text-sm">
                No targets generated yet. Click "Generate Targets" to build
                portfolio allocations from the latest pipeline scores.
              </p>
            </div>
          )}
        </div>
      )}

      {/* History Tab */}
      {tab === "history" && (
        <div className="space-y-4">
          {(data?.closed_trades?.length ?? 0) > 0 ? (
            <>
              <div className="flex items-center gap-4 text-sm text-sigil-muted">
                <span>{stats?.closed_count} closed trades</span>
                <span>
                  Win rate: {((stats?.win_rate ?? 0) * 100).toFixed(0)}%
                </span>
                <span>
                  Total P&L: <PnlText value={stats?.total_realized_pnl} />
                </span>
              </div>
              <div className="rounded-xl border border-sigil-border bg-sigil-surface overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-sigil-muted text-xs uppercase border-b border-sigil-border">
                      <th className="text-left px-4 py-2">Ticker</th>
                      <th className="text-left px-4 py-2">Side</th>
                      <th className="text-right px-4 py-2">Shares</th>
                      <th className="text-right px-4 py-2">Entry</th>
                      <th className="text-right px-4 py-2">Exit</th>
                      <th className="text-right px-4 py-2">P&L</th>
                      <th className="text-left px-4 py-2">Closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.closed_trades.map((t) => (
                      <tr
                        key={t.id}
                        className="border-b border-sigil-border/50 hover:bg-white/[0.02]"
                      >
                        <td className="px-4 py-2.5 font-semibold">
                          {t.ticker}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={
                              t.side === "long"
                                ? "text-sigil-accent"
                                : "text-sigil-danger"
                            }
                          >
                            {t.side}
                          </span>
                        </td>
                        <td className="text-right px-4 py-2.5">{t.shares}</td>
                        <td className="text-right px-4 py-2.5">
                          {t.entry_price ? `$${fmt(t.entry_price)}` : "--"}
                        </td>
                        <td className="text-right px-4 py-2.5">
                          {t.exit_price ? `$${fmt(t.exit_price)}` : "--"}
                        </td>
                        <td className="text-right px-4 py-2.5">
                          <PnlText value={t.realized_pnl} />
                        </td>
                        <td className="px-4 py-2.5 text-sigil-muted text-xs">
                          {t.closed_at
                            ? new Date(t.closed_at).toLocaleDateString()
                            : "--"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-sigil-border/50 bg-sigil-surface/50 p-8 text-center">
              <p className="text-sigil-muted text-sm">
                No closed trades yet. Execute some targets and they'll appear
                here once closed.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
