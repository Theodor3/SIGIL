import type { ScoreStatus } from './savedScores';

export interface SavedScorePoint {
  date: string;
  score: number | null;
  run_id: string;
  score_status?: ScoreStatus;
  signals: Record<string, number>;
}

// Only persisted, explicitly valid scores can be plotted. Never impute a gap.
export function prepareScoreHistory(points: SavedScorePoint[]) {
  return points.map(point => ({
    ...point,
    timestamp: Date.parse(point.date),
    plottedScore: point.score_status === 'saved' && typeof point.score === 'number' && Number.isFinite(point.score)
      ? point.score * 100 : null,
  })).sort((a, b) => {
    const at = Number.isFinite(a.timestamp) ? a.timestamp : Infinity;
    const bt = Number.isFinite(b.timestamp) ? b.timestamp : Infinity;
    return at - bt || a.run_id.localeCompare(b.run_id);
  });
}
