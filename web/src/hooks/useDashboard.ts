import { useCallback, useEffect, useState } from "react";

interface SignalInfo {
  name: string;
  version: string;
  weight: number;
  description: string;
  prediction_count: number;
}

interface TopIdea {
  rank: number;
  ticker: string;
  final_score: number;
  confidence: number;
  signal_scores: Record<string, number>;
  sector?: string;
}

interface PipelineRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  regime_id: string;
  universe_size: number;
}

interface DashboardData {
  status: string;
  signals: SignalInfo[];
  regime: {
    regime_id: string;
    confidence: number;
    exposure: number;
    factor_tilts: Record<string, number>;
    vol_state: string;
    breadth_state: string;
    indicators: {
      spy_20d: number | null;
      qqq_20d: number | null;
      vix: number | null;
    };
    history: Array<{
      date: string;
      regime_id: string;
      confidence: number;
    }>;
  };
  top_ideas: TopIdea[];
  portfolio: {
    holdings_count: number;
    total_value: number;
  };
  pipeline: {
    last_run: string | null;
    status: string;
    run_id: string | null;
    universe_size: number;
    duration: number | null;
  };
  recent_runs: PipelineRun[];
  data_sources?: Array<{
    name: string;
    provider: string;
    description: string;
    category: string;
    status: string;
    requires_key: boolean;
    last_fetch: string | null;
    last_fetch_count: number;
    last_error: string | null;
  }>;
}

export function useDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard-data");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
