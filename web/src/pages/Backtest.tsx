export default function Backtest() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Backtest</h1>
      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5 h-72 flex items-center justify-center text-sigil-muted">
        Equity curve (Lightweight Charts) — connects in Phase 4
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5 h-48 flex items-center justify-center text-sigil-muted">
          Drawdown chart
        </div>
        <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5 h-48 flex items-center justify-center text-sigil-muted">
          Bucket analysis (Q1–Q4 returns by score)
        </div>
      </div>

      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">Model Comparison</h2>
        <p className="text-sigil-muted text-sm">
          Champion vs challenger CAGR, Sharpe, hit rate — connects in Phase 4.
        </p>
      </div>
    </div>
  );
}
