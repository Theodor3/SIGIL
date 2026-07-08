import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Series hues validated (dataviz six-checks) against surface #12121a:
// lightness band, chroma floor, CVD separation, contrast all pass.
// SPY is additionally dashed so identity is never color-alone.
const EQUITY_COLOR = "#17a673";
const SPY_COLOR = "#6b6bc8";

interface EquityPoint {
  t: string;
  equity: number;
  cash: number | null;
  spy: number | null;
  regime: string | null;
}

interface EquityStats {
  start: string;
  end: string;
  return_pct: number;
  max_drawdown_pct: number;
  spy_return_pct: number | null;
  vs_spy_pct: number | null;
}

interface EquityHistory {
  points: EquityPoint[];
  stats: EquityStats | null;
}

const RANGES: { label: string; days: number }[] = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "All", days: 0 },
];

function pct(v: number | null | undefined): string {
  if (v == null) return "--";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function pctClass(v: number | null | undefined): string {
  if (v == null) return "text-sigil-muted";
  return v > 0 ? "text-sigil-accent" : v < 0 ? "text-sigil-danger" : "text-sigil-muted";
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dollars(v: number): string {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function CurveTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const point: EquityPoint | undefined = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="rounded-lg border border-sigil-border bg-sigil-bg/95 px-3 py-2 text-xs shadow-lg">
      <div className="text-sigil-muted mb-1">
        {new Date(label).toLocaleString(undefined, {
          month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        })}
        {point.regime ? ` · ${point.regime}` : ""}
      </div>
      <div className="flex items-center gap-2 text-sigil-text">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: EQUITY_COLOR }} />
        SIGIL&nbsp;
        <span className="font-semibold">
          ${point.equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      </div>
      {point.spy != null && (
        <div className="flex items-center gap-2 text-sigil-text">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: SPY_COLOR }} />
          SPY&nbsp;
          <span className="font-semibold">
            ${point.spy.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>
      )}
      {point.cash != null && (
        <div className="text-sigil-muted mt-1">
          cash ${point.cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
      )}
    </div>
  );
}

export default function EquityCurve() {
  const [history, setHistory] = useState<EquityHistory | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/portfolio/equity-history?days=${days}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setHistory(json);
      })
      .catch(() => {
        if (!cancelled) setHistory(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const points = history?.points ?? [];
  const stats = history?.stats ?? null;

  return (
    <div className="rounded-xl border border-sigil-border bg-sigil-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-4">
          <div className="text-sigil-muted text-xs uppercase tracking-wider">
            Equity Curve
          </div>
          {/* legend: identity carried by mark + dash + label, never color alone */}
          <div className="flex items-center gap-3 text-xs text-sigil-muted">
            <span className="flex items-center gap-1.5">
              <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke={EQUITY_COLOR} strokeWidth="2" /></svg>
              SIGIL
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke={SPY_COLOR} strokeWidth="2" strokeDasharray="5 3" /></svg>
              SPY (same capital)
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setDays(r.days)}
              className={`px-2.5 py-1 rounded-md text-xs transition-all ${
                days === r.days
                  ? "bg-sigil-accent/15 text-sigil-accent"
                  : "text-sigil-muted hover:text-sigil-text"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading && points.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-sigil-muted text-sm">
          Loading equity history...
        </div>
      ) : points.length < 2 ? (
        <div className="h-56 flex items-center justify-center text-sigil-muted text-sm">
          Collecting history — snapshots record hourly.
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={224}>
            <LineChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1e1e2e" vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={shortDate}
                tick={{ fill: "#6b6b8a", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={48}
              />
              <YAxis
                domain={["auto", "auto"]}
                tickFormatter={dollars}
                tick={{ fill: "#6b6b8a", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip
                content={<CurveTooltip />}
                cursor={{ stroke: "#6b6b8a", strokeDasharray: "3 3" }}
              />
              <Line
                type="monotone"
                dataKey="equity"
                stroke={EQUITY_COLOR}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="spy"
                stroke={SPY_COLOR}
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>

          {stats && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-xs">
              <span className="text-sigil-muted">
                Return{" "}
                <span className={`font-semibold ${pctClass(stats.return_pct)}`}>
                  {pct(stats.return_pct)}
                </span>
              </span>
              <span className="text-sigil-muted">
                Max drawdown{" "}
                <span className="font-semibold text-sigil-text">
                  {pct(stats.max_drawdown_pct)}
                </span>
              </span>
              <span className="text-sigil-muted">
                vs SPY{" "}
                <span className={`font-semibold ${pctClass(stats.vs_spy_pct)}`}>
                  {pct(stats.vs_spy_pct)}
                </span>
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
