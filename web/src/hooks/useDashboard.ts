import { useEffect, useState } from "react";

interface DashboardData {
  status: string;
  signals: Array<{
    name: string;
    version: string;
    weight: number;
    description: string;
  }>;
  regime: {
    regime_id: string;
    confidence: number;
    exposure: number;
  };
  top_ideas: unknown[];
  portfolio: {
    holdings_count: number;
    total_value: number;
  };
  pipeline: {
    last_run: string | null;
    status: string;
  };
}

export function useDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard-data")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}
