import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboard } from '../hooks/useDashboard';
import { formatSavedScore, scoreStatusLabel, type ScoreStatus } from '../lib/savedScores';
import { programAssessments, savedIdeas, toggleIdeaVote, type StockIdea } from '../lib/stockIdeas';
import { checkpoint, checkpointAgeNotice } from '../lib/researchCheckpoint';
import checkpointData from '../data/researchCheckpoint.json';
import './StockIdeas.css';

const research = checkpoint(checkpointData);
const questions = [
  { id: 'downside', title: 'Can a downside warning beat a simple baseline?', detail: 'Compare false alarms, missed declines and costs before testing a more complex model.' },
  { id: 'materials', title: 'Which company links are supported by materials evidence?', detail: 'Start with one sourced commodity chain. Keep economic exposure separate from a return forecast.' },
  { id: 'cash', title: 'How much cash growth survives an accounting sensitivity?', detail: 'Follow retained company studies, including negative and inconclusive findings.' },
];
export interface HomeData {
  top_ideas: StockIdea[];
  score_status?: ScoreStatus;
  pipeline: { run_id: string | null; last_run: string | null; status: string };
}

export function StockIdeasView({ data, loading = false, error = null, refetch, refreshing = false, preview = false }: {
  data: HomeData | null; loading?: boolean; error?: string | null; refetch?: () => void; refreshing?: boolean; preview?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [votes, setVotes] = useState<string[]>([]);
  const [researchFilter, setResearchFilter] = useState('all');
  const ideas = savedIdeas(data?.top_ideas ?? [], data?.score_status);
  const stock = ideas.find(idea => idea.ticker === selected) ?? ideas[0];
  const assessments = stock ? programAssessments(stock) : [];
  const availableResearch = research.items.filter(item => researchFilter === 'all' || item.status === researchFilter);

  return <div className="stock-home">
    {preview && <div className="home-notice"><strong>Offline design preview / synthetic stock examples.</strong> No current picks, live services, portfolio data or trading. Research below is a retained historical checkpoint.</div>}
    <header className="home-heading"><div><p className="home-eyebrow">SIGIL / Research workspace</p><h1>Stock ideas</h1><p>Start with the saved ranking. Read the evidence before the story.</p></div>{refetch && <button onClick={refetch} disabled={loading || refreshing}>{refreshing ? 'Refreshing saved view…' : 'Refresh saved view'}</button>}</header>
    <section className="home-provenance" aria-label="Ranking provenance"><strong>{preview ? 'Synthetic demo' : scoreStatusLabel(data?.score_status)}</strong><span>Run: {data?.pipeline.run_id ?? 'Unavailable'}</span><span>Run started: {data?.pipeline.last_run ?? 'Unknown'}</span><span>Underlying input dates: not retained in this summary</span></section>
    {loading && <p role="status">Loading saved stock ideas…</p>}
    {refreshing && <p role="status">Refreshing the saved view; existing data remains visible.</p>}
    {error && <div role="alert" className="home-notice">Could not refresh stock ideas: {error}. {data ? 'Showing the last successful saved view; its run is unchanged.' : 'Research remains available below.'}</div>}
    <div className="home-ranking">
      <section className="home-panel" aria-labelledby="ranking-heading"><div className="home-section-title"><h2 id="ranking-heading">Saved stock ranking</h2><span>{ideas.length} shown</span></div><p className="home-caption">Score × 100, not a return or probability. Rank is separate from portfolio inclusion.</p>
        {!loading && !ideas.length && <div className="home-empty"><h3>{scoreStatusLabel(data?.score_status)}</h3><p>No ranking is invented or rebuilt from today's weights. A completed run with a valid saved snapshot is needed.</p></div>}
        <div className="home-stock-list">{ideas.map(idea => <button key={idea.ticker} className="home-stock-row" aria-pressed={stock?.ticker === idea.ticker} onClick={() => setSelected(idea.ticker)}><span className="home-rank">{idea.rank}</span><span className="home-stock-name"><strong>{idea.ticker}</strong><small>{idea.sector || 'Sector not retained'}<br />{idea.gate_flags?.confidence === true ? 'Saved confidence gate met' : idea.gate_flags?.confidence === false ? 'Saved confidence gate not met' : 'Gate status unavailable'}</small></span><strong className="home-score">{formatSavedScore(idea.final_score)}</strong></button>)}</div>
      </section>
      <section className="home-panel" aria-labelledby="explanation-heading"><p className="home-eyebrow">Read the selected stock</p><h2 id="explanation-heading">{stock ? `${stock.ticker} / Behind the score` : 'Behind the score'}</h2>{stock ? <>
        <h3>Why this ranks here</h3><p>The saved pipeline placed {stock.ticker} at rank {stock.rank}, with a score of {formatSavedScore(stock.final_score)}. Exact contribution parts were not retained; we cannot attribute that total to individual programs.</p>
        <h3>Where programs differ</h3><p className="home-caption">Recorded raw scores × 100. These use different heuristics and shared inputs, not independent votes or weighted contributions.</p>
        {assessments.length ? <div className="home-assessments">{assessments.map(([name, value]) => <div key={name}><span>{name.replace(/_/g, ' ')}</span><strong>{formatSavedScore(value)}</strong></div>)}</div> : <p>No raw program scores were retained.</p>}
        <details><summary>Missing inputs and scoring limits</summary><p>The saved summary does not retain per-program input dates, confidence, exclusion reasons, effective weights or the score denominator. A raw zero is a recorded value, not missing data. Do not infer freshness or program availability from a connected page.</p><p>Confidence-gate status is only the saved gate decision. It is not a calibrated chance of profit or a full portfolio suitability check.</p></details>
        {!preview && <Link to={`/research?ticker=${encodeURIComponent(stock.ticker)}`}>Open company research and score history →</Link>}
      </> : <p>Select a stock when a saved ranking is available. Historical research does not depend on the ranking loading.</p>}</section>
    </div>
    <section aria-labelledby="research-heading"><div className="home-section-title"><div><p className="home-eyebrow">Keep the findings, including the negatives</p><h2 id="research-heading">Research findings</h2></div>{!preview && <Link to="/experiments">All studies →</Link>}</div><p className="home-caption">Reviewed research snapshot / {research.reviewedOn}. Curated checkpoint, not a live feed or the full experiment population. {checkpointAgeNotice(research)}</p>
      <div className="home-filters" aria-label="Filter research">{['all', 'qualified', 'negative', 'inconclusive', 'pending'].map(status => <button key={status} aria-pressed={researchFilter === status} onClick={() => setResearchFilter(status)}>{status === 'all' ? 'All findings' : status}</button>)}</div>
      <div className="home-research-grid">{availableResearch.map(item => <article className="home-panel" key={item.id}><p className="home-eyebrow">{item.ticker} / {item.status === 'pending' ? 'Outcome pending in snapshot' : item.status}</p><h3>{item.title}</h3><p>{item.finding}</p><details><summary>Limits and next evidence</summary><p>{item.limitation}</p><p>{item.nextStep}</p><p>Recorded: {item.recordedAt}<br />Period: {item.period}</p></details><a href={item.source.url} target="_blank" rel="noreferrer">Read source ↗</a></article>)}</div>
    </section>
    <section className="home-panel" aria-labelledby="idea-voting-heading"><p className="home-eyebrow">Voting demo / separate from the model</p><h2 id="idea-voting-heading">Which question deserves more research?</h2><p>Personal idea votes are kept only while this page is open. They are not sent to a server, do not launch work, and never change stock scores, signals or trades.</p><div className="home-voting">{questions.map(question => <article key={question.id}><h3>{question.title}</h3><p>{question.detail}</p><button aria-pressed={votes.includes(question.id)} onClick={() => setVotes(current => toggleIdeaVote(current, question.id))}>{votes.includes(question.id) ? 'Voted · Undo' : 'Vote for this idea'}</button></article>)}</div><p role="status" className="home-caption">{votes.length} personal {votes.length === 1 ? 'vote' : 'votes'} selected on this page.</p></section>
    {!preview && <nav className="home-secondary" aria-label="Research tools"><Link to="/overview">Previous overview</Link><Link to="/signals">Signals</Link><Link to="/data">Source health</Link><Link to="/compare">Compare companies</Link><Link to="/lab">Lab</Link></nav>}
  </div>;
}

export default function StockIdeas() {
  const { data, loading, error, refetch } = useDashboard('overview');
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try { await refetch(); } finally { setRefreshing(false); }
  };
  return <StockIdeasView data={data} loading={loading} refreshing={refreshing} error={error} refetch={refresh} />;
}
