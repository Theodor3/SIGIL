import type { ScoreStatus } from './savedScores';

export interface StockIdea {
  rank: number;
  ticker: string;
  final_score: number | null;
  signal_scores: Record<string, number>;
  score_status?: ScoreStatus;
  sector?: string;
  eligible?: boolean;
  gate_flags?: Record<string, boolean>;
}

// Never sort by votes or reconstruct a pipeline score using today's weights.
export function savedIdeas(ideas: StockIdea[], status?: ScoreStatus): StockIdea[] {
  if (status !== 'saved') return [];
  return ideas.filter(idea => Number.isInteger(idea.rank) && idea.rank > 0
    && typeof idea.final_score === 'number' && Number.isFinite(idea.final_score))
    .slice().sort((a, b) => a.rank - b.rank);
}

export function programAssessments(idea: StockIdea) {
  return Object.entries(idea.signal_scores ?? {}).filter(([, value]) => Number.isFinite(value))
    .sort((a, b) => b[1] - a[1]);
}

export function toggleIdeaVote(votes: string[], id: string): string[] {
  return votes.includes(id) ? votes.filter(value => value !== id) : [...votes, id];
}
