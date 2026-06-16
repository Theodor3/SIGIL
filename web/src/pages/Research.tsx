export default function Research() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Research</h1>
      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">Idea Drilldown</h2>
        <p className="text-sigil-muted text-sm">
          Select an idea from Overview to see signal attribution, catalyst calendar, and execution guidance.
        </p>
      </div>

      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">Catalyst Calendar</h2>
        <p className="text-sigil-muted text-sm">
          Earnings dates, governance events, and forward-test checkpoints — connects in Phase 3.
        </p>
      </div>
    </div>
  );
}
