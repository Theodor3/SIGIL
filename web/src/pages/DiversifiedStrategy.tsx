import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { evaluateDiversified, diversifiedVersion } from "../lib/diversifiedStrategy";
import type { DiversifiedDataset } from "../lib/diversifiedStrategy";
import "./StrategyLab.css";
import "./MarketStrategy.css";
import "./DiversifiedStrategy.css";

type Snapshot = DiversifiedDataset & { limitations?: string[] };
const periods = [{ id: "full", label: "Full usable history", startDate: undefined }, { id: "recent", label: "2023 onward", startDate: "2023-01-01" }] as const;
const costs = [10, 25] as const;
const percent = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
function download(value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "sigil-diversified-strategy-research.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function DiversifiedStrategy() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [period, setPeriod] = useState<"full" | "recent">("full");
  const [cost, setCost] = useState<10 | 25>(10);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setData(null); setError("");
    fetch("/research/diversified-history.json", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`The saved market snapshot could not be loaded (${response.status}).`);
      const snapshot: Snapshot = await response.json();
      evaluateDiversified(snapshot);
      if (current) setData(snapshot);
    }).catch(reason => { if (current) setError(reason instanceof Error && reason.name !== "AbortError" ? reason.message : "The snapshot request timed out. Please try again."); })
      .finally(() => clearTimeout(timeout));
    return () => { current = false; controller.abort(); clearTimeout(timeout); };
  }, [attempt]);
  const evaluations = useMemo(() => {
    if (!data) return null;
    try { return { cases: periods.flatMap(p => costs.map(fee => ({ period: p.id, label: p.label, costBpsPerSide: fee, result: evaluateDiversified(data, { startDate: p.startDate, costBpsPerSide: fee }) }))), error: "" }; }
    catch (reason) { return { cases: [], error: reason instanceof Error ? reason.message : "Evaluation failed." }; }
  }, [data]);
  const selected = evaluations?.cases.find(row => row.period === period && row.costBpsPerSide === cost);
  const result = selected?.result;
  const metrics = result?.metrics;
  const trend = metrics?.strategy, fixed = metrics?.benchmark;
  const fullBase = evaluations?.cases.find(row => row.period === "full" && row.costBpsPerSide === 10)?.result.metrics;
  const recentBase = evaluations?.cases.find(row => row.period === "recent" && row.costBpsPerSide === 10)?.result.metrics;
  const screen = fullBase && recentBase ? [
    { label: "Full-period drawdown reduced by at least 20% relative", passed: fullBase.strategy.maxDrawdownPct <= fullBase.benchmark.maxDrawdownPct * 0.8 + 1e-9 },
    { label: "Full-period CAGR lags by no more than 1 percentage point", passed: fullBase.strategy.cagrPct >= fullBase.benchmark.cagrPct - 1 - 1e-9 },
    { label: "2023 onward drawdown is no worse", passed: recentBase.strategy.maxDrawdownPct <= recentBase.benchmark.maxDrawdownPct + 1e-9 },
  ] : null;
  const verdict = trend && fixed ? trend.cagrPct < fixed.cagrPct
    ? `The trend rule earned less than fixed diversification in this window${trend.maxDrawdownPct < fixed.maxDrawdownPct - 1e-9 ? ", while reducing the maximum drawdown" : " and did not reduce the maximum drawdown"}. This is not an improvement on both measures.`
    : `The trend rule earned more than fixed diversification in this window${trend.maxDrawdownPct < fixed.maxDrawdownPct - 1e-9 ? " and had a smaller maximum drawdown" : ", but did not reduce the maximum drawdown"}. This retrospective result does not establish a future advantage.` : "";
  return <main className="strategy-lab market-strategy diversified-strategy">
    <nav className="strategy-nav" aria-label="Diversified research navigation"><Link to="/experiments">SIGIL <span>RESEARCH</span></Link><div><Link to="/experiments">All experiments ←</Link><Link to="/experiments/market-strategy">Earlier SPY test ↗</Link><a href="#diversified-provenance">Source receipts ↓</a></div></nav>
    <header className="strategy-hero"><div><p className="strategy-kicker">REAL MARKET DATA / EXPERIMENT 03</p><h1>Spread the risk.<br /><em>Test the rule.</em></h1><p>Can a monthly trend filter improve on simply holding a diversified portfolio? Four fixed sleeves, one defensive ETF, and the same costs on both sides of the comparison.</p></div><aside className="strategy-hero-card"><span>FOUR EQUAL SLEEVES</span><strong>25% × 4</strong><p>SPY · EFA · IEF · GLD<br />Off-trend allocation → BIL</p><div>Historical research · No live orders</div></aside></header>
    <div className="strategy-banner imported"><b>HISTORICAL TEST</b><span>Current-vintage adjusted closes provide return proxies. These results are retrospective, not a prospective validation or an executable trading record.</span></div>
    <div className="strategy-workspace">
      <section className="strategy-panel"><p className="strategy-kicker">01 / A FIXED RULE</p><h2>One decision at each month-end.</h2><p>At the last supplied close of a completed calendar month, compare each of SPY, EFA, IEF and GLD with its trailing 200-observation average. Above the average: assign that ETF 25%. Otherwise assign its 25% sleeve to BIL.</p><div className="strategy-data-note"><strong>Execution follows the signal</strong><p>Rebalance at the next supplied close. Existing holdings earn the intervening return first. All weights are funded after costs; there is no leverage, shorting or parameter search.</p></div></section>
      <section className="strategy-panel"><p className="strategy-kicker">02 / A FAIR COMPARISON</p><h2>Does timing earn its place?</h2><p>The benchmark rebalances to 25% in each of the same four assets on the same monthly dates. Both portfolios pay costs on traded amounts, including BIL purchases and sales, initial entry and final liquidation.</p><div className="strategy-data-note"><strong>BIL is an investment, not idle cash</strong><p>The defensive allocation uses a Treasury-bill ETF return proxy. Its distributions are already reflected in provider-adjusted returns; no separate interest is added. It carries price movement, fund costs and trading costs.</p></div></section>
    </div>
    {(error || evaluations?.error) && <div className="strategy-alert" role="alert"><p>{error || evaluations?.error}</p><button className="strategy-secondary" onClick={() => setAttempt(n => n + 1)}>Try loading again</button></div>}
    {!data && !error && <p className="strategy-notice" role="status">Loading the aligned five-ETF snapshot…</p>}
    {data && result && metrics && trend && fixed && <section className="strategy-results">
      <div className="strategy-section-heading"><div><p className="strategy-kicker">03 / OBSERVE THE TRADE-OFF</p><h2>Timing versus fixed diversification</h2></div><button className="strategy-secondary" onClick={() => download({ schemaVersion: 1, version: diversifiedVersion, exportedAt: new Date().toISOString(), dataset: data, design: { sleeves: { SPY: 0.25, EFA: 0.25, IEF: 0.25, GLD: 0.25 }, defensiveAsset: "BIL", lookbackObservations: 200, rebalance: "completed month-end signal; next supplied close execution", costsBpsPerSide: costs, extraCashInterest: 0 }, evaluations: evaluations?.cases })}>Export inputs & results ↓</button></div>
      <div className="diversified-controls"><div className="market-periods" role="group" aria-label="Evaluation period">{periods.map(p => <button key={p.id} className={period === p.id ? "selected" : ""} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</button>)}</div><div className="market-periods" role="group" aria-label="Trading cost sensitivity">{costs.map(fee => <button key={fee} className={cost === fee ? "selected" : ""} aria-pressed={cost === fee} onClick={() => setCost(fee)}>{fee} bps per side{fee === 25 ? " · stress" : " · base"}</button>)}</div></div>
      <p className="strategy-run-label">{metrics.startDate} → {metrics.endDate} · {metrics.observations.toLocaleString()} aligned observations · {diversifiedVersion}</p>
      <p className="strategy-result-caveat">{verdict}</p>
      {screen && <section className="strategy-panel diversified-screen"><p className="strategy-kicker">PREDECLARED SCREEN / 10 BPS</p><h3>{screen.every(check => check.passed) ? "Passed the historical screen" : "Did not pass the historical screen"}</h3><ul>{screen.map(check => <li key={check.label}><strong>{check.passed ? "PASS" : "FAIL"}</strong> {check.label}</li>)}</ul><p className="strategy-small">All three conditions are required. This screen was fixed before reviewing these results; passing it would justify further research, not establish statistical significance or authorize trading. The static comparator uses the same universe but is not an equal-risk portfolio. Reduced exposure alone is not evidence of alpha.</p></section>}
      <div className="strategy-metrics"><div><span>Trend · annualized net return</span><strong>{percent(trend.cagrPct)}</strong><small>Fixed mix: {percent(fixed.cagrPct)}</small></div><div><span>Trend · maximum drawdown</span><strong>{trend.maxDrawdownPct.toFixed(2)}%</strong><small>Fixed mix: {fixed.maxDrawdownPct.toFixed(2)}%</small></div><div><span>Trend · total net return</span><strong>{percent(trend.totalReturnPct)}</strong><small>Fixed mix: {percent(fixed.totalReturnPct)}</small></div><div><span>Average non-BIL exposure</span><strong>{trend.meanRiskExposurePct.toFixed(1)}%</strong><small>Observed intervals · weights drift between rebalances</small></div></div>
      <section className="strategy-panel"><h3>Same assets. Different allocation decisions.</h3><p className="strategy-small">Equity starts at 1.00 before entry costs. Both paths include trading costs and defensive ETF returns where held.</p><div className="strategy-chart-canvas" role="img" aria-label="Diversified trend and fixed diversified benchmark equity"><ResponsiveContainer width="100%" height="100%"><LineChart data={result.equity}><CartesianGrid stroke="#293d2e" strokeDasharray="3 5" /><XAxis dataKey="date" minTickGap={65} tick={{ fill: "#94aa8d", fontSize: 10 }} /><YAxis width={42} tick={{ fill: "#94aa8d", fontSize: 10 }} tickFormatter={n => Number(n).toFixed(1)} /><Tooltip contentStyle={{ background: "#18241a", border: "1px solid #42533c", fontSize: 11 }} formatter={(value: number) => value.toFixed(3)} /><Legend /><Line type="linear" dataKey="strategy" name="Diversified trend" stroke="#b4f0c7" dot={false} strokeWidth={2} isAnimationActive={false} /><Line type="linear" dataKey="benchmark" name="Fixed 25% sleeves" stroke="#bbaa7e" dot={false} strokeWidth={1.5} isAnimationActive={false} /></LineChart></ResponsiveContainer></div></section>
      <section className="strategy-panel market-comparison"><h3>Both periods, both cost assumptions</h3><p className="strategy-small">The 2023 onward slice is a later historical check, not an untouched holdout. The 25-basis-point case changes costs only; it does not retune the rule. Neither comparison establishes statistical significance.</p><div className="strategy-table-scroll"><table><thead><tr><th>Period / fee</th><th>Trend CAGR</th><th>Fixed CAGR</th><th>Trend drawdown</th><th>Fixed drawdown</th></tr></thead><tbody>{evaluations?.cases.map(row => <tr key={`${row.period}-${row.costBpsPerSide}`}><td>{row.label} · {row.costBpsPerSide} bps<small>{row.result.metrics.startDate} → {row.result.metrics.endDate}</small></td><td>{percent(row.result.metrics.strategy.cagrPct)}</td><td>{percent(row.result.metrics.benchmark.cagrPct)}</td><td>{row.result.metrics.strategy.maxDrawdownPct.toFixed(2)}%</td><td>{row.result.metrics.benchmark.maxDrawdownPct.toFixed(2)}%</td></tr>)}</tbody></table></div></section>
      <section className="strategy-panel market-comparison"><h3>The cost of changing allocations</h3><div className="strategy-table-scroll"><table><thead><tr><th>Portfolio</th><th>Gross turnover*</th><th>Costs / initial capital</th><th>Rebalances</th></tr></thead><tbody><tr><td>Diversified trend</td><td>{trend.turnover.toFixed(2)}×</td><td>{trend.costPctInitial.toFixed(2)}%</td><td>{trend.rebalanceCount}</td></tr><tr><td>Fixed sleeves</td><td>{fixed.turnover.toFixed(2)}×</td><td>{fixed.costPctInitial.toFixed(2)}%</td><td>{fixed.rebalanceCount}</td></tr></tbody></table></div><p className="strategy-small">*Sum of traded amounts divided by portfolio value at each execution, including entry and final liquidation. Cost totals are cash paid relative to initial capital, not the percentage-point difference in final return.</p></section>
      <details className="strategy-panel"><summary>Inspect monthly decisions ({result.rebalances.length})</summary><div className="strategy-table-scroll market-trades"><table><thead><tr><th>Signal date</th><th>Execution</th><th>Trend target weights</th><th>Trend fee*</th><th>Fixed fee*</th></tr></thead><tbody>{result.rebalances.map((row, i) => <tr key={`${row.date}-${i}`}><td>{row.signalDate}</td><td>{row.date}</td><td>{Object.entries(row.strategyTarget).map(([symbol, weight]) => `${symbol} ${(weight * 100).toFixed(0)}%`).join(" · ")}</td><td>{row.strategyFee.toFixed(6)}</td><td>{row.benchmarkFee.toFixed(6)}</td></tr>)}</tbody></table></div><p className="strategy-small">*Fees in units of initial capital, with initial capital = 1. Final liquidation is included in total costs and equity, but is not listed as a monthly decision. It is accounting at the test boundary, not a forecast.</p></details>
      <section className="strategy-panel strategy-warnings"><h3>What remains unproven</h3><ul>{[...new Set([...result.warnings, ...(data.limitations || [])])].map((warning, i) => <li key={i}>{warning}</li>)}</ul></section>
    </section>}
    {data && <section className="strategy-panel market-provenance" id="diversified-provenance"><p className="strategy-kicker">SOURCE RECEIPTS</p><h2>Five real series, one aligned calendar.</h2><p>{data.rows.length.toLocaleString()} aligned observations · {data.rows[0].date} → {data.rows[data.rows.length - 1].date}</p><p className="strategy-small">Retrieved {data.retrievedAt}. These receipts identify current downloaded bytes, not archived vintages or original publication times. Missing prices are not filled.</p><div className="diversified-sources">{data.sources.map(source => <article key={source.symbol}><h3>{source.symbol}</h3><a href={source.sourceUrl} target="_blank" rel="noreferrer">Inspect provider response ↗</a><p className="strategy-small">Retrieved {source.retrievedAt}</p><details><summary>Raw-response SHA-256</summary><code>{source.sha256}</code></details></article>)}</div></section>}
    <footer className="strategy-footer"><span>One fixed design. Negative findings retained.</span><span>Research prototype / {diversifiedVersion}</span></footer>
  </main>;
}
