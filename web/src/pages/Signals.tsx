import { useDashboard } from "../hooks/useDashboard";

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

      <div className="grid grid-cols-2 gap-4">
        {data?.signals.map((s) => (
          <div
            key={s.name}
            className="rounded-xl border border-sigil-border bg-sigil-surface p-5"
          >
            <div className="flex items-center justify-between mb-3">
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

            <p className="text-sigil-muted text-xs mb-3">{s.description}</p>

            <div className="grid grid-cols-4 gap-3 text-center">
              <div>
                <div className="text-sigil-muted text-xs mb-1">
                  Predictions
                </div>
                <div className="text-lg font-bold text-sigil-text">
                  {s.prediction_count}
                </div>
              </div>
              <div>
                <div className="text-sigil-muted text-xs mb-1">Hit Rate</div>
                <div className="text-lg font-bold text-sigil-text">--</div>
              </div>
              <div>
                <div className="text-sigil-muted text-xs mb-1">IC</div>
                <div className="text-lg font-bold text-sigil-text">--</div>
              </div>
              <div>
                <div className="text-sigil-muted text-xs mb-1">Avg Alpha</div>
                <div className="text-lg font-bold text-sigil-text">--</div>
              </div>
            </div>

            <div className="mt-3 h-16 rounded-lg bg-sigil-bg border border-sigil-border/30 flex items-center justify-center text-sigil-muted text-xs">
              {s.prediction_count > 0
                ? "Accuracy chart available after evaluation (5/20/60 day horizons)"
                : "Run the pipeline to generate predictions"}
            </div>
          </div>
        ))}
      </div>

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
