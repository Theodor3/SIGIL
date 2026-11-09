import { formatSavedScore, scoreStatusLabel, type ScoreStatus } from "../lib/savedScores";
import { useCallback, useEffect, useState } from "react";

import WatchlistCard from "../components/WatchlistCard";

interface SignalBreakdown {
  signal: string;
  score: number;
  confidence: number | null;
  weight: number | null;
  contribution: number | null;
  metadata: Record<string, unknown>;
}

interface TradeRecord {
  id: number;
  side: string;
  shares: number;
  entry_price: number | null;
  exit_price: number | null;
  realized_pnl: number | null;
  opened_at: string;
  closed_at: string | null;
  status: string;
  regime: string | null;
}

interface ScorePoint {
  date: string;
  score: number | null;
  run_id: string;
  score_status?: ScoreStatus;
  signals: Record<string, number>;
}

interface CompanyInfo {
  name: string;
  description: string;
  sector: string;
  industry: string;
  market_cap: number | null;
  price: number | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
}

interface TickerData {
  ticker: string;
  company: CompanyInfo;
  final_score: number | null;
  score_status?: ScoreStatus;
  confidence: number | null;
  signals: SignalBreakdown[];
  score_history: ScorePoint[];
  evaluations: { signal: string; horizon_days: number; actual_return: number; signal_correct: boolean; alpha: number; date: string }[];
  trades: TradeRecord[];
  run_date: string | null;
}

interface TopIdea {
  rank: number;
  ticker: string;
  final_score: number | null;
  score_status?: ScoreStatus;
  confidence: number | null;
  signal_scores: Record<string, number>;
  top_drivers: { signal: string; contribution: number }[];
}

const API = "";

