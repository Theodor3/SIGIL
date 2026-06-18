import { useState } from "react";
import { useDashboard } from "../hooks/useDashboard";

export default function System() {
  const { data, loading, refetch } = useDashboard();
  const [evaluating, setEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<string | null>(null);

  async function runEvaluation() {
    setEvaluating(true);
    setEvalResult(null);
    try {
      const res = await fetch("/api/pipeline/evaluate", { method: "POST" });
      const json = await res.json();
      const total = Object.values(json).reduce(
        (sum: number, v: any) => sum + (v.evaluated || 0),
        0,
      );
      setEvalResult(`Evaluated ${total} predictions across 5/20/60 day horizons`);
      await refetch();
    } catch {
      setEvalResult("Evaluation failed");
    } finally {
      setEvaluating(false);
    }
  }

  if (loading)
    return <div className="text-sigil-muted">Loading system data...</div>;

  const runs = data?.recent_runs || [];
  const signals = data?.signals || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">System</h1>
        <button
          onClick={runEvaluation}
          disabled={evaluating}
          className="px-4 py-2 rounded-lg bg-sigil-surface border border-sigil-accent text-sigil-accent font-semibold text-sm
                     hover:bg-sigil-accent/10 disabled:opacity-50 transition-all"
        >
          {evaluating ? "Evaluating..." : "Evaluate Predictions"}
        </button>
      </div>

      {evalResult && (
        <div className="rounded-lg bg-sigil-accent/10 border border-sigil-accent/30 px-4 py-2 text-sm text-sigil-accent">
          {evalResult}
        </div>
      )}

      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
          Pipeline Runs
        </h2>
        {runs.length === 0 ? (
          <p className="text-sigil-muted text-sm">No runs recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-sigil-muted text-xs uppercase border-b border-sigil-border">
                  <th className="text-left py-2 pr-4">Run ID</th>
                  <th className="text-left py-2 pr-4">Status</th>
                  <th className="text-left py-2 pr-4">Regime</th>
                  <th className="text-right py-2 pr-4">Universe</th>
                  <th className="text-left py-2 pr-4">Started</th>
                  <th className="text-left py-2">Finished</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-sigil-border/30 hover:bg-sigil-bg/50"
                  >
                    <td className="py-2 pr-4 font-mono text-xs text-sigil-muted">
                      {run.id.slice(0, 8)}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          run.status === "completed"
                            ? "bg-sigil-accent/20 text-sigil-accent"
                            : run.status === "failed"
                              ? "bg-sigil-danger/20 text-sigil-danger"
                              : "bg-yellow-500/20 text-yellow-400"
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-sigil-muted">
                      {run.regime_id || "—"}
                    </td>
                    <td className="py-2 pr-4 text-right text-sigil-muted">
                      {run.universe_size}
                    </td>
                    <td className="py-2 pr-4 text-sigil-muted text-xs">
                      {new Date(run.started_at).toLocaleString()}
                    </td>
                    <td className="py-2 text-sigil-muted text-xs">
                      {run.finished_at
                        ? new Date(run.finished_at).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
          Signal Registry
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-sigil-muted text-xs uppercase border-b border-sigil-border">
                <th className="text-left py-2 pr-4">Signal</th>
                <th className="text-left py-2 pr-4">Version</th>
                <th className="text-right py-2 pr-4">Weight</th>
                <th className="text-right py-2 pr-4">Predictions</th>
                <th className="text-right py-2 pr-4">5d Hit Rate</th>
                <th className="text-right py-2">5d Alpha</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => {
                const stats = (s as any).eval_stats || {};
                const s5 = stats["5d"];
                return (
                  <tr
                    key={s.name}
                    className="border-b border-sigil-border/30 hover:bg-sigil-bg/50"
                  >
                    <td className="py-2 pr-4 font-semibold text-sigil-accent">
                      {s.name}
                    </td>
                    <td className="py-2 pr-4 text-sigil-muted">v{s.version}</td>
                    <td className="py-2 pr-4 text-right text-sigil-muted">
                      {(s.weight * 100).toFixed(0)}%
                    </td>
                    <td className="py-2 pr-4 text-right text-sigil-muted">
                      {s.prediction_count}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {s5 ? (
                        <span
                          className={
                            s5.hit_rate >= 0.5
                              ? "text-sigil-accent"
                              : "text-sigil-danger"
                          }
                        >
                          {(s5.hit_rate * 100).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-sigil-muted">—</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {s5 ? (
                        <span
                          className={
                            s5.avg_alpha >= 0
                              ? "text-sigil-accent"
                              : "text-sigil-danger"
                          }
                        >
                          {(s5.avg_alpha * 100).toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-sigil-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
          Data Sources
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-sigil-muted text-xs uppercase tracking-wider border-b border-sigil-border">
                <th className="text-left py-2 pr-4">Source</th>
                <th className="text-left py-2 pr-4">Provider</th>
                <th className="text-left py-2 pr-4">Status</th>
                <th className="text-right py-2 pr-4">Last Fetch</th>
                <th className="text-right py-2">Records</th>
              </tr>
            </thead>
            <tbody className="text-sigil-muted">
              {(data?.data_sources || []).map((src: any) => (
                <tr key={src.name} className="border-b border-sigil-border/30">
                  <td className="py-2 pr-4 text-sigil-text">{src.name.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-4">{src.provider}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        src.status === "active"
                          ? "bg-sigil-accent/20 text-sigil-accent border border-sigil-accent/30"
                          : src.status === "error"
                            ? "bg-sigil-danger/20 text-sigil-danger border border-sigil-danger/30"
                            : src.status === "no_key"
                              ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                              : "border border-sigil-muted/30 text-sigil-muted"
                      }`}
                    >
                      {src.status === "no_key" ? "no API key" : src.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right text-xs">
                    {src.last_fetch ? new Date(src.last_fetch).toLocaleString() : "—"}
                  </td>
                  <td className="py-2 text-right">
                    {src.last_fetch_count > 0 ? src.last_fetch_count : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
