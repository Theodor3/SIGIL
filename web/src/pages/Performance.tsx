import { useCallback, useEffect, useState } from "react";

import EquityCurve from "../components/EquityCurve";

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

interface HorizonStats {
  n: number;
  hit_rate: number;
  avg_alpha: number;
}

interface SignalStat {
  name: string;
  version: string;
  weight: number;
  prediction_count: number;
  eval_stats: {
    current_version?: string;
    [key: string]: any;
  };
}

function horizon(s: SignalStat, h: string): HorizonStats | undefined {
  return s.eval_stats?.[h];
}

function hasAnyEvals(s: SignalStat): boolean {
  return Boolean(horizon(s, "5d") || horizon(s, "20d") || horizon(s, "60d"));
}

const API = "";

interface LedgerStats {
  total_trades: number;
  open_count: number;
  closed_count: number;
  total_realized_pnl: number;
  account_pnl?: number;
  win_rate: number;
}

export default function Performance() {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [signals, setSignals] = useState<SignalStat[]>([]);
  const [stats, setStats] = useState<LedgerStats | null>(null);
  const [equityPoints, setEquityPoints] = useState<{ equity: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [portRes, dashRes, eqRes] = await Promise.all([
        fetch(`${API}/api/portfolio`),
        fetch(`${API}/api/dashboard-data`),
        fetch(`${API}/api/portfolio/equity-history?days=90`),
      ]);
      const portData = await portRes.json();
      const dashData = await dashRes.json();
      const eqData = await eqRes.json();

      const allTrades = [
        ...(portData.closed_trades || []).map((t: TradeRow) => ({ ...t, status: "closed" })),
        ...(portData.open_trades || []).map((t: TradeRow) => ({ ...t, status: "open" })),
      ];
      allTrades.sort((a: TradeRow, b: TradeRow) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime());
      setTrades(allTrades);
      setStats(portData.stats || null);
      setRuns(dashData.recent_runs || []);
      setSignals(dashData.signals || []);
      setEquityPoints(eqData.points || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const closedTrades = trades.filter((t) => t.status === "closed");

  // Headline numbers come from sources that can't lie: account_pnl is
  // broker equity vs starting capital (server-side over ALL history), and
  // drawdown comes from the hourly equity snapshots — never from the
  // 50-trade sample this page happens to have loaded.
  const accountPnl = stats?.account_pnl ?? 0;
  const realizedPnl = stats?.total_realized_pnl ?? 0;
  const winRate = (stats?.win_rate ?? 0) * 100;
  const closedCount = stats?.closed_count ?? closedTrades.length;

  let eqPeak = -Infinity;
  let maxDrawdown = 0;
  for (const pt of equityPoints) {
    if (pt.equity > eqPeak) eqPeak = pt.equity;
    const dd = eqPeak - pt.equity;
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

  if (loading) return <div className="text-sigil-muted">Loading performance data...</div>;

  const hasData = closedTrades.length > 0 || signals.some(hasAnyEvals);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Performance</h1>
      <p className="text-sigil-muted text-sm">
        Realized results — closed trades, live signal grades, pipeline history.
        For hypothetical replays of a signal over recorded history, see the Lab.
      </p>

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
          {/* Summary cards — account truth, not ledger arithmetic */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
              <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">Account P&L</div>
              <div className={`text-2xl font-bold font-mono ${accountPnl >= 0 ? "text-sigil-accent" : "text-sigil-danger"}`}>
                ${accountPnl.toFixed(2)}
              </div>
              <div className="text-sigil-muted text-xs mt-1">broker equity vs starting capital</div>
            </div>
            <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
              <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">Realized (ledger)</div>
              <div className={`text-2xl font-bold font-mono ${realizedPnl >= 0 ? "text-sigil-accent" : "text-sigil-danger"}`}>
                ${realizedPnl.toFixed(2)}
              </div>
              <div className="text-sigil-muted text-xs mt-1">{closedCount} closed round-trips</div>
            </div>
            <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
              <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">Win Rate</div>
              <div className="text-2xl font-bold font-mono text-sigil-text">{winRate.toFixed(1)}%</div>
              <div className="text-sigil-muted text-xs mt-1">all closed trades</div>
            </div>
            <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
              <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">Max Drawdown</div>
              <div className="text-2xl font-bold font-mono text-sigil-danger">
                ${maxDrawdown.toFixed(2)}
              </div>
              <div className="text-sigil-muted text-xs mt-1">from equity peak (90d)</div>
            </div>
          </div>

          <EquityCurve />

          {/* Signal performance comparison */}
          <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
            <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
              Signal Performance
            </h2>
            {signals.some(hasAnyEvals) ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-sigil-muted text-xs uppercase border-b border-sigil-border">
                    <th className="text-left py-2">Signal</th>
                    <th className="text-right py-2">Weight</th>
                    <th className="text-right py-2">Hit 5d</th>
                    <th className="text-right py-2">α 5d</th>
                    <th className="text-right py-2">Hit 20d</th>
                    <th className="text-right py-2">α 20d</th>
                    <th className="text-right py-2">Evals</th>
                  </tr>
                </thead>
                <tbody>
                  {[...signals]
                    .filter(hasAnyEvals)
                    .sort((a, b) => {
                      const aa = horizon(a, "20d")?.avg_alpha ?? horizon(a, "5d")?.avg_alpha ?? -1;
                      const bb = horizon(b, "20d")?.avg_alpha ?? horizon(b, "5d")?.avg_alpha ?? -1;
                      return bb - aa;
                    })
                    .map((s) => {
                      const h5 = horizon(s, "5d");
                      const h20 = horizon(s, "20d");
                      const totalN = (h5?.n || 0) + (h20?.n || 0) + (horizon(s, "60d")?.n || 0);
                      return (
                        <tr key={s.name} className="border-b border-sigil-border/30">
                          <td className="py-2.5 font-medium text-sigil-accent">
                            {s.name}
                            <span className="text-sigil-muted text-[10px] ml-1.5">
                              v{s.eval_stats.current_version || s.version}
                            </span>
                          </td>
                          <td className="py-2.5 text-right text-sigil-muted">{(s.weight * 100).toFixed(0)}%</td>
                          <td className={`py-2.5 text-right font-mono ${(h5?.hit_rate ?? 0.5) >= 0.5 ? "text-sigil-text" : "text-sigil-danger"}`}>
                            {h5 ? `${(h5.hit_rate * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className={`py-2.5 text-right font-mono ${(h5?.avg_alpha || 0) >= 0 ? "text-sigil-accent" : "text-sigil-danger"}`}>
                            {h5 ? `${(h5.avg_alpha * 100).toFixed(2)}%` : "—"}
                          </td>
                          <td className={`py-2.5 text-right font-mono ${(h20?.hit_rate ?? 0.5) >= 0.5 ? "text-sigil-text" : "text-sigil-danger"}`}>
                            {h20 ? `${(h20.hit_rate * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className={`py-2.5 text-right font-mono ${(h20?.avg_alpha || 0) >= 0 ? "text-sigil-accent" : "text-sigil-danger"}`}>
                            {h20 ? `${(h20.avg_alpha * 100).toFixed(2)}%` : "—"}
                          </td>
                          <td className="py-2.5 text-right font-mono text-sigil-muted">{totalN}</td>
                        </tr>
                      );
                    })}
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
                P&L by Ticker <span className="normal-case tracking-normal">(last {closedTrades.length} closed)</span>
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