export default function Research() {
  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState<string | null>(null);
  const [data, setData] = useState<TickerData | null>(null);
  const [ideas, setIdeas] = useState<TopIdea[]>([]);
  const [ideasStatus, setIdeasStatus] = useState<ScoreStatus>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadIdeas = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/research/top-ideas`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setIdeasStatus(json.score_status);
      setIdeas(json.ideas || []);
    } catch { setError("Failed to load saved ideas."); }
  }, []);

  useEffect(() => {
    loadIdeas();
  }, [loadIdeas]);

  const loadTicker = async (t: string) => {
    setLoading(true);
    setError(null);
    setTicker(t.toUpperCase());
    try {
      const res = await fetch(`${API}/api/research/ticker/${t.toUpperCase()}`);
      if (!res.ok) throw new Error("Ticker not found");
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) loadTicker(query.trim());
  };


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Research</h1>
        {data && (
          <button
            onClick={() => { setData(null); setTicker(null); setQuery(""); }}
            className="text-xs text-sigil-muted hover:text-sigil-text transition-colors"
          >
            Back to Ideas
          </button>
        )}
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter ticker (e.g. AAPL, MSFT, NVDA)"
          className="flex-1 px-4 py-2.5 bg-sigil-surface border border-sigil-border rounded-lg text-sigil-text placeholder-sigil-muted focus:outline-none focus:border-sigil-accent"
        />
        <button
          type="submit"
          className="px-6 py-2.5 bg-sigil-accent text-sigil-bg rounded-lg font-medium hover:opacity-90 transition-opacity"
        >
          Research
        </button>
      </form>

      {!data && !loading && (
        <WatchlistCard onSelect={(t) => { setQuery(t); loadTicker(t); }} />
      )}

      {loading && <div className="text-sigil-muted text-sm">Loading research for {ticker}...</div>}
      {error && <div className="text-sigil-danger text-sm">{error}</div>}

      {/* Ticker drilldown */}
      {data && !loading && (
        <>
          {/* Header */}
          <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold text-sigil-accent">{data.ticker}</h2>
                  {data.company?.name && data.company.name !== data.ticker && (
                    <span className="text-lg text-sigil-text">{data.company.name}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  {data.company?.sector && (
                    <span className="text-xs px-2 py-0.5 rounded-full border border-sigil-border text-sigil-muted">
                      {data.company.sector}
                    </span>
                  )}
                  {data.company?.industry && (
                    <span className="text-xs text-sigil-muted">{data.company.industry}</span>
                  )}
                  {data.company?.market_cap && (
                    <span className="text-xs text-sigil-muted">
                      Mkt Cap: ${(data.company.market_cap / 1e9).toFixed(1)}B
                    </span>
                  )}
                </div>
                {data.run_date && (
                  <span className="text-xs text-sigil-muted block mt-1">
                    Saved run: {new Date(data.run_date).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="text-right">
                <div className="text-xs text-sigil-muted">{scoreStatusLabel(data.score_status)}</div>
                <div className="text-2xl font-bold font-mono">{formatSavedScore(data.final_score)}</div>
                <div className="text-xs text-sigil-muted">
                  {formatSavedScore(data.confidence, 0, "%")} confidence
                </div>
                {data.company?.price && (
                  <div className="text-sm font-mono text-sigil-text mt-1">
                    ${data.company.price.toFixed(2)}
                  </div>
                )}
              </div>
            </div>
            {data.company?.description && (
              <p className="text-sm text-sigil-muted leading-relaxed mt-3 pt-3 border-t border-sigil-border">
                {data.company.description}
              </p>
            )}
            {data.company?.fifty_two_week_high && data.company?.fifty_two_week_low && (
              <div className="flex gap-4 mt-2 text-xs text-sigil-muted">
                <span>52w Low: <span className="font-mono text-sigil-danger">${data.company.fifty_two_week_low.toFixed(2)}</span></span>
                <span>52w High: <span className="font-mono text-sigil-accent">${data.company.fifty_two_week_high.toFixed(2)}</span></span>
              </div>
            )}
          </div>

          {/* Saved signal values are not additive attribution. */}
          <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
            <h3 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
              Saved Signal Values
            </h3>
            <p className="text-xs text-sigil-muted mb-4">
              Signal values recorded with this historical pipeline score. Per-signal confidence,
              weights, and contributions were not saved and are unavailable. These values are not additive attribution.
            </p>
            <div className="space-y-3">
              {data.signals.map((s) => (
                <div key={s.signal} className="flex items-center justify-between gap-4">
                  <div className="text-sm font-medium text-sigil-text">{s.signal}</div>
                  <div className="text-sm font-mono text-sigil-accent">{formatSavedScore(s.score, 1)}</div>
                </div>
              ))}
              {data.signals.length === 0 && <p className="text-sm text-sigil-muted">No saved signal values available.</p>}
            </div>
          </div>
          {/* Signal metadata */}
          {data.signals.some((s) => Object.keys(s.metadata).length > 0) && (
            <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
              <h3 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
                Signal Details
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.signals
                  .filter((s) => Object.keys(s.metadata).length > 0)
                  .map((s) => (
                    <div key={s.signal} className="bg-sigil-bg rounded-lg p-3">
                      <div className="text-xs font-semibold text-sigil-accent mb-2">{s.signal}</div>
                      <div className="space-y-1">
                        {Object.entries(s.metadata).map(([k, v]) => (
                          <div key={k} className="flex justify-between text-xs">
                            <span className="text-sigil-muted">{k.replace(/_/g, " ")}</span>
                            <span className="text-sigil-text font-mono">
                              {typeof v === "number" ? (v as number).toFixed(3) : String(v)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Score history */}
          {data.score_history.length > 0 && (
            <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
              <h3 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
                Saved Pipeline Score History (30d)
              </h3>
              <div className="space-y-2">
                {data.score_history.map((point) => (
                  <div
                    key={point.run_id}
                    className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-sigil-bg"
                  >
                    <span className="text-sigil-muted text-xs">{point.date}<span className="block">Run: {point.run_id}</span></span>
                    <span className="font-mono text-sigil-accent">
                      {formatSavedScore(point.score)}
                      <span className="block text-xs text-sigil-muted">{scoreStatusLabel(point.score_status)}</span>
                    </span>
                    <div className="flex gap-2">
                      {Object.entries(point.signals)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 3)
                        .map(([sig, val]) => (
                          <span key={sig} className="text-xs text-sigil-muted">
                            {sig}: {(val * 100).toFixed(1)}
                          </span>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Evaluations */}
          {data.evaluations.length > 0 && (
            <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
              <h3 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
                Prediction Accuracy
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-sigil-muted text-xs uppercase border-b border-sigil-border">
                    <th className="text-left py-2">Date</th>
                    <th className="text-left py-2">Signal</th>
                    <th className="text-right py-2">Horizon</th>
                    <th className="text-right py-2">Return</th>
                    <th className="text-right py-2">Alpha</th>
                    <th className="text-right py-2">Correct</th>
                  </tr>
                </thead>
                <tbody>
                  {data.evaluations.map((ev, i) => (
                    <tr key={i} className="border-b border-sigil-border/30">
                      <td className="py-2 text-sigil-muted text-xs">{ev.date}</td>
                      <td className="py-2">{ev.signal}</td>
                      <td className="py-2 text-right">{ev.horizon_days}d</td>
                      <td className={`py-2 text-right font-mono ${ev.actual_return >= 0 ? "text-sigil-accent" : "text-sigil-danger"}`}>
                        {ev.actual_return !== null ? `${(ev.actual_return * 100).toFixed(2)}%` : "—"}
                      </td>
                      <td className={`py-2 text-right font-mono ${ev.alpha >= 0 ? "text-sigil-accent" : "text-sigil-danger"}`}>
                        {ev.alpha !== null ? `${(ev.alpha * 100).toFixed(2)}%` : "—"}
                      </td>
                      <td className="py-2 text-right">
                        {ev.signal_correct ? (
                          <span className="text-sigil-accent">Yes</span>
                        ) : (
                          <span className="text-sigil-danger">No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Trade history */}
          {data.trades.length > 0 && (
            <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
              <h3 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
                Trade History
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-sigil-muted text-xs uppercase border-b border-sigil-border">
                    <th className="text-left py-2">Opened</th>
                    <th className="text-left py-2">Side</th>
                    <th className="text-right py-2">Shares</th>
                    <th className="text-right py-2">Entry</th>
                    <th className="text-right py-2">Exit</th>
                    <th className="text-right py-2">P&L</th>
                    <th className="text-left py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trades.map((t) => (
                    <tr key={t.id} className="border-b border-sigil-border/30">
                      <td className="py-2 text-sigil-muted text-xs">
                        {new Date(t.opened_at).toLocaleDateString()}
                      </td>
                      <td className={`py-2 ${t.side === "long" ? "text-sigil-accent" : "text-sigil-danger"}`}>
                        {t.side}
                      </td>
                      <td className="py-2 text-right font-mono">{t.shares}</td>
                      <td className="py-2 text-right font-mono">
                        {t.entry_price ? `$${t.entry_price.toFixed(2)}` : "—"}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {t.exit_price ? `$${t.exit_price.toFixed(2)}` : "—"}
                      </td>
                      <td className={`py-2 text-right font-mono ${(t.realized_pnl || 0) >= 0 ? "text-sigil-accent" : "text-sigil-danger"}`}>
                        {t.realized_pnl !== null ? `$${t.realized_pnl.toFixed(2)}` : "—"}
                      </td>
                      <td className="py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          t.status === "open"
                            ? "bg-sigil-accent/20 text-sigil-accent"
                            : "bg-sigil-muted/20 text-sigil-muted"
                        }`}>
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Top ideas list (when no ticker selected) */}
      {!data && !loading && (
        <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
          <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider mb-4">
            Top Ideas — Click to Research
          </h2>
          {ideas.length === 0 ? (
            <p className="text-sigil-muted text-sm">
              {scoreStatusLabel(ideasStatus)}. No saved ideas available.
            </p>
          ) : (
            <div className="space-y-2">
              {ideas.map((idea) => (
                <button
                  key={idea.ticker}
                  onClick={() => { setQuery(idea.ticker); loadTicker(idea.ticker); }}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-sigil-bg hover:bg-sigil-border/30 transition-colors text-left"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-sigil-muted text-sm w-6">#{idea.rank}</span>
                    <span className="font-semibold text-sigil-text">{idea.ticker}</span>
                  </div>
                  <div className="flex items-center gap-6">
                    <span className="text-xs text-sigil-muted">{scoreStatusLabel(idea.score_status ?? ideasStatus)}</span>
                    <span className="font-mono text-sigil-accent">
                      {formatSavedScore(idea.final_score)}
                    </span>
                    <span className="text-xs text-sigil-muted">
                      {formatSavedScore(idea.confidence, 0, "%")}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
