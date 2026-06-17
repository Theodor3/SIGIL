import { useCallback, useEffect, useState } from "react";

interface DataSource {
  name: string;
  provider: string;
  description: string;
  category: string;
  requires_key: boolean;
  key_env_var: string;
  status: string;
  last_fetch: string | null;
  last_fetch_count: number;
  last_error: string | null;
  config: Record<string, unknown>;
}

const CATEGORY_ORDER = [
  "fundamentals",
  "market",
  "universe",
  "earnings",
  "alt",
  "macro",
  "execution",
  "custom",
];

const CATEGORY_LABELS: Record<string, string> = {
  fundamentals: "Fundamentals",
  market: "Market Data",
  universe: "Universe",
  earnings: "Earnings",
  alt: "Alternative Data",
  macro: "Macro",
  execution: "Execution",
  custom: "Custom",
};

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-sigil-accent/20 text-sigil-accent border-sigil-accent/30",
    configured:
      "bg-blue-500/20 text-blue-400 border-blue-400/30",
    no_key: "bg-yellow-500/20 text-yellow-400 border-yellow-400/30",
    error: "bg-sigil-danger/20 text-sigil-danger border-sigil-danger/30",
    pending: "bg-sigil-muted/20 text-sigil-muted border-sigil-muted/30",
  };

  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border ${styles[status] || styles.pending}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function AddSourceModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (source: {
    name: string;
    provider: string;
    description: string;
    category: string;
    requires_key: boolean;
    key_env_var: string;
  }) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    provider: "",
    description: "",
    category: "custom",
    requires_key: false,
    key_env_var: "",
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-sigil-surface border border-sigil-border rounded-xl p-6 w-[500px] max-w-[90vw]">
        <h2 className="text-lg font-bold mb-4">Add Data Source</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-sigil-muted mb-1">
              Name (snake_case)
            </label>
            <input
              className="w-full bg-sigil-bg border border-sigil-border rounded-lg px-3 py-2 text-sm text-sigil-text focus:border-sigil-accent outline-none"
              placeholder="e.g. kalshi_predictions"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs text-sigil-muted mb-1">
              Provider
            </label>
            <input
              className="w-full bg-sigil-bg border border-sigil-border rounded-lg px-3 py-2 text-sm text-sigil-text focus:border-sigil-accent outline-none"
              placeholder="e.g. Kalshi API"
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs text-sigil-muted mb-1">
              Description
            </label>
            <textarea
              className="w-full bg-sigil-bg border border-sigil-border rounded-lg px-3 py-2 text-sm text-sigil-text focus:border-sigil-accent outline-none resize-none"
              rows={2}
              placeholder="What data does this source provide?"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-sigil-muted mb-1">
                Category
              </label>
              <select
                className="w-full bg-sigil-bg border border-sigil-border rounded-lg px-3 py-2 text-sm text-sigil-text focus:border-sigil-accent outline-none"
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value })
                }
              >
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c] || c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-sigil-muted mb-1">
                API Key Env Var
              </label>
              <input
                className="w-full bg-sigil-bg border border-sigil-border rounded-lg px-3 py-2 text-sm text-sigil-text focus:border-sigil-accent outline-none"
                placeholder="e.g. KALSHI_API_KEY"
                value={form.key_env_var}
                onChange={(e) => {
                  setForm({
                    ...form,
                    key_env_var: e.target.value,
                    requires_key: e.target.value.length > 0,
                  });
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-5 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-sigil-muted hover:text-sigil-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (form.name && form.provider) {
                onAdd(form);
                onClose();
              }
            }}
            disabled={!form.name || !form.provider}
            className="px-4 py-2 rounded-lg bg-sigil-accent text-sigil-bg font-semibold text-sm
                       hover:bg-sigil-accent/90 disabled:opacity-50 transition-all"
          >
            Add Source
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Data() {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    name: string;
    result: string;
  } | null>(null);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch("/api/data/sources");
      const json = await res.json();
      setSources(json);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  async function testSource(name: string) {
    setTesting(name);
    setTestResult(null);
    try {
      const res = await fetch(`/api/data/sources/${name}/test`, {
        method: "POST",
      });
      const json = await res.json();
      setTestResult({ name, result: JSON.stringify(json, null, 2) });
      await fetchSources();
    } catch {
      setTestResult({ name, result: "Connection failed" });
    } finally {
      setTesting(null);
    }
  }

  async function addSource(source: {
    name: string;
    provider: string;
    description: string;
    category: string;
    requires_key: boolean;
    key_env_var: string;
  }) {
    await fetch("/api/data/sources/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(source),
    });
    await fetchSources();
  }

  if (loading) return <div className="text-sigil-muted">Loading sources...</div>;

  const grouped = CATEGORY_ORDER.reduce(
    (acc, cat) => {
      const items = sources.filter((s) => s.category === cat);
      if (items.length > 0) acc[cat] = items;
      return acc;
    },
    {} as Record<string, DataSource[]>,
  );

  const activeCount = sources.filter((s) => s.status === "active").length;
  const pendingCount = sources.filter(
    (s) => s.status === "pending" || s.status === "no_key",
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Data Sources</h1>
          <p className="text-sigil-muted text-sm mt-1">
            {activeCount} active, {pendingCount} pending — manage providers
            that feed the pipeline
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 rounded-lg bg-sigil-accent text-sigil-bg font-semibold text-sm
                     hover:bg-sigil-accent/90 transition-all"
        >
          + Add Source
        </button>
      </div>

      {testResult && (
        <div className="rounded-xl border border-sigil-border bg-sigil-bg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-sigil-accent">
              Test: {testResult.name}
            </span>
            <button
              onClick={() => setTestResult(null)}
              className="text-sigil-muted text-xs hover:text-sigil-text"
            >
              dismiss
            </button>
          </div>
          <pre className="text-xs text-sigil-muted font-mono whitespace-pre-wrap">
            {testResult.result}
          </pre>
        </div>
      )}

      {Object.entries(grouped).map(([category, items]) => (
        <div key={category}>
          <h2 className="text-xs font-semibold text-sigil-muted uppercase tracking-wider mb-3">
            {CATEGORY_LABELS[category] || category}
          </h2>
          <div className="space-y-2">
            {items.map((source) => (
              <div
                key={source.name}
                className="rounded-xl border border-sigil-border bg-sigil-surface p-4 hover:border-sigil-accent/30 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-semibold text-sigil-text">
                        {source.provider}
                      </span>
                      <StatusBadge status={source.status} />
                      {source.requires_key && (
                        <span className="text-[10px] text-sigil-muted bg-sigil-bg px-1.5 py-0.5 rounded">
                          {source.key_env_var}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-sigil-muted">
                      {source.description}
                    </p>
                    {source.last_fetch && (
                      <div className="flex items-center gap-4 mt-2 text-xs text-sigil-muted">
                        <span>
                          Last fetch:{" "}
                          {new Date(source.last_fetch).toLocaleString()}
                        </span>
                        {source.last_fetch_count > 0 && (
                          <span>
                            {source.last_fetch_count} items
                          </span>
                        )}
                      </div>
                    )}
                    {source.last_error && (
                      <div className="mt-1 text-xs text-sigil-danger">
                        Error: {source.last_error}
                      </div>
                    )}
                    {source.config &&
                      Object.keys(source.config).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {Object.entries(source.config).map(([k, v]) => (
                            <span
                              key={k}
                              className="text-[10px] text-sigil-muted bg-sigil-bg px-2 py-0.5 rounded"
                            >
                              {k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}
                            </span>
                          ))}
                        </div>
                      )}
                  </div>
                  <button
                    onClick={() => testSource(source.name)}
                    disabled={testing === source.name}
                    className="ml-4 px-3 py-1.5 rounded-lg text-xs border border-sigil-border text-sigil-muted
                               hover:border-sigil-accent hover:text-sigil-accent disabled:opacity-50 transition-all shrink-0"
                  >
                    {testing === source.name ? "Testing..." : "Test"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="rounded-xl border border-dashed border-sigil-border/50 bg-sigil-surface/50 p-5">
        <h2 className="text-sm font-semibold text-sigil-muted mb-2">
          Want to add a new data source?
        </h2>
        <div className="text-xs text-sigil-muted space-y-1">
          <p>
            <strong className="text-sigil-text">API-based:</strong> Click "+ Add Source"
            above to register it. Then create a provider file at{" "}
            <code className="text-sigil-accent bg-sigil-bg px-1 rounded">
              api/data/your_source.py
            </code>{" "}
            extending the DataProvider base class.
          </p>
          <p>
            <strong className="text-sigil-text">Planned sources from V1:</strong>{" "}
            Prediction markets (Kalshi/Polymarket), Baltic Dry Index (FRED),
            ArXiv research papers, Ship/AIS vessel data.
          </p>
          <p>
            <strong className="text-sigil-text">Adding a signal from a source:</strong>{" "}
            Once the provider fetches data into PipelineContext, create a signal
            at{" "}
            <code className="text-sigil-accent bg-sigil-bg px-1 rounded">
              api/signals/your_signal.py
            </code>{" "}
            — the registry auto-discovers it.
          </p>
        </div>
      </div>

      {showAdd && (
        <AddSourceModal onClose={() => setShowAdd(false)} onAdd={addSource} />
      )}
    </div>
  );
}
