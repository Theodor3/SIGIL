import { useEffect, useState } from "react";
import { useDashboard } from "../hooks/useDashboard";

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
      <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">
        {label}
      </div>
      <div
        className={`text-2xl font-bold ${accent ? "text-sigil-accent" : "text-sigil-text"}`}
      >
        {value}
      </div>
      {sub && <div className="text-sigil-muted text-xs mt-1">{sub}</div>}
    </div>
  );
}

function ScoreBar({ score, max = 1 }: { score: number; max?: number }) {
  const pct = Math.min((score / max) * 100, 100);
  return (
    <div className="w-full h-1.5 bg-sigil-border rounded-full overflow-hidden">
      <div
        className="h-full bg-sigil-accent rounded-full transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function Overview() {
  const { data, loading, error, refetch } = useDashboard();
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  // Auto-refresh dashboard every 30 seconds
  useEffect(() => {
    const interval = setInterval(refetch, 30_000);
    return () => clearInterval(interval);
  }, [refetch]);

  // Poll faster while pipeline is running
  useEffect(() => {
    if (!pipelineRunning) return;
    const interval = setInterval(refetch, 5_000);
    return () => clearInterval(interval);
  }, [pipelineRunning, refetch]);

  const triggerPipeline = async () => {
    setPipelineRunning(true);
    setPipelineError(null);
    try {
      const res = await fetch("/api/pipeline/run", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: "Pipeline failed" }));
        setPipelineError(body.detail || `Error ${res.status}`);
      }
      await refetch();
    } catch (e: any) {
      setPipelineError(e.message || "Network error");
    } finally {
      setPipelineRunning(false);
    }
  };

  if (loading)
    return <div className="text-sigil-muted">Loading dashboard...</div>;
  if (error) return <div className="text-sigil-danger">Error: {error}</div>;
  if (!data) return null;

  const duration = data.pipeline.duration;
  const isRunning = pipelineRunning || data.pipeline.status === "running";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Overview</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={triggerPipeline}
            disabled={isRunning}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              isRunning
                ? "border-sigil-border text-sigil-muted cursor-not-allowed"
                : "border-sigil-accent text-sigil-accent hover:bg-sigil-accent/10 cursor-pointer"
            }`}
          >
            {isRunning ? "Pipeline running…" : "Run Pipeline"}
          </button>
        </div>
      </div>

      {pipelineError && (
        <div className="rounded-lg bg-sigil-danger/10 border border-sigil-danger/30 px-4 py-2 text-sm text-sigil-danger flex items-center justify-between">
          <span>Pipeline error: {pipelineError}</span>
          <button onClick={() => setPipelineError(null)} className="text-sigil-danger/60 hover:text-sigil-danger ml-2">&times;</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Signals Active"
          value={String(data.signals.length)}
          sub="auto-discovered"
        />
        <StatCard
          label="Universe"
          value={String(data.pipeline.universe_size || 0)}
          sub="tickers screened"
        />
        <StatCard
          label="Pipeline"
          value={data.pipeline.status.replace(/_/g, " ")}
          sub={
            duration
              ? `${duration.toFixed(1)}s — ${new Date(data.pipeline.last_run!).toLocaleString()}`
              : data.pipeline.last_run
                ? new Date(data.pipeline.last_run).toLocaleString()
                : "never run"
          }
        />
      </div>

      {/* Regime Section */}
      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider">
            Market Regime
          </h2>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              data.regime.vol_state === "stressed" ? "bg-red-500/20 text-red-400" :
              data.regime.vol_state === "elevated" ? "bg-yellow-500/20 text-yellow-400" :
              "bg-sigil-accent/20 text-sigil-accent"
            }`}>
              vol: {data.regime.vol_state || "normal"}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              data.regime.breadth_state?.includes("negative") ? "bg-red-500/20 text-red-400" :
              data.regime.breadth_state?.includes("positive") ? "bg-sigil-accent/20 text-sigil-accent" :
              "bg-sigil-muted/20 text-sigil-muted"
            }`}>
              breadth: {(data.regime.breadth_state || "mixed").replace("_", " ")}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Regime ID + Confidence */}
          <div className="col-span-3">
            <div className={`text-3xl font-bold mb-1 ${
              data.regime.regime_id === "risk_off" ? "text-red-400" :
              data.regime.regime_id === "high_vol" ? "text-yellow-400" :
              data.regime.regime_id === "trend_growth" ? "text-emerald-400" :
              "text-sigil-accent"
            }`}>
              {data.regime.regime_id.replace("_", " ").toUpperCase()}
            </div>
            <div className="text-sigil-muted text-sm mb-3">
              {(data.regime.confidence * 100).toFixed(0)}% confidence
            </div>
            <div className="text-xs text-sigil-muted">
              Gross exposure: <span className="text-sigil-text font-semibold">{((data.regime.exposure || 0.75) * 100).toFixed(0)}%</span>
            </div>
          </div>

          {/* Key Indicators */}
          <div className="col-span-3">
            <div className="text-xs text-sigil-muted uppercase tracking-wider mb-2">Indicators</div>
            <div className="space-y-2">
              {[
                { label: "SPY 20d", value: data.regime.indicators?.spy_20d, fmt: (v: number) => `${(v * 100).toFixed(2)}%` },
                { label: "QQQ 20d", value: data.regime.indicators?.qqq_20d, fmt: (v: number) => `${(v * 100).toFixed(2)}%` },
                { label: "VIX", value: data.regime.indicators?.vix, fmt: (v: number) => v.toFixed(1) },
              ].map(({ label, value, fmt }) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-sigil-muted">{label}</span>
                  <span className={`font-mono ${
                    value == null ? "text-sigil-muted" :
                    label === "VIX" ? (value > 22 ? "text-red-400" : value > 18 ? "text-yellow-400" : "text-sigil-accent") :
                    value > 0 ? "text-sigil-accent" : value < 0 ? "text-red-400" : "text-sigil-text"
                  }`}>
                    {value != null ? fmt(value) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Factor Tilts */}
          <div className="col-span-3">
            <div className="text-xs text-sigil-muted uppercase tracking-wider mb-2">Factor Tilts</div>
            <div className="space-y-1.5">
              {data.regime.factor_tilts && Object.entries(data.regime.factor_tilts).map(([factor, tilt]) => (
                <div key={factor} className="flex items-center gap-2 text-xs">
                  <span className="text-sigil-muted w-24 truncate">{factor}</span>
                  <div className="flex-1 h-1.5 bg-sigil-border rounded-full overflow-hidden relative">
                    <div
                      className={`absolute h-full rounded-full ${tilt >= 1 ? "bg-sigil-accent" : "bg-yellow-500"}`}
                      style={{
                        left: tilt >= 1 ? "50%" : `${(tilt / 2) * 100}%`,
                        width: tilt >= 1 ? `${((tilt - 1) / 0.3) * 50}%` : `${((1 - tilt) / 0.3) * 50}%`,
                        right: tilt < 1 ? "50%" : undefined,
                      }}
                    />
                    <div className="absolute w-px h-full bg-sigil-muted/50 left-1/2" />
                  </div>
                  <span className={`font-mono w-10 text-right ${tilt > 1 ? "text-sigil-accent" : tilt < 1 ? "text-yellow-400" : "text-sigil-text"}`}>
                    {tilt.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Regime History Mini Chart */}
          <div className="col-span-3">
            <div className="text-xs text-sigil-muted uppercase tracking-wider mb-2">Recent History</div>
            {data.regime.history && data.regime.history.length > 0 ? (
              <div className="flex items-end gap-1 h-16">
                {data.regime.history.map((h, i) => {
                  const color =
                    h.regime_id === "risk_off" ? "bg-red-400" :
                    h.regime_id === "high_vol" ? "bg-yellow-400" :
                    h.regime_id === "trend_growth" ? "bg-emerald-400" :
                    "bg-sigil-accent";
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${h.date}: ${h.regime_id} (${(h.confidence * 100).toFixed(0)}%)`}>
                      <div
                        className={`w-full rounded-sm ${color}`}
                        style={{ height: `${Math.max(h.confidence * 100, 20)}%` }}
                      />
                      <span className="text-[9px] text-sigil-muted">{h.date}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-sigil-muted">No history yet — builds over time</div>
            )}
            <div className="flex items-center gap-3 mt-2 text-[10px] text-sigil-muted">
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-sigil-accent" /> risk on</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-emerald-400" /> trend</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-yellow-400" /> high vol</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-red-400" /> risk off</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {data.signals.map((s) => {
          const activeCount = data.top_ideas.filter(
            (idea) => (idea.signal_scores[s.name] || 0) > 0
          ).length;
          return (
            <div
              key={s.name}
              className="rounded-xl border border-sigil-border bg-sigil-surface p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sigil-accent">{s.name}</span>
                <span className="text-xs text-sigil-muted px-2 py-0.5 rounded-full border border-sigil-border">
                  v{s.version}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-sigil-muted mb-1">
                <span>Weight: {(s.weight * 100).toFixed(0)}%</span>
                <span>
                  {activeCount > 0 ? (
                    <span className="text-sigil-accent">{activeCount} active</span>
                  ) : (
                    <span className="text-sigil-muted">0 active</span>
                  )}
                  {" / "}{s.prediction_count} total
                </span>
              </div>
              <ScoreBar score={s.weight} max={0.3} />
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
          Top Ideas
        </h2>
        {data.top_ideas.length === 0 ? (
          <p className="text-sigil-muted text-sm">
            No pipeline runs yet. Click "Run Pipeline" to generate ideas.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-sigil-muted text-xs uppercase border-b border-sigil-border">
                  <th className="text-left py-2 pr-4">#</th>
                  <th className="text-left py-2 pr-4">Ticker</th>
                  <th className="text-left py-2 pr-4">Sector</th>
                  <th className="text-right py-2 pr-4">Score</th>
                  <th className="text-right py-2 pr-4">Confidence</th>
                  {data.signals.map((s) => (
                    <th key={s.name} className="text-right py-2 pr-4">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.top_ideas.map((idea) => (
                  <tr
                    key={idea.ticker}
                    className="border-b border-sigil-border/30 hover:bg-sigil-bg/50 transition-colors"
                  >
                    <td className="py-2.5 pr-4 text-sigil-muted">
                      {idea.rank}
                    </td>
                    <td className="py-2.5 pr-4 font-semibold text-sigil-text">
                      {idea.ticker}
                    </td>
                    <td className="py-2.5 pr-4 text-sigil-muted text-xs">
                      {idea.sector || "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-right">
                      <span className="text-sigil-accent font-mono">
                        {(idea.final_score * 100).toFixed(2)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right text-sigil-muted font-mono">
                      {(idea.confidence * 100).toFixed(0)}%
                    </td>
                    {data.signals.map((s) => {
                      const val = idea.signal_scores[s.name];
                      return (
                        <td
                          key={s.name}
                          className="py-2.5 pr-4 text-right font-mono text-sigil-muted"
                        >
                          {val !== undefined ? (val * 100).toFixed(1) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.recent_runs && data.recent_runs.length > 0 && (
        <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
          <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
            Recent Pipeline Runs
          </h2>
          <div className="space-y-2">
            {data.recent_runs.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-sigil-bg"
              >
                <span className="text-sigil-muted font-mono text-xs">
                  {run.id.slice(0, 8)}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    run.status === "completed"
                      ? "bg-sigil-accent/20 text-sigil-accent"
                      : run.status === "failed"
                        ? "bg-sigil-danger/20 text-sigil-danger"
                        : "bg-sigil-muted/20 text-sigil-muted"
                  }`}
                >
                  {run.status}
                </span>
                <span className="text-sigil-muted text-xs">
                  {run.regime_id || "—"}
                </span>
                <span className="text-sigil-muted text-xs">
                  {run.universe_size} tickers
                </span>
                <span className="text-sigil-muted text-xs">
                  {new Date(run.started_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
