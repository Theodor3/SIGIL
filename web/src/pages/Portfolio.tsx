export default function Portfolio() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Portfolio</h1>
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
          <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">Holdings</div>
          <div className="text-2xl font-bold">0</div>
        </div>
        <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
          <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">Total Value</div>
          <div className="text-2xl font-bold">$0.00</div>
        </div>
        <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
          <div className="text-sigil-muted text-xs uppercase tracking-wider mb-1">Cash</div>
          <div className="text-2xl font-bold">--</div>
        </div>
      </div>

      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5 h-64 flex items-center justify-center text-sigil-muted">
        Sector exposure chart — connects in Phase 4
      </div>

      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5 h-48 flex items-center justify-center text-sigil-muted">
        Position sizes — connects in Phase 4
      </div>
    </div>
  );
}
