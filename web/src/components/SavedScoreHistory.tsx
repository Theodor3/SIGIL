import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { prepareScoreHistory, type SavedScorePoint } from '../lib/scoreHistory';
import { formatSavedScore, scoreStatusLabel } from '../lib/savedScores';

export default function SavedScoreHistory({ points }: { points: SavedScorePoint[] }) {
  const rows = prepareScoreHistory(points);
  const saved = rows.filter(row => row.plottedScore !== null).length;
  const chartRows = rows.filter(row => Number.isFinite(row.timestamp));
  return <section className="rounded-xl border border-sigil-border bg-sigil-surface p-5" aria-label="Saved pipeline score history">
    <h3 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-2">Saved Pipeline Score History (30d)</h3>
    <p className="text-xs text-sigil-muted mb-4">{saved} saved scores · {rows.length - saved} unavailable runs. Scores × 100, not returns or probabilities. Each position is a completed run, spaced equally; full recorded timestamps appear below. Missing scores break the line. No backfill or interpolation.</p>
    {chartRows.some(row => row.plottedScore !== null) ? <div className="h-56" role="img" aria-label="Saved scores in chronological run order. The table below contains exact timestamps, values and missing-data reasons.">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartRows} margin={{ top: 10, right: 15, bottom: 12, left: 0 }}>
          <CartesianGrid stroke="#30303c" strokeDasharray="3 3" />
          <XAxis dataKey="run_id" tickFormatter={id => chartRows.find(row => row.run_id === id)?.date.slice(0, 10) ?? id} tick={{ fill: '#a1a1aa', fontSize: 10 }} minTickGap={35} />
          <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} />
          <Tooltip content={({ active, payload, label }) => {
            const row = chartRows.find(item => item.run_id === (payload?.[0]?.payload?.run_id ?? label));
            if (!active || !row) return null;
            return <div className="rounded border border-sigil-border bg-sigil-bg p-3 text-xs"><div>{row.date}</div><div>Run: {row.run_id}</div><div>{row.plottedScore === null ? 'Unavailable' : formatSavedScore(row.score)}</div><div>{scoreStatusLabel(row.score_status)}</div></div>;
          }} />
          <Line dataKey="plottedScore" name="Saved score × 100" type="linear" stroke="#17a673" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div> : <p className="py-6 text-sm text-sigil-muted">No plottable saved scores in this 30-day window.</p>}
    {rows.some(row => !Number.isFinite(row.timestamp)) && <p className="text-xs text-amber-400">Some run timestamps could not be read. Those runs appear below but are excluded from the chart.</p>}
    {rows.length > 0 && <details className="mt-4" open={saved === 0}>
      <summary className="cursor-pointer text-sm">Recorded runs and missing data ({rows.length})</summary>
      <div className="overflow-x-auto mt-3"><table className="w-full text-xs text-left"><caption className="sr-only">Exact recorded run timestamps, saved scores and availability</caption><thead><tr><th className="p-2">Recorded timestamp / run</th><th className="p-2">Score × 100</th><th className="p-2">Availability</th></tr></thead><tbody>{rows.map(row => <tr key={row.run_id} className="border-t border-sigil-border"><td className="p-2"><time>{row.date}</time><span className="block text-sigil-muted">{row.run_id}</span></td><td className="p-2 font-mono">{row.plottedScore === null ? 'Unavailable' : formatSavedScore(row.score)}</td><td className="p-2">{row.score_status === 'saved' && row.plottedScore === null ? 'Saved score is not a finite number' : scoreStatusLabel(row.score_status)}</td></tr>)}</tbody></table></div>
    </details>}
  </section>;
}
