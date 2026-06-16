import { useDashboard } from "../hooks/useDashboard";

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-sigil-border bg-sigil-surface p-4">
      <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="text-2xl font-bold text-sigil-text">{value}</div>
      {sub && <div className="text-sigil-muted text-xs mt-1">{sub}</div>}
    </div>
  );
}

export default function Overview() {
  const { data, loading, error } = useDashboard();

  if (loading)
    return <div className="text-sigil-muted">Loading dashboard...</div>;
  if (error) return <div className="text-sigil-danger">Error: {error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Overview</h1>

      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Regime"
          value={data.regime.regime_id.replace("_", " ")}
          sub={`${(data.regime.confidence * 100).toFixed(0)}% confidence`}
        />
        <StatCard
          label="Signals Active"
          value={String(data.signals.length)}
          sub="auto-discovered"
        />
        <StatCard
          label="Holdings"
          value={String(data.portfolio.holdings_count)}
        />
        <StatCard
          label="Pipeline"
          value={data.pipeline.status.replace(/_/g, " ")}
          sub={data.pipeline.last_run ?? "never"}
        />
      </div>

      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
          Registered Signals
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {data.signals.map((s) => (
            <div
              key={s.name}
              className="rounded-lg border border-sigil-border/50 p-3 bg-sigil-bg"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-sigil-accent text-sm">
                  {s.name}
                </span>
                <span className="text-xs text-sigil-muted">v{s.version}</span>
              </div>
              <div className="text-xs text-sigil-muted">
                Weight: {(s.weight * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
          Top Ideas
        </h2>
        {data.top_ideas.length === 0 ? (
          <p className="text-sigil-muted text-sm">
            No pipeline runs yet. Run the pipeline to generate ideas.
          </p>
        ) : (
          <p className="text-sigil-muted text-sm">Ideas will appear here.</p>
        )}
      </div>
    </div>
  );
}
