import { useState } from "react";
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
  const [running, setRunning] = useState(false);

  async function runPipeline() {
    setRunning(true);
    try {
      await fetch("/api/pipeline/run", { method: "POST" });
      await refetch();
    } finally {
      setRunning(false);
    }
  }

  if (loading)
    return <div className="text-sigil-muted">Loading dashboard...</div>;
  if (error) return <div className="text-sigil-danger">Error: {error}</div>;
  if (!data) return null;

  const duration = data.pipeline.duration;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Overview</h1>
        <button
          onClick={runPipeline}
          disabled={running}
          className="px-4 py-2 rounded-lg bg-sigil-accent text-sigil-bg font-semibold text-sm
                     hover:bg-sigil-accent/90 disabled:opacity-50 transition-all"
        >
          {running ? "Running Pipeline..." : "Run Pipeline"}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Regime"
          value={data.regime.regime_id.replace("_", " ").toUpperCase()}
          sub={`${(data.regime.confidence * 100).toFixed(0)}% confidence`}
          accent
        />
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

      <div className="grid grid-cols-3 gap-4">
        {data.signals.map((s) => (
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
              <span>{s.prediction_count} predictions</span>
            </div>
            <ScoreBar score={s.weight} max={0.3} />
          </div>
        ))}
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
