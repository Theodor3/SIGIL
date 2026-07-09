import { useEffect, useState } from "react";

interface ExecAgg {
  orders: number;
  filled: number;
  unfilled: number;
  traded_notional: number;
  cost_dollars: number;
  avg_slippage_bps: number;
}

interface ExecQualityData {
  window_days: number;
  cumulative: ExecAgg;
  by_day: ({ date: string } & ExecAgg)[];
}

function costColor(v: number) {
  if (v <= 0) return "text-sigil-accent";
  return "text-sigil-danger";
}

export default function ExecutionQuality() {
  const [data, setData] = useState<ExecQualityData | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/portfolio/execution-quality")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!data || data.cumulative.orders === 0) return null;

  const c = data.cumulative;

  return (
    <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider">
          Execution Quality
        </h2>
        <span className="text-[10px] text-sigil-muted">
          last {data.window_days}d · fill price vs planning quote
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
        <div className="text-center">
          <div className="text-sigil-muted text-xs mb-1">Churn Cost</div>
          <div className={`text-lg font-bold ${costColor(c.cost_dollars)}`}>
            ${Math.abs(c.cost_dollars).toFixed(0)}
            {c.cost_dollars < 0 ? " earned" : ""}
          </div>
        </div>
        <div className="text-center">
          <div className="text-sigil-muted text-xs mb-1">Avg Slippage</div>
          <div className={`text-lg font-bold ${costColor(c.avg_slippage_bps)}`}>
            {c.avg_slippage_bps.toFixed(1)} bps
          </div>
        </div>
        <div className="text-center">
          <div className="text-sigil-muted text-xs mb-1">Traded</div>
          <div className="text-lg font-bold text-sigil-text">
            ${(c.traded_notional / 1000).toFixed(1)}k
          </div>
          <div className="text-sigil-muted text-[10px]">{c.filled} fills</div>
        </div>
        <div className="text-center">
          <div className="text-sigil-muted text-xs mb-1">Unfilled</div>
          <div className="text-lg font-bold text-sigil-text">{c.unfilled}</div>
        </div>
      </div>

      {data.by_day.length > 0 && (
        <div className="space-y-1">
          {data.by_day.slice(0, 5).map((d) => (
            <div
              key={d.date}
              className="flex justify-between text-[11px] text-sigil-muted rounded bg-sigil-bg border border-sigil-border/30 px-2 py-1"
            >
              <span>{d.date}</span>
              <span>
                {d.orders} orders · ${(d.traded_notional / 1000).toFixed(1)}k
              </span>
              <span className={costColor(d.cost_dollars)}>
                ${d.cost_dollars.toFixed(0)} · {d.avg_slippage_bps.toFixed(1)} bps
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
