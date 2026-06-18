import { useDashboard } from "../hooks/useDashboard";

interface EvalStats {
  [key: string]: {
    n: number;
    hit_rate: number;
    avg_alpha: number;
  };
}

function StatBox({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="text-center">
      <div className="text-sigil-muted text-xs mb-1">{label}</div>
      <div className="text-lg font-bold text-sigil-text">{value}</div>
      {sub && <div className="text-sigil-muted text-[10px]">{sub}</div>}
    </div>
  );
}

export default function Signals() {
  const { data, loading } = useDashboard();

  if (loading)
    return <div className="text-sigil-muted">Loading signals...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Signal Health</h1>
      <p className="text-sigil-muted text-sm">
        Each signal is tracked independently. Hit rate, information coefficient,
        and alpha are computed after predictions are graded at 5, 20, and 60-day
        horizons.
      </p>

      {(() => {
        const signals = data?.signals || [];
        const categories = [...new Set(signals.map((s) => s.category || "other"))];
        const categoryColors: Record<string, string> = {
          fundamental: "text-blue-400",
          technical: "text-purple-400",
          event: "text-yellow-400",
          alternative: "text-cyan-400",
          sentiment: "text-orange-400",
          other: "text-sigil-muted",
        };
        return categories.map((cat) => {
          const catSignals = signals.filter((s) => (s.category || "other") === cat);
          return (
            <div key={cat} className="space-y-3">
              <h2 className={`text-sm font-semibold uppercase tracking-wider ${categoryColors[cat] || categoryColors.other}`}>
                {cat} ({catSignals.length})
              </h2>
              <div className="grid grid-cols-2 gap-4">
        {catSignals.map((s) => {
          const stats: EvalStats = (s as any).eval_stats || {};
          const hasEvals = Object.keys(stats).length > 0;
          const primary = stats["5d"] || stats["20d"] || stats["60d"];

          return (
            <div
              key={s.name}
              className="rounded-xl border border-sigil-border bg-sigil-surface p-5"
            >
              <div className="flex items-center justify-between mb-1">
                <div>
                  <span className="font-bold text-sigil-accent text-lg">
                    {s.name}
                  </span>
                  <span className="text-sigil-muted text-xs ml-2">
                    v{s.version}
                  </span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full border border-sigil-accent/30 text-sigil-accent bg-sigil-accent/10">
                  {(s.weight * 100).toFixed(0)}% weight
                </span>
              </div>
              {s.description && (
                <div className="text-xs text-sigil-muted mb-2">{s.description}</div>
              )}
              {s.tags && s.tags.length > 0 && (
                <div className="flex gap-1 mb-3 flex-wrap">
                  {s.tags.map((tag: string) => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-sigil-bg border border-sigil-border/50 text-sigil-muted">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-4 gap-3">
                <StatBox
                  label="Predictions"
                  value={String(s.prediction_count)}
                />
                <StatBox
                  label="Hit Rate"
                  value={
                    primary
                      ? `${(primary.hit_rate * 100).toFixed(1)}%`
                      : "--"
                  }
                  sub={primary ? `n=${primary.n}` : undefined}
                />
                <StatBox
                  label="Avg Alpha"
                  value={
                    primary
                      ? `${(primary.avg_alpha * 100).toFixed(2)}%`
                      : "--"
                  }
                />
                <StatBox
                  label="Evaluations"
                  value={
                    hasEvals
                      ? Object.values(stats)
                          .reduce((sum, s) => sum + s.n, 0)
                          .toString()
                      : "--"
                  }
                />
              </div>

              {hasEvals && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(["5d", "20d", "60d"] as const).map((h) => {
                    const s2 = stats[h];
                    return (
                      <div
                        key={h}
                        className="rounded-lg bg-sigil-bg border border-sigil-border/30 p-2 text-center"
                      >
                        <div className="text-sigil-muted text-[10px] uppercase">
                          {h} horizon
                        </div>
                        {s2 ? (
                          <>
                            <div
                              className={`text-sm font-bold ${s2.hit_rate >= 0.5 ? "text-sigil-accent" : "text-sigil-danger"}`}
                            >
                              {(s2.hit_rate * 100).toFixed(1)}%
                            </div>
                            <div className="text-[10px] text-sigil-muted">
                              {s2.n} evals
                            </div>
                          </>
                        ) : (
                          <div className="text-sm text-sigil-muted">--</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {!hasEvals && (
                <div className="mt-3 h-12 rounded-lg bg-sigil-bg border border-sigil-border/30 flex items-center justify-center text-sigil-muted text-xs">
                  {s.prediction_count > 0
                    ? "Run evaluation to grade predictions"
                    : "Run the pipeline first"}
                </div>
              )}
            </div>
          );
        })}
              </div>
            </div>
          );
        });
      })()}

      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-3">
          Adding a New Signal
        </h2>
        <div className="text-sm text-sigil-muted space-y-1">
          <p>
            1. Copy{" "}
            <code className="text-sigil-accent bg-sigil-bg px-1 rounded">
              api/signals/template.py
            </code>{" "}
            to a new file
          </p>
          <p>
            2. Implement{" "}
            <code className="text-sigil-accent bg-sigil-bg px-1 rounded">
              name
            </code>
            ,{" "}
            <code className="text-sigil-accent bg-sigil-bg px-1 rounded">
              version
            </code>
            ,{" "}
            <code className="text-sigil-accent bg-sigil-bg px-1 rounded">
              default_weight
            </code>
            , and{" "}
            <code className="text-sigil-accent bg-sigil-bg px-1 rounded">
              compute()
            </code>
          </p>
          <p>3. Restart the server — the registry auto-discovers it</p>
        </div>
      </div>
    </div>
  );
}
