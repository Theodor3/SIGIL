import { useCallback, useEffect, useRef, useState } from "react";

interface SignalInfo {
  name: string;
  version: string;
  weight: number;
  category: string;
  group: string;
  description: string;
  tags: string[];
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
  view?: "full" | "overview";
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
  signal_groups: Record<string, { budget: number; signals: string[] }>;
  top_ideas: TopIdea[];
  portfolio: {
    holdings_count?: number;
    total_value?: number;
    is_demo?: boolean;
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

export function useDashboard(view: "full" | "overview" = "full") {
  const inFlight = useRef<{ view: string; controller: AbortController } | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (inFlight.current?.view === view) return;
    inFlight.current?.controller.abort();
    const controller = new AbortController();
    inFlight.current = { view, controller };
    try {
      const res = await fetch(view === "overview" ? "/api/dashboard-data?view=overview" : "/api/dashboard-data", { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (controller.signal.aborted) return;
      setData(json);
      setError(null);
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (inFlight.current?.controller === controller) inFlight.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    fetchData();
    return () => {
      inFlight.current?.controller.abort();
      inFlight.current = null;
    };
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
