import { useEffect, useState } from "react";

interface Leg {
  orders: number;
  /** null until at least one order has a measurable value for this leg */
  bps: number | null;
  dollars: number;
}

interface Shortfall {
  orders: number;
  filled: number;
  unfilled: number;
  synthetic_fills: number;
  traded_notional: number;
  delay: Leg;
  execution: Leg;
  total_shortfall_bps: number | null;
  total_shortfall_dollars: number;
  avg_spread_bps: number | null;
}

/** Pre-correction rows: benchmarked against a one-sided ask captured at plan time,
 *  so not comparable with the shortfall figures. Reported separately, never mixed. */
interface LegacyAgg {
  orders: number;
  filled: number;
  unfilled: number;
  traded_notional: number;
  cost_dollars: number;
  avg_slippage_bps: number;
}

interface ExecQualityData {
  window_days: number;
  shortfall: Shortfall;
  shortfall_by_day: ({ date: string } & Shortfall)[];
  has_v2: boolean;
  legacy: LegacyAgg;
}

/** Positive is always a cost, so red above zero. */
function costColor(v: number | null) {
  if (v == null) return "text-sigil-muted";
  return v > 0 ? "text-sigil-danger" : "text-sigil-accent";
}

function bps(v: number | null) {
  return v == null ? "--" : `${v.toFixed(1)} bps`;
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

  if (!data) return null;
  const sf = data.shortfall;
  const legacy = data.legacy;
  if (!data.has_v2 && (!legacy || legacy.orders === 0)) return null;

  return (
    <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-sigil-muted uppercase tracking-wider">
          Execution Cost
        </h2>
        <span className="text-[10px] text-sigil-muted">
          last {data.window_days}d · vs arrival mid · positive = cost
        </span>
      </div>

      {!data.has_v2 ? (
        <p className="text-sigil-muted text-xs">
          No corrected measurements yet — these populate from the next rebalance.
          Earlier orders were benchmarked against a one-sided quote taken when the
          plan was built, which measured market drift rather than execution, so they
          are reported separately below rather than carried forward.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
            <div className="text-center">
              <div className="text-sigil-muted text-xs mb-1">Delay</div>
              <div className={`text-lg font-bold ${costColor(sf.delay.bps)}`}>
                {bps(sf.delay.bps)}
              </div>
              <div className="text-sigil-muted text-[10px]">
                decision → arrival
              </div>
            </div>
            <div className="text-center">
              <div className="text-sigil-muted text-xs mb-1">Execution</div>
              <div className={`text-lg font-bold ${costColor(sf.execution.bps)}`}>
                {bps(sf.execution.bps)}
              </div>
              <div className="text-sigil-muted text-[10px]">arrival → fill</div>
            </div>
            <div className="text-center">
              <div className="text-sigil-muted text-xs mb-1">Total</div>
              <div
                className={`text-lg font-bold ${costColor(sf.total_shortfall_bps)}`}
              >
                {bps(sf.total_shortfall_bps)}
              </div>
              <div className="text-sigil-muted text-[10px]">
                ${Math.abs(sf.total_shortfall_dollars).toFixed(0)}
                {sf.total_shortfall_dollars < 0 ? " gained" : " paid"}
              </div>
            </div>
            <div className="text-center">
              <div className="text-sigil-muted text-xs mb-1">Spread Paid</div>
              <div className="text-lg font-bold text-sigil-text">
                {bps(sf.avg_spread_bps)}
              </div>
              <div className="text-sigil-muted text-[10px]">
                ${(sf.traded_notional / 1000).toFixed(1)}k · {sf.filled} fills
              </div>
            </div>
          </div>

          {(sf.unfilled > 0 || sf.synthetic_fills > 0) && (
            <p className="text-sigil-muted text-[10px] mb-2">
              {sf.unfilled > 0 && `${sf.unfilled} unfilled`}
              {sf.unfilled > 0 && sf.synthetic_fills > 0 && " · "}
              {sf.synthetic_fills > 0 &&
                `${sf.synthetic_fills} without a reported fill, excluded from the execution leg`}
            </p>
          )}

          {data.shortfall_by_day.length > 0 && (
            <div className="space-y-1">
              {data.shortfall_by_day.slice(0, 5).map((d) => (
                <div
                  key={d.date}
                  className="flex justify-between gap-2 text-[11px] text-sigil-muted rounded bg-sigil-bg border border-sigil-border/30 px-2 py-1"
                >
                  <span>{d.date}</span>
                  <span>
                    {d.orders} orders · ${(d.traded_notional / 1000).toFixed(1)}k
                  </span>
                  <span>
                    <span className={costColor(d.delay.bps)}>
                      {bps(d.delay.bps)}
                    </span>
                    {" + "}
                    <span className={costColor(d.execution.bps)}>
                      {bps(d.execution.bps)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {legacy && legacy.orders > 0 && (
        <div className="mt-3 pt-3 border-t border-sigil-border">
          <p className="text-sigil-muted text-[10px]">
            <span className="uppercase tracking-wider">Legacy</span> ·{" "}
            {legacy.orders} order{legacy.orders === 1 ? "" : "s"} measured against a
            plan-time ask, so buys read free and sells were charged a full spread:{" "}
            <span className="font-mono">
              {legacy.avg_slippage_bps.toFixed(1)} bps
            </span>{" "}
            on ${(legacy.traded_notional / 1000).toFixed(1)}k. Not comparable with
            the figures above.
          </p>
        </div>
      )}
    </div>
  );
}
