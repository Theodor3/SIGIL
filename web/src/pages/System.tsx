export default function System() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">System</h1>

      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">Pipeline Runs</h2>
        <p className="text-sigil-muted text-sm">
          No runs recorded yet. Pipeline history will appear here with status, duration, and regime at time of run.
        </p>
      </div>

      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">Data Freshness</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-sigil-muted text-xs uppercase tracking-wider">
                <th className="text-left py-2 pr-4">Source</th>
                <th className="text-left py-2 pr-4">Provider</th>
                <th className="text-left py-2 pr-4">Status</th>
                <th className="text-left py-2">Last Updated</th>
              </tr>
            </thead>
            <tbody className="text-sigil-muted">
              {["Market Data", "Fundamentals", "Earnings Calendar", "News", "Wikipedia", "FRED Macro"].map((source) => (
                <tr key={source} className="border-t border-sigil-border/30">
                  <td className="py-2 pr-4 text-sigil-text">{source}</td>
                  <td className="py-2 pr-4">--</td>
                  <td className="py-2 pr-4">
                    <span className="px-2 py-0.5 rounded-full text-xs border border-sigil-muted/30 text-sigil-muted">
                      waiting
                    </span>
                  </td>
                  <td className="py-2">--</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">Regime History</h2>
        <p className="text-sigil-muted text-sm">
          Timeline chart of regime changes — connects in Phase 3.
        </p>
      </div>
    </div>
  );
}
