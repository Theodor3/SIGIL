import SavedScoreHistory from '../components/SavedScoreHistory';
import { useState } from 'react';
import { StockIdeasView, type HomeData } from './StockIdeas';
import type { ScoreStatus } from '../lib/savedScores';
const demo: HomeData = {
  score_status: 'saved' as const,
  pipeline: { run_id: 'SYNTHETIC-DESIGN-RUN', last_run: 'Illustrative, not a real run', status: 'completed' },
  top_ideas: [
    { rank: 1, ticker: 'DEMO-A', final_score: .731, sector: 'Illustrative industrial', signal_scores: { value: .91, quality: .71, momentum: .38 }, gate_flags: { confidence: true } },
    { rank: 2, ticker: 'DEMO-B', final_score: .642, sector: 'Illustrative technology', signal_scores: { value: .48, quality: .85, momentum: .67 }, gate_flags: { confidence: false } },
    { rank: 3, ticker: 'DEMO-ZERO', final_score: 0, sector: 'Zero is a recorded value', signal_scores: { value: 0, quality: 0 }, gate_flags: { confidence: true } },
  ],
};
export default function StockIdeasPreview() {
  const [state, setState] = useState('saved');
  return <div className="home-preview-shell"><div className="home-preview-brand">SIGIL<span>Stock-first home / isolated review build</span></div><div className="stock-home" style={{marginBottom:24}}><label>Preview state <select aria-label="Preview state" value={state} onChange={event => setState(event.target.value)} style={{background:'#15202d',color:'#e8edf4',padding:10,marginLeft:12}}><option value="saved">Saved examples</option><option value="legacy_unavailable">Older run without scores</option><option value="no_run">No completed run</option><option value="error">Refresh error</option></select></label></div><StockIdeasView preview data={{...demo, score_status: (state === 'error' ? 'saved' : state) as ScoreStatus, ...(state === 'no_run' ? {pipeline:{run_id:null,last_run:null,status:'never_run'}} : {})}} error={state === 'error' ? 'Synthetic HTTP 503' : null} /><div className="stock-home" style={{marginTop:28}}><p className="home-notice">Synthetic score-history example: the unavailable middle run remains a gap.</p><SavedScoreHistory points={[{date:'2026-11-01T12:00:00Z',run_id:'DEMO-1',score:.61,score_status:'saved',signals:{}},{date:'2026-11-02T12:00:00Z',run_id:'DEMO-2',score:null,score_status:'legacy_unavailable',signals:{}},{date:'2026-11-03T12:00:00Z',run_id:'DEMO-3',score:.73,score_status:'saved',signals:{}}]} /></div></div>;
}
