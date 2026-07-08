import { useCallback, useEffect, useState } from "react";

import EquityCurve from "../components/EquityCurve";

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
    account_pnl?: number;
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

interface RebalanceOrder {
  ticker: string;
  shares: number;
  reason: string;
  current_pct: number;
  target_pct: number;
  delta_pct: number;
}

interface RebalancePlan {
  sells: RebalanceOrder[];
  buys: RebalanceOrder[];
  skipped: { ticker: string; current_pct: number; target_pct: number; delta_pct: number }[];
  total_sell_value: number;
  total_buy_value: number;
  net_cash_change: number;
  positions_before: number;
  positions_after: number;
  total_orders: number;
}

interface RebalancePreview {
  run_id: string;
  regime_id: string;
  exposure_target: number;
  portfolio_value: number;
  cash: number;
  is_demo: boolean;
  plan: RebalancePlan;
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
  const [rebalance, setRebalance] = useState<RebalancePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [rebalancing, setRebalancing] = useState(false);
  const [execResult, setExecResult] = useState<string | null>(null);
  const [tab, setTab] = useState<"positions" | "targets" | "rebalance" | "history">(
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

  async function previewRebalance() {
    setPreviewing(true);
    try {
      const res = await fetch("/api/portfolio/rebalance/preview", { method: "POST" });
      setRebalance(await res.json());
      setTab("rebalance");
    } catch {
      /* ignore */
    } finally {
      setPreviewing(false);
    }
  }

  async function executeRebalance() {
    setRebalancing(true);
    setExecResult(null);
    try {
      const res = await fetch("/api/portfolio/rebalance/execute", { method: "POST" });
      const json = await res.json();
      setExecResult(json.message || "Rebalanced");
      setRebalance(null);
      await fetchPortfolio();
      setTab("positions");
    } catch {
      setExecResult("Rebalance failed");
    } finally {
      setRebalancing(false);
    }
  }

  if (loading)
    return <div className="text-sigil-muted">Loading portfolio...</div>;

  const acct = data?.account;
  const stats = data?.stats;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Portfolio</h1>
          <p className="text-sigil-muted text-sm mt-1">
            {acct?.is_demo ? "Demo Mode" : "Paper Trading"} — position sizing
            and trade execution
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={previewRebalance}
            disabled={previewing}
            className="px-3 sm:px-4 py-2 rounded-lg bg-sigil-accent text-sigil-bg font-semibold text-xs sm:text-sm
                       hover:bg-sigil-accent/90 disabled:opacity-50 transition-all"
          >
            {previewing ? "Loading..." : "Rebalance"}
          </button>
          <button
            onClick={generateTargets}
            disabled={generating}
            className="px-3 sm:px-4 py-2 rounded-lg border border-sigil-border text-xs sm:text-sm text-sigil-muted
                       hover:border-sigil-accent hover:text-sigil-accent disabled:opacity-50 transition-all"
          >
            {generating ? "Generating..." : "Targets"}
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
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
            Total P&L
          </div>
          <div className="text-2xl font-bold">
            <PnlText value={stats?.account_pnl ?? stats?.total_realized_pnl} />
          </div>
          <div className="text-xs text-sigil-muted mt-1">
            realized <PnlText value={stats?.total_realized_pnl} />
          </div>
        </div>
      </div>

      <EquityCurve />

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-sigil-border overflow-x-auto">
        {(
          [
            ["positions", "Positions"],
            ["rebalance", "Rebalance"],
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
            <div className="rounded-xl border border-sigil-border bg-sigil-surface overflow-hidden overflow-x-auto">
              <div className="px-4 py-3 border-b border-sigil-border">
                <span className="text-sm font-semibold">Broker Positions</span>
              </div>
              <table className="w-full text-sm min-w-[500px]">
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
            <div className="rounded-xl border border-sigil-border bg-sigil-surface overflow-hidden overflow-x-auto">
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

      {/* Rebalance Tab */}
      {tab === "rebalance" && (
        <div className="space-y-4">
          {rebalance?.plan ? (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
                  <div className="text-sigil-muted text-[10px] uppercase tracking-wider mb-1">Regime</div>
                  <div className="text-sm font-semibold">
                    <span className="px-2 py-0.5 rounded-full border border-sigil-accent/30 text-sigil-accent bg-sigil-accent/10">
                      {rebalance.regime_id}
                    </span>
                  </div>
                </div>
                <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
                  <div className="text-sigil-muted text-[10px] uppercase tracking-wider mb-1">Exposure Target</div>
                  <div className="text-sm font-bold">{(rebalance.exposure_target * 100).toFixed(0)}%</div>
                </div>
                <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
                  <div className="text-sigil-muted text-[10px] uppercase tracking-wider mb-1">Total Orders</div>
                  <div className="text-sm font-bold">{rebalance.plan.total_orders}</div>
                </div>
                <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
                  <div className="text-sigil-muted text-[10px] uppercase tracking-wider mb-1">Positions</div>
                  <div className="text-sm font-bold">{rebalance.plan.positions_before} → {rebalance.plan.positions_after}</div>
                </div>
                <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
                  <div className="text-sigil-muted text-[10px] uppercase tracking-wider mb-1">Net Cash</div>
                  <div className={`text-sm font-bold ${rebalance.plan.net_cash_change > 0 ? "text-sigil-accent" : rebalance.plan.net_cash_change < 0 ? "text-sigil-danger" : ""}`}>
                    {rebalance.plan.net_cash_change > 0 ? "+" : ""}${fmt(rebalance.plan.net_cash_change)}
                  </div>
                </div>
              </div>

              {/* Sells */}
              {rebalance.plan.sells.length > 0 && (
                <div className="rounded-xl border border-sigil-danger/30 bg-sigil-surface overflow-hidden overflow-x-auto">
                  <div className="px-4 py-3 border-b border-sigil-border flex items-center gap-2">
                    <span className="text-sm font-semibold text-sigil-danger">Sells</span>
                    <span className="text-xs text-sigil-muted">
                      {rebalance.plan.sells.length} orders · ${fmt(rebalance.plan.total_sell_value)}
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-sigil-muted text-xs uppercase border-b border-sigil-border">
                        <th className="text-left px-4 py-2">Ticker</th>
                        <th className="text-left px-4 py-2">Reason</th>
                        <th className="text-right px-4 py-2">Shares</th>
                        <th className="text-right px-4 py-2">Current %</th>
                        <th className="text-right px-4 py-2">Target %</th>
                        <th className="text-right px-4 py-2">Delta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rebalance.plan.sells.map((o) => (
                        <tr key={o.ticker} className="border-b border-sigil-border/50 hover:bg-white/[0.02]">
                          <td className="px-4 py-2.5 font-semibold">{o.ticker}</td>
                          <td className="px-4 py-2.5">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              o.reason === "exit"
                                ? "bg-sigil-danger/10 text-sigil-danger border border-sigil-danger/30"
                                : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30"
                            }`}>
                              {o.reason}
                            </span>
                          </td>
                          <td className="text-right px-4 py-2.5">{o.shares}</td>
                          <td className="text-right px-4 py-2.5">{o.current_pct.toFixed(1)}%</td>
                          <td className="text-right px-4 py-2.5">{o.target_pct.toFixed(1)}%</td>
                          <td className="text-right px-4 py-2.5 text-sigil-danger">{o.delta_pct.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Buys */}
              {rebalance.plan.buys.length > 0 && (
                <div className="rounded-xl border border-sigil-accent/30 bg-sigil-surface overflow-hidden overflow-x-auto">
                  <div className="px-4 py-3 border-b border-sigil-border flex items-center gap-2">
                    <span className="text-sm font-semibold text-sigil-accent">Buys</span>
                    <span className="text-xs text-sigil-muted">
                      {rebalance.plan.buys.length} orders · ${fmt(rebalance.plan.total_buy_value)}
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-sigil-muted text-xs uppercase border-b border-sigil-border">
                        <th className="text-left px-4 py-2">Ticker</th>
                        <th className="text-left px-4 py-2">Reason</th>
                        <th className="text-right px-4 py-2">Shares</th>
                        <th className="text-right px-4 py-2">Current %</th>
                        <th className="text-right px-4 py-2">Target %</th>
                        <th className="text-right px-4 py-2">Delta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rebalance.plan.buys.map((o) => (
                        <tr key={o.ticker} className="border-b border-sigil-border/50 hover:bg-white/[0.02]">
                          <td className="px-4 py-2.5 font-semibold">{o.ticker}</td>
                          <td className="px-4 py-2.5">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              o.reason === "new"
                                ? "bg-sigil-accent/10 text-sigil-accent border border-sigil-accent/30"
                                : "bg-blue-500/10 text-blue-400 border border-blue-500/30"
                            }`}>
                              {o.reason}
                            </span>
                          </td>
                          <td className="text-right px-4 py-2.5">{o.shares}</td>
                          <td className="text-right px-4 py-2.5">{o.current_pct.toFixed(1)}%</td>
                          <td className="text-right px-4 py-2.5">{o.target_pct.toFixed(1)}%</td>
                          <td className="text-right px-4 py-2.5 text-sigil-accent">+{o.delta_pct.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Skipped */}
              {rebalance.plan.skipped.length > 0 && (
                <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
                  <div className="text-xs font-semibold text-sigil-muted uppercase tracking-wider mb-2">
                    Within Tolerance ({rebalance.plan.skipped.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {rebalance.plan.skipped.map((s) => (
                      <span key={s.ticker} className="text-xs text-sigil-muted bg-sigil-bg px-2 py-1 rounded">
                        {s.ticker} ({s.current_pct.toFixed(1)}% → {s.target_pct.toFixed(1)}%)
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Execute button */}
              {rebalance.plan.total_orders > 0 && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-sigil-accent/30 bg-sigil-accent/5 p-4">
                  <div className="text-sm">
                    <span className="font-semibold">{rebalance.plan.total_orders} orders</span>
                    <span className="text-sigil-muted ml-2">
                      sell ${fmt(rebalance.plan.total_sell_value)} · buy ${fmt(rebalance.plan.total_buy_value)}
                    </span>
                    {rebalance.is_demo && <span className="ml-2 text-yellow-400 text-xs">(demo)</span>}
                  </div>
                  <button
                    onClick={executeRebalance}
                    disabled={rebalancing}
                    className="px-6 py-2 rounded-lg bg-sigil-accent text-sigil-bg font-semibold text-sm
                               hover:bg-sigil-accent/90 disabled:opacity-50 transition-all"
                  >
                    {rebalancing ? "Executing..." : "Execute Rebalance"}
                  </button>
                </div>
              )}

              {rebalance.plan.total_orders === 0 && (
                <div className="rounded-xl border border-sigil-accent/30 bg-sigil-accent/5 p-4 text-center text-sm text-sigil-accent">
                  Portfolio is already aligned with targets — no trades needed.
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-sigil-border/50 bg-sigil-surface/50 p-8 text-center">
              <p className="text-sigil-muted text-sm">
                Click "Rebalance Preview" to see what trades are needed to align your portfolio with the latest signal scores.
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
