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
                <span className="font-bold text-sigil-accent">{s.name}</span>
                <span className="text-sigil-muted text-xs ml-2">
                  v{s.version}
                </span>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full border border-sigil-accent/30 text-sigil-accent bg-sigil-accent/10">
                {(s.weight * 100).toFixed(0)}% weight
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-sigil-muted text-xs">Hit Rate</div>
                <div className="text-lg font-bold text-sigil-text">--</div>
              </div>
              <div>
                <div className="text-sigil-muted text-xs">IC</div>
                <div className="text-lg font-bold text-sigil-text">--</div>
              </div>
              <div>
                <div className="text-sigil-muted text-xs">Avg Alpha</div>
                <div className="text-lg font-bold text-sigil-text">--</div>
              </div>
            </div>

            <div className="mt-3 h-16 rounded-lg bg-sigil-bg border border-sigil-border/30 flex items-center justify-center text-sigil-muted text-xs">
              Accuracy chart — needs pipeline runs
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
