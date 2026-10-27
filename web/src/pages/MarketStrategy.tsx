import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { evaluateTrend, evaluatePassiveMix, trendStrategyVersion } from "../lib/trendStrategy";
import type { TrendDataset } from "../lib/trendStrategy";
import "./StrategyLab.css";
import "./MarketStrategy.css";

type Snapshot = TrendDataset & { sha256: string; limitations?: string[] };
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const periods = [{ id: "full", label: "Full usable history", startDate: undefined }, { id: "recent", label: "2023 onward", startDate: "2023-01-01" }] as const;
function exportResult(value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = "sigil-spy-trend-research.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function MarketStrategy() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<"full" | "recent">("full");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/research/spy-history.json", { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error(`The market snapshot could not be loaded (${r.status}).`);
      const snapshot: Snapshot = await r.json();
      evaluateTrend(snapshot);
      if (typeof snapshot.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(snapshot.sha256)) throw new Error("The snapshot is missing its source-file fingerprint.");
      setData(snapshot);
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "The snapshot could not be read."); });
    return () => controller.abort();
  }, []);
  const evaluations = useMemo(() => {
    if (!data) return null;
    try { return { results: periods.map(p => evaluateTrend(data, { startDate: p.startDate, costBpsPerSide: 10 })), mixes: periods.map(p => evaluatePassiveMix(data, { startDate: p.startDate, costBpsPerSide: 10 })), error: "" }; }
    catch (err) { return { results: [], mixes: [], error: err instanceof Error ? err.message : "Evaluation failed." }; }
  }, [data]);
  const result = evaluations?.results[period === "full" ? 0 : 1];
  const metrics = result?.metrics;
  const mix = evaluations?.mixes[period === "full" ? 0 : 1];
  const chartData = result?.equity.map((row, i) => ({ ...row, passiveMix: mix?.equity[i]?.value }));
  return <main className="strategy-lab market-strategy">
    <nav className="strategy-nav" aria-label="Market research navigation"><Link to="/ripple-lab">SIGIL <span>RESEARCH</span></Link><div><Link to="/strategy-lab">Freight experiment ↗</Link><a href="#market-provenance">Data receipt ↓</a></div></nav>
    <header className="strategy-hero"><div><p className="strategy-kicker">REAL MARKET DATA / EXPERIMENT 02</p><h1>A simpler rule.<br /><em>A harder test.</em></h1><p>Can a broad-market trend rule reduce the damage from prolonged declines? Compare a fixed SPY / cash strategy with simply holding SPY, using the same dates and costs.</p></div><aside className="strategy-hero-card"><span>THE CANDIDATE</span><strong>SPY <i>⇄</i> CASH</strong><p>200 observations · one rule<br />10 basis points per trade side</p><div>Historical research · not a live signal</div></aside></header>
    <div className="strategy-banner imported"><b>REAL DATA, LIMITED CLAIMS</b><span>Current-vintage adjusted prices are a historical return proxy. This test does not establish a profitable or executable strategy.</span></div>
    <div className="strategy-workspace"><section className="strategy-panel"><p className="strategy-kicker">01 / FREEZE THE RULE</p><h2>Follow the market’s longer trend.</h2><p>After each close, compare SPY’s adjusted close with its trailing 200-observation average. Above it: hold SPY. At or below it: hold cash. Execute a change at the next supplied close.</p><div className="strategy-data-note"><strong>No parameter search</strong><p>The 200-observation window and 10-basis-point cost were fixed before this evaluation. Cash earns zero. No leverage, shorts, tax model or intraday execution assumptions are added.</p></div><p className="strategy-small market-reference">This is an adaptation of established trend research, not a new discovery. <a href="https://mebfaber.com/2009/02/19/a-quantitative-approach-to-tactical-asset-allocation-updated/" target="_blank" rel="noreferrer">Read the research background ↗</a></p></section>
    <section className="strategy-panel"><p className="strategy-kicker">02 / MAKE IT FALSIFIABLE</p><h2>Return and protection both matter.</h2><p>A lower drawdown alone is not a free improvement. Cash can miss recoveries, repeated reversals incur costs, and a trend rule can lag buy-and-hold for years.</p><div className="strategy-data-note"><strong>Why move beyond freight?</strong><p>The freight archive lacks verified original publication times. It cannot yet support an honest historical trading test. Price observations allow a directly testable timing rule; they do not remove adjustment and execution limitations.</p></div><p className="strategy-small market-reference">The 2023 onward slice is a later historical comparison, not an untouched holdout. Future results must be recorded prospectively before claiming validation.</p></section></div>
    {(error || evaluations?.error) && <p role="alert" className="strategy-alert">{error || evaluations?.error}</p>}
    {!data && !error && <p className="strategy-notice" role="status">Loading the saved market snapshot…</p>}
    {data && result && metrics && <section className="strategy-results">
      <div className="strategy-section-heading"><div><p className="strategy-kicker">03 / KEEP THE COMPARISON HONEST</p><h2>The observed trade-off</h2></div><button className="strategy-secondary" onClick={() => exportResult({ schemaVersion: 1, version: trendStrategyVersion, exportedAt: new Date().toISOString(), dataset: data, config: { lookback: 200, costBpsPerSide: 10, cashYield: 0 }, periods: evaluations?.results, passiveMix: { initialStockWeight: 0.7, rebalance: false, periods: evaluations?.mixes } })}>Export inputs & results ↓</button></div>
      <div className="market-periods" role="group" aria-label="Evaluation period">{periods.map(p => <button key={p.id} className={period === p.id ? "selected" : ""} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</button>)}</div>
      <p className="strategy-run-label">{metrics.startDate} → {metrics.endDate} · {metrics.observations.toLocaleString()} observations · {trendStrategyVersion}</p>
      <p className="strategy-result-caveat">{mix && metrics.cagrPct < mix.metrics.cagrPct && metrics.cagrPct < metrics.benchmarkCagrPct && metrics.maxDrawdownPct < metrics.benchmarkMaxDrawdownPct ? "Observed result: the trend rule reduced drawdowns but lagged both simple alternatives in annualized return. Even an initial 70% SPY / 30% cash allocation grew faster in this sample. No superior strategy has been established." : "Assess return and drawdown together. A favorable result in this historical sample does not establish future performance or overall superiority."}</p>
      <div className="strategy-metrics"><div><span>Trend · annualized net return</span><strong>{pct(metrics.cagrPct)}</strong><small>Buy & hold: {pct(metrics.benchmarkCagrPct)}</small></div><div><span>Trend · maximum drawdown</span><strong>{metrics.maxDrawdownPct.toFixed(2)}%</strong><small>Buy & hold: {metrics.benchmarkMaxDrawdownPct.toFixed(2)}%</small></div><div><span>Trend · total net return</span><strong>{pct(metrics.totalReturnPct)}</strong><small>Buy & hold: {pct(metrics.benchmarkReturnPct)}</small></div><div><span>Market exposure</span><strong>{metrics.exposurePct.toFixed(1)}%</strong><small>{metrics.transitions} trade sides · observed intervals</small></div></div>
      <section className="strategy-panel"><div className="strategy-section-heading"><div><h3>Same starting point. Different paths.</h3><p className="strategy-small">Normalized to 1.00; costs included. Signal observations precede execution.</p></div><span className="strategy-pill">No forecast shown</span></div><div className="strategy-chart-canvas" role="img" aria-label="Trend strategy, buy-and-hold and initial 70/30 allocation equity over time"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid stroke="#293d2e" strokeDasharray="3 5" /><XAxis dataKey="date" tick={{ fill: "#94aa8d", fontSize: 10 }} minTickGap={65} /><YAxis tick={{ fill: "#94aa8d", fontSize: 10 }} width={42} tickFormatter={n => Number(n).toFixed(1)} /><Tooltip contentStyle={{ background: "#18241a", border: "1px solid #42533c", fontSize: 11 }} formatter={(value: number) => value.toFixed(3)} /><Legend /><Line type="linear" dataKey="strategy" name="Trend / cash" stroke="#b4f0c7" dot={false} strokeWidth={2} isAnimationActive={false} /><Line type="linear" dataKey="buyHold" name="Buy & hold" stroke="#bbaa7e" dot={false} strokeWidth={1.5} isAnimationActive={false} /><Line type="linear" dataKey="passiveMix" name="Initial 70/30 · no rebalance" stroke="#91b8da" dot={false} strokeWidth={1.5} isAnimationActive={false} /></LineChart></ResponsiveContainer></div></section>
      <section className="strategy-panel market-comparison"><h3>Both historical periods, retained</h3><p className="strategy-small">The third comparator starts with 70% SPY and 30% zero-yield cash, then never rebalances. Its stock weight drifts. It is a simple alternative, not an equal-risk match, and was added after the initial trend results were reviewed.</p><div className="strategy-table-scroll"><table><thead><tr><th>Period</th><th>Trend CAGR</th><th>Hold CAGR</th><th>Initial 70/30 CAGR</th><th>Trend drawdown</th><th>Hold drawdown</th><th>Initial 70/30 drawdown</th></tr></thead><tbody>{evaluations.results.map((r, i) => <tr key={periods[i].id}><td>{periods[i].label}<small>{r.metrics.startDate} → {r.metrics.endDate}</small></td><td>{pct(r.metrics.cagrPct)}</td><td>{pct(r.metrics.benchmarkCagrPct)}</td><td>{pct(evaluations.mixes[i].metrics.cagrPct)}</td><td>{r.metrics.maxDrawdownPct.toFixed(2)}%</td><td>{r.metrics.benchmarkMaxDrawdownPct.toFixed(2)}%</td><td>{evaluations.mixes[i].metrics.maxDrawdownPct.toFixed(2)}%</td></tr>)}</tbody></table></div></section>
      <details className="strategy-panel"><summary>Inspect all trade sides ({result.transitions.length})</summary><div className="strategy-table-scroll market-trades"><table><thead><tr><th>Signal date</th><th>Execution date</th><th>Action</th><th>Reason</th></tr></thead><tbody>{result.transitions.map((t, i) => <tr key={`${t.date}-${i}`}><td>{t.signalDate}</td><td>{t.date}</td><td>{t.action}</td><td>{t.reason}</td></tr>)}</tbody></table></div></details>
      <section className="strategy-panel strategy-warnings"><h3>What these results cannot establish</h3><ul>{[...new Set([...result.warnings, ...(data.limitations || [])])].map((w, i) => <li key={i}>{w}</li>)}</ul></section>
    </section>}
    {data && <section className="strategy-panel market-provenance" id="market-provenance"><p className="strategy-kicker">SOURCE RECEIPT</p><h2>Real observations, with their limits attached.</h2><dl><div><dt>Instrument</dt><dd>{data.symbol} · {data.prices.length.toLocaleString()} observations</dd></div><div><dt>Coverage</dt><dd>{data.prices[0].date} → {data.prices[data.prices.length - 1].date}</dd></div><div><dt>Retrieved</dt><dd>{data.retrievedAt}</dd></div><div><dt>Source</dt><dd><a href={data.sourceUrl} target="_blank" rel="noreferrer">Yahoo Finance chart data ↗</a></dd></div><div><dt>Raw response SHA-256</dt><dd className="market-hash">{data.sha256}</dd></div></dl><p className="strategy-small">The receipt identifies the downloaded snapshot, not what an investor knew on each historical date. Adjusted close is used as a retrospective return proxy, not a price at which an order could have traded.</p></section>}
    <footer className="strategy-footer"><span>Test the rule. Retain the losses. Improve the evidence.</span><span>Research prototype / {trendStrategyVersion}</span></footer>
  </main>;
}
