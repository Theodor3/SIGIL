import { useCallback, useEffect, useState } from "react";

interface TradeRow {
  id: number;
  ticker: string;
  side: string;
  shares: number;
  entry_price: number | null;
  exit_price: number | null;
  realized_pnl: number | null;
  opened_at: string;
  closed_at: string | null;
  status: string;
}

interface PipelineRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  regime_id: string | null;
  universe_size: number;
}

interface SignalStat {
  name: string;
  weight: number;
  prediction_count: number;
  eval_stats: {
    hit_rate_5d?: number;
    hit_rate_20d?: number;
    hit_rate_60d?: number;
    avg_alpha_5d?: number;
    avg_alpha_20d?: number;
    avg_alpha_60d?: number;
    total_evaluated?: number;
  };
}

const API = "";

export default function Backtest() {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [signals, setSignals] = useState<SignalStat[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [portRes, dashRes] = await Promise.all([
        fetch(`${API}/api/portfolio`),
        fetch(`${API}/api/dashboard-data`),
      ]);
      const portData = await portRes.json();
      const dashData = await dashRes.json();

      const allTrades = [
        ...(portData.closed_trades || []).map((t: TradeRow) => ({ ...t, status: "closed" })),
        ...(portData.open_trades || []).map((t: TradeRow) => ({ ...t, status: "open" })),
      ];
      allTrades.sort((a: TradeRow, b: TradeRow) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime());
      setTrades(allTrades);
      setRuns(dashData.recent_runs || []);
      setSignals(dashData.signals || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const closedTrades = trades.filter((t) => t.status === "closed");
  const totalPnl = closedTrades.reduce((s, t) => s + (t.realized_pnl || 0), 0);
  const winCount = closedTrades.filter((t) => (t.realized_pnl || 0) > 0).length;
  const winRate = closedTrades.length > 0 ? (winCount / closedTrades.length) * 100 : 0;
  const avgWin = winCount > 0
    ? closedTrades.filter((t) => (t.realized_pnl || 0) > 0).reduce((s, t) => s + (t.realized_pnl || 0), 0) / winCount
    : 0;
  const lossCount = closedTrades.filter((t) => (t.realized_pnl || 0) < 0).length;
  const avgLoss = lossCount > 0
    ? closedTrades.filter((t) => (t.realized_pnl || 0) < 0).reduce((s, t) => s + (t.realized_pnl || 0), 0) / lossCount
    : 0;
  const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;

  // Cumulative P&L for equity curve
  const sortedClosed = [...closedTrades].sort(
    (a, b) => new Date(a.closed_at || a.opened_at).getTime() - new Date(b.closed_at || b.opened_at).getTime()
  );
  let cumPnl = 0;
  const equityCurve = sortedClosed.map((t) => {
    cumPnl += t.realized_pnl || 0;
    return { date: t.closed_at || t.opened_at, pnl: cumPnl, ticker: t.ticker };
  });

  // Drawdown
  let peak = 0;
  let maxDrawdown = 0;
  for (const pt of equityCurve) {
    if (pt.pnl > peak) peak = pt.pnl;
    const dd = peak - pt.pnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // P&L by ticker
  const byTicker: Record<string, { pnl: number; count: number; wins: number }> = {};
  for (const t of closedTrades) {
    if (!byTicker[t.ticker]) byTicker[t.ticker] = { pnl: 0, count: 0, wins: 0 };
    byTicker[t.ticker].pnl += t.realized_pnl || 0;
    byTicker[t.ticker].count++;
    if ((t.realized_pnl || 0) > 0) byTicker[t.ticker].wins++;
  }
  const tickerStats = Object.entries(byTicker)
    .map(([ticker, s]) => ({ ticker, ...s, winRate: (s.wins / s.count) * 100 }))
    .sort((a, b) => b.pnl - a.pnl);

  if (loading) return <div className="text-sigil-muted">Loading backtest data...</div>;

  const hasData = closedTrades.length > 0 || signals.some((s) => s.eval_stats.total_evaluated);
  const maxCurve = equityCurve.length > 0 ? Math.max(...equityCurve.map((p) => Math.abs(p.pnl)), 1) : 1;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Backtest & Performance</h1>

      {!hasData ? (
        <div className="rounded-xl border border-sigil-border bg-sigil-surface p-8 text-center">
          <p className="text-sigil-muted mb-2">No performance data yet.</p>
          <p className="text-sigil-muted text-sm">
            Execute trades from the Portfolio tab and let the evaluator grade signal predictions
            over 5/20/60 day horizons to see performance metrics here.
          </p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4">
            <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
              <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">Total P&L</div>
              <div className={`text-2xl font-bold font-mono ${totalPnl >= 0 ? "text-sigil-accent" : "text-sigil-danger"}`}>
                ${totalPnl.toFixed(2)}
              </div>
              <div className="text-sigil-muted text-xs mt-1">{closedTrades.length} closed trades</div>
            </div>
            <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
              <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">Win Rate</div>
              <div className="text-2xl font-bold font-mono text-sigil-text">{winRate.toFixed(1)}%</div>
              <div className="text-sigil-muted text-xs mt-1">{winCount}W / {lossCount}L</div>
            </div>
            <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
              <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">Profit Factor</div>
              <div className="text-2xl font-bold font-mono text-sigil-text">
                {profitFactor > 0 ? profitFactor.toFixed(2) : "—"}
              </div>
              <div className="text-sigil-muted text-xs mt-1">avg win / avg loss</div>
            </div>
            <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
              <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">Max Drawdown</div>
              <div className="text-2xl font-bold font-mono text-sigil-danger">
                ${maxDrawdown.toFixed(2)}
              </div>
              <div className="text-sigil-muted text-xs mt-1">from peak P&L</div>
            </div>
          </div>

          {/* Equity curve (CSS bar chart) */}
          {equityCurve.length > 0 && (
            <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
              <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
                Cumulative P&L
              </h2>
              <div className="h-48 flex items-end gap-px">
                {equityCurve.map((pt, i) => {
                  const h = (Math.abs(pt.pnl) / maxCurve) * 100;
                  return (
                    <div
                      key={i}
                      className="flex-1 flex flex-col justify-end items-center group relative"
                      style={{ height: "100%" }}
                    >
                      <div className="absolute bottom-full mb-1 hidden group-hover:block bg-sigil-bg border border-sigil-border rounded px-2 py-1 text-xs whitespace-nowrap z-10">
                        {pt.ticker} — ${pt.pnl.toFixed(2)}
                        <br />
                        {new Date(pt.date).toLocaleDateString()}
                      </div>
                      <div
                        className={`w-full rounded-t transition-all ${pt.pnl >= 0 ? "bg-sigil-accent" : "bg-sigil-danger"}`}
                        style={{ height: `${Math.max(h, 2)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-sigil-muted mt-2">
                <span>{equityCurve.length > 0 ? new Date(equityCurve[0].date).toLocaleDateString() : ""}</span>
                <span>{equityCurve.length > 0 ? new Date(equityCurve[equityCurve.length - 1].date).toLocaleDateString() : ""}</span>
              </div>
            </div>
          )}

          {/* Signal performance comparison */}
          <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
            <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
              Signal Performance
            </h2>
            {signals.some((s) => s.eval_stats.total_evaluated) ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-sigil-muted text-xs uppercase border-b border-sigil-border">
                    <th className="text-left py-2">Signal</th>
                    <th className="text-right py-2">Weight</th>
                    <th className="text-right py-2">Predictions</th>
                    <th className="text-right py-2">Hit Rate 5d</th>
                    <th className="text-right py-2">Hit Rate 20d</th>
                    <th className="text-right py-2">Avg Alpha 5d</th>
                    <th className="text-right py-2">Avg Alpha 20d</th>
                  </tr>
                </thead>
                <tbody>
                  {signals.map((s) => (
                    <tr key={s.name} className="border-b border-sigil-border/30">
                      <td className="py-2.5 font-medium text-sigil-accent">{s.name}</td>
                      <td className="py-2.5 text-right text-sigil-muted">{(s.weight * 100).toFixed(0)}%</td>
                      <td className="py-2.5 text-right font-mono">{s.prediction_count}</td>
                      <td className="py-2.5 text-right font-mono">
                        {s.eval_stats.hit_rate_5d != null ? `${(s.eval_stats.hit_rate_5d * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        {s.eval_stats.hit_rate_20d != null ? `${(s.eval_stats.hit_rate_20d * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className={`py-2.5 text-right font-mono ${(s.eval_stats.avg_alpha_5d || 0) >= 0 ? "text-sigil-accent" : "text-sigil-danger"}`}>
                        {s.eval_stats.avg_alpha_5d != null ? `${(s.eval_stats.avg_alpha_5d * 100).toFixed(2)}%` : "—"}
                      </td>
                      <td className={`py-2.5 text-right font-mono ${(s.eval_stats.avg_alpha_20d || 0) >= 0 ? "text-sigil-accent" : "text-sigil-danger"}`}>
                        {s.eval_stats.avg_alpha_20d != null ? `${(s.eval_stats.avg_alpha_20d * 100).toFixed(2)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sigil-muted text-sm">
                Signal evaluations run automatically after 5, 20, and 60 days. Waiting for prediction horizons to mature.
              </p>
            )}
          </div>

          {/* P&L by ticker */}
          {tickerStats.length > 0 && (
            <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
              <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
                P&L by Ticker
              </h2>
              <div className="space-y-2">
                {tickerStats.slice(0, 15).map((t) => {
                  const maxPnl = Math.max(...tickerStats.map((s) => Math.abs(s.pnl)), 1);
                  const barWidth = (Math.abs(t.pnl) / maxPnl) * 100;
                  return (
                    <div key={t.ticker} className="flex items-center gap-3">
                      <span className="w-16 text-sm font-medium text-sigil-text">{t.ticker}</span>
                      <div className="flex-1 h-5 bg-sigil-bg rounded-full overflow-hidden relative">
                        <div
                          className={`h-full rounded-full transition-all ${t.pnl >= 0 ? "bg-sigil-accent/40" : "bg-sigil-danger/40"}`}
                          style={{ width: `${Math.max(barWidth, 2)}%` }}
                        />
                      </div>
                      <span className={`w-24 text-right text-sm font-mono ${t.pnl >= 0 ? "text-sigil-accent" : "text-sigil-danger"}`}>
                        ${t.pnl.toFixed(2)}
                      </span>
                      <span className="w-16 text-right text-xs text-sigil-muted">
                        {t.winRate.toFixed(0)}% ({t.count})
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pipeline run history */}
          {runs.length > 0 && (
            <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
              <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
                Pipeline Run History
              </h2>
              <div className="space-y-2">
                {runs.map((run) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-sigil-bg"
                  >
                    <span className="text-sigil-muted font-mono text-xs">{run.id.slice(0, 8)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      run.status === "completed"
                        ? "bg-sigil-accent/20 text-sigil-accent"
                        : run.status === "failed"
                          ? "bg-sigil-danger/20 text-sigil-danger"
                          : "bg-sigil-muted/20 text-sigil-muted"
                    }`}>
                      {run.status}
                    </span>
                    <span className="text-sigil-muted text-xs">{run.regime_id || "—"}</span>
                    <span className="text-sigil-muted text-xs">{run.universe_size} tickers</span>
                    <span className="text-sigil-muted text-xs">
                      {new Date(run.started_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
