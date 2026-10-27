import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { defaultConfig, evaluateStrategy, sampleDataset, strategyVersion, validateDataset } from "../lib/freightStrategy";
import type { Dataset, StrategyConfig } from "../lib/freightStrategy";
import "./StrategyLab.css";

type Result = ReturnType<typeof evaluateStrategy>;
type Run = { schemaVersion: 1; id: string; createdAt: string; strategyVersion: string; dataset: Dataset; config: StrategyConfig; result: Result };
const STORAGE_KEY = "sigil.strategy-lab.runs.v1";
const moneyPct = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const timestamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
function loadRuns(): Run[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  const data = JSON.parse(raw);
  if (data.schemaVersion !== 1 || !Array.isArray(data.runs)) throw new Error("Unsupported notebook");
  return data.runs.map((r: Run) => {
    if (!r || r.schemaVersion !== 1 || typeof r.id !== "string" || typeof r.createdAt !== "string" || !Number.isFinite(Date.parse(r.createdAt)) || r.strategyVersion !== strategyVersion) throw new Error("Unsupported run version");
    const dataset = validateDataset(r.dataset);
    // Reproduce saved inputs under their exact evaluator version before displaying a run.
    const result = evaluateStrategy(dataset, r.config);
    return { ...r, dataset, result };
  });
}
function initialHistory() {
  try { return { runs: loadRuns(), error: "" }; }
  catch { return { runs: [] as Run[], error: "Saved runs are unavailable or use an unsupported version. Existing storage has been preserved; export new results to retain them." }; }
}
function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function StrategyLab() {
  const [dataset, setDataset] = useState<Dataset>(sampleDataset);
  const [config, setConfig] = useState<StrategyConfig>({ ...defaultConfig });
  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState(initialHistory);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const pending = !!run && (JSON.stringify(run.config) !== JSON.stringify(config) || JSON.stringify(run.dataset) !== JSON.stringify(dataset));
  function evaluate() {
    setError(""); setNotice("");
    try {
      const result = evaluateStrategy(dataset, config);
      const next: Run = { schemaVersion: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), strategyVersion, dataset: structuredClone(dataset), config: { ...config }, result };
      setRun(next);
      try {
        const runs = [next, ...loadRuns()];
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, runs }));
        setHistory({ runs, error: "" });
        setNotice("Evaluation complete. The exact inputs and rule settings were saved in this browser.");
      } catch {
        setHistory(h => ({ ...h, error: "Evaluation completed, but this run could not be saved. Storage may be full, disabled or unsupported. Export the result to keep it." }));
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Evaluation failed. Check the inputs."); }
  }
  async function importDataset(file: File | undefined) {
    if (!file) return;
    setImporting(true); setError(""); setNotice("");
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Choose a JSON file smaller than 5 MB.");
      const parsed = validateDataset(JSON.parse(await file.text()));
      setDataset(parsed);
      setNotice(parsed.kind === "synthetic" ? "Synthetic file validated and loaded. Its invented-data label is preserved; no real performance evidence is implied. Run evaluation to compute a new result." : "File validated and loaded. Imported prices, timestamps and provenance remain unverified. Run evaluation to compute a new result.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not read the dataset."); }
    finally { setImporting(false); if (upload.current) upload.current.value = ""; }
  }
  function openRun(saved: Run) {
    setRun(saved); setDataset(saved.dataset); setConfig({ ...saved.config }); setError("");
    setNotice("Saved inputs restored and reproduced with the same evaluator version. No new run was recorded.");
  }
  return <div className="strategy-lab">
    <nav className="strategy-nav" aria-label="Strategy research navigation"><Link to="/ripple-lab">SIGIL <span>RESEARCH</span></Link><div><Link to="/ripple-lab">Ripple lab ↗</Link><a href="#strategy-history">Run history ↓</a></div></nav>
    <header className="strategy-hero"><div><p className="strategy-kicker">STRATEGY WORKBENCH / EXPERIMENT 01</p><h1>Turn a story<br/>into <em>a test.</em></h1><p>Can freight weakness help decide when to hold CSX and when to hold cash? Define one rule, account for costs, and compare it with simply holding the stock.</p></div><div className="strategy-hero-card"><span>THE EXPERIMENT</span><strong>CSX <i>⇄</i> CASH</strong><p>Long or flat. One position.<br/>No parameter search.</p><div>Experimental · Not validated</div></div></header>
    <div className={`strategy-banner ${dataset.kind === "synthetic" ? "synthetic" : "imported"}`}><b>{dataset.kind === "synthetic" ? "SYNTHETIC EXAMPLE" : "IMPORTED / UNVERIFIED"}</b><span>{dataset.kind === "synthetic" ? "Invented events and prices demonstrate the evaluator. Returns do not show a real trading edge." : "Schema checks passed. That does not establish point-in-time availability, correct prices or authentic evidence."}</span></div>
    <div className="strategy-workspace"><section className="strategy-panel strategy-setup"><p className="strategy-kicker">01 / FIX THE RULE</p><h2>Freight weakness → cash</h2><p>For each event, compare evaluation carloads with its baseline. A decline at or above the threshold stays in cash; otherwise enter CSX after the event.</p>
      <div className="strategy-fields"><label>Decline threshold <span>%</span><input aria-label="Decline threshold percent" type="number" min="0" max="100" step="0.5" value={Number.isNaN(config.declineThresholdPct) ? "" : config.declineThresholdPct} onChange={e => setConfig(c => ({ ...c, declineThresholdPct: e.target.value === "" ? NaN : Number(e.target.value) }))}/></label><label>Holding period <span>calendar days</span><input aria-label="Holding period calendar days" type="number" min="1" max="3650" step="1" value={Number.isNaN(config.holdingCalendarDays) ? "" : config.holdingCalendarDays} onChange={e => setConfig(c => ({ ...c, holdingCalendarDays: e.target.value === "" ? NaN : Number(e.target.value) }))}/></label><label>Cost per side <span>basis points</span><input aria-label="Cost per side basis points" type="number" min="0" max="9999" step="1" value={Number.isNaN(config.costBpsPerSide) ? "" : config.costBpsPerSide} onChange={e => setConfig(c => ({ ...c, costBpsPerSide: e.target.value === "" ? NaN : Number(e.target.value) }))}/></label></div>
      <p className="strategy-small">10 basis points = 0.10% per side. Entry uses the first available close on a strictly later UTC date than first observation. Exit uses the first close on or after the holding horizon.</p>
      <details><summary>Execution and comparison rules</summary><p>Only one position can be open. Events observed while a position is held, including its exit date, are ignored. Missing full-horizon exits are reported, not filled with imagined prices or closed at an arbitrary last observation. Cash earns zero. The common comparison window spans all complete candidate horizons, before cash and overlap decisions. Buy-and-hold pays entry and exit costs once. Net trade return = (exit / entry) × (1 − cost per side)² − 1. These are simplified execution assumptions, not a portfolio recommendation.</p></details>
      <button className="strategy-primary" onClick={evaluate} disabled={importing}>Run evaluation <span>↗</span></button>
    </section><section className="strategy-panel strategy-data"><p className="strategy-kicker">02 / INSPECT THE INPUTS</p><div className="strategy-section-heading"><h2>{dataset.label}</h2><span className="strategy-pill">{dataset.kind}</span></div><div className="strategy-input-counts"><div><strong>{dataset.events.length}</strong><span>freight events</span></div><div><strong>{dataset.prices.length}</strong><span>price observations</span></div><div><strong>CSX</strong><span>single instrument</span></div></div>
      <p>Each event needs its reporting period, first-observed timestamp, baseline and evaluation carloads, and a source URL. Preserve the original evidence behind every imported value.</p>
      <div className="strategy-actions"><button className="strategy-secondary" disabled={importing} onClick={() => upload.current?.click()}>{importing ? "Reading file…" : "Import JSON ↑"}</button><button className="strategy-secondary" onClick={() => downloadJson(sampleDataset, "sigil-freight-synthetic-template.json")}>Download template ↓</button><button className="strategy-text-button" onClick={() => { setDataset(sampleDataset); setError(""); setNotice("Synthetic example loaded. Run evaluation to compute its result."); }}>Use synthetic example</button><input ref={upload} type="file" accept=".json,application/json" aria-label="Import strategy dataset JSON" onChange={e => void importDataset(e.target.files?.[0])} hidden/></div>
      <details><summary>Preview event data</summary><div className="strategy-table-scroll"><table><thead><tr><th>Event</th><th>Period end</th><th>First observed (UTC)</th><th>Baseline</th><th>Evaluation</th></tr></thead><tbody>{dataset.events.slice(0, 8).map(e => <tr key={e.id}><td>{e.id}</td><td>{e.periodEnd}</td><td>{new Date(e.firstObservedAt).toISOString()}</td><td>{e.baselineCarloads.toLocaleString()}</td><td>{e.evaluationCarloads.toLocaleString()}</td></tr>)}</tbody></table></div>{dataset.events.length > 8 && <p className="strategy-small">Showing the first 8 events. Exported results retain every input event.</p>}</details>
      <div className="strategy-data-note"><strong>A timestamp is a claim, not proof.</strong><p>The CSX audit has unresolved original publication timing and revision risk. Never substitute a period-end date for first public availability. Use consistent units, separately preserve originated and received counts, and avoid double-counting commodity subgroups.</p><Link to="/ripple-lab">Review the research assumptions →</Link></div>
    </section></div>
    {error && <p className="strategy-alert" role="alert">{error}</p>}{notice && <p className="strategy-notice" role="status">{notice}</p>}{history.error && <p className="strategy-alert" role="alert">{history.error}</p>}
    <section className="strategy-results" aria-label="Evaluation results"><div className="strategy-section-heading"><div><p className="strategy-kicker">03 / LET THE NUMBERS DISAGREE</p><h2>{run ? "The evaluation" : "Ready for the first test."}</h2></div>{run && <button className="strategy-secondary" onClick={() => downloadJson(run, `sigil-strategy-${run.id}.json`)}>Export reproducible result ↓</button>}</div>
      {!run ? <div className="strategy-empty"><span>↗ ↘</span><h3>No result yet.</h3><p>Run the synthetic example to inspect the mechanics. A good-looking demonstration is not evidence that this strategy works.</p></div> : <>
        {pending && <div className="strategy-banner imported"><b>INPUTS CHANGED</b><span>The results below belong to the previous run. Run evaluation to apply your current settings.</span></div>}
        <div className="strategy-run-label"><span>{run.dataset.kind === "synthetic" ? "SYNTHETIC RESULT" : "IMPORTED DATA · UNVERIFIED"} / {run.dataset.label}</span><span>{timestamp(run.createdAt)} · {run.strategyVersion}</span></div>
        <p className="strategy-result-caveat">Aggregate counts do not verify eight complete reporting weeks, comparable definitions, revisions or original publication timing. {run.dataset.kind === "synthetic" ? "These invented results establish no profitability or investment edge." : "Imported results remain exploratory until their underlying evidence is verified."}</p>
        <div className="strategy-metrics"><div><span>Strategy · net return</span><strong>{run.result.metrics.evaluatedStart ? moneyPct(run.result.metrics.totalReturnPct) : "—"}</strong><small>After modeled entry / exit costs</small></div><div><span>Buy & hold · net return</span><strong>{run.result.metrics.evaluatedStart ? moneyPct(run.result.metrics.buyHoldReturnPct) : "—"}</strong><small>CSX · same evaluation window</small></div><div><span>Excess over buy & hold</span><strong>{run.result.metrics.evaluatedStart ? `${run.result.metrics.excessReturnPct > 0 ? "+" : ""}${run.result.metrics.excessReturnPct.toFixed(2)}` : "—"} <em>pp</em></strong><small>Difference in percentage points</small></div><div><span>Maximum drawdown</span><strong>{run.result.metrics.evaluatedStart ? `${run.result.metrics.maxDrawdownPct.toFixed(2)}%` : "—"}</strong><small>Strategy equity · close observations</small></div></div>
        <div className="strategy-panel strategy-chart"><div className="strategy-section-heading"><div><h3>Two paths from the same starting point.</h3><p className="strategy-small">Equity normalized to 1.00 · {run.result.metrics.evaluatedStart ?? "No complete window"} → {run.result.metrics.evaluatedEnd ?? "—"}</p></div><span className="strategy-pill">{run.result.metrics.tradeCount} trades · {run.result.metrics.evaluatedStart ? `${run.result.metrics.exposureCalendarPct.toFixed(1)}% calendar exposure` : "Not evaluated"}</span></div>{run.result.equity.length ? <div className="strategy-chart-canvas" role="img" aria-label="Strategy and buy-and-hold equity across the evaluation window"><ResponsiveContainer width="100%" height="100%"><LineChart data={run.result.equity} margin={{ top: 20, right: 18, left: 0, bottom: 8 }}><CartesianGrid stroke="#2b3934" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" minTickGap={45} tick={{ fill: "#a4b3ab", fontSize: 10 }} tickLine={false} axisLine={false}/><YAxis domain={["auto", "auto"]} tickFormatter={v => Number(v).toFixed(2)} tick={{ fill: "#a4b3ab", fontSize: 10 }} tickLine={false} axisLine={false} width={48}/><Tooltip contentStyle={{ background: "#17231d", border: "1px solid #4d6556", borderRadius: 8 }} labelStyle={{ color: "#dbe9df" }} formatter={(value: number) => value.toFixed(4)}/><Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }}/><Line type="linear" dataKey="strategy" name="Freight rule" stroke="#b4f0c7" strokeWidth={2.5} dot={false} isAnimationActive={false}/><Line type="linear" dataKey="buyHold" name="CSX buy & hold" stroke="#d5b48b" strokeWidth={2} dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div> : <div className="strategy-empty"><p>No complete evaluation window is available. Inspect the skipped events below.</p></div>}</div>
        <div className="strategy-result-grid"><section className="strategy-panel"><h3>Every completed trade</h3><p className="strategy-small">Net returns include the configured cost on both sides. No leverage or short positions.</p><div className="strategy-table-scroll"><table><thead><tr><th>Event</th><th>Decline</th><th>Entry</th><th>Exit</th><th>Net return</th></tr></thead><tbody>{run.result.trades.map(t => <tr key={`${t.eventId}-${t.entryDate}`}><td>{t.eventId}</td><td>{moneyPct(t.declinePct)}</td><td>{t.entryDate}<small>{t.entryClose.toFixed(2)}</small></td><td>{t.exitDate}<small>{t.exitClose.toFixed(2)}</small></td><td>{moneyPct(t.netReturnPct)}</td></tr>)}</tbody></table></div>{!run.result.trades.length && <p className="strategy-small">No completed trades for these inputs.</p>}</section><section className="strategy-panel"><h3>Cash decisions & skipped events</h3><p className="strategy-small">These are part of the evidence. No event is silently converted into a profitable trade.</p>{run.result.skips.length ? <ul className="strategy-skip-list">{run.result.skips.map((s, i) => <li key={`${s.eventId}-${i}`}><strong>{s.eventId}</strong><span>{s.reason}</span></li>)}</ul> : <p className="strategy-small">No skipped events.</p>}</section></div>
        {run.result.warnings.length > 0 && <section className="strategy-panel strategy-warnings"><h3>Evaluation caveats</h3><ul>{run.result.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></section>}
      </>}
    </section>
    <section className="strategy-panel strategy-history" id="strategy-history"><div className="strategy-section-heading"><div><p className="strategy-kicker">04 / PRESERVE THE EXPERIMENT</p><h2>Run history <span>{history.runs.length}</span></h2></div><span className="strategy-small">Saved in this browser only</span></div><p>Every evaluation retains its data, settings, version and timestamp. Reopening reproduces those inputs. Repeated parameter changes count as additional experiments, not independent confirmation.</p>{history.runs.length ? <div className="strategy-history-list">{history.runs.map(r => <button key={r.id} className={run?.id === r.id ? "selected" : ""} onClick={() => openRun(r)}><span><b>{r.dataset.label}</b><small>{timestamp(r.createdAt)} · {r.dataset.kind}</small></span><span>{r.config.declineThresholdPct}% / {r.config.holdingCalendarDays}d / {r.config.costBpsPerSide}bps<small>{r.result.metrics.evaluatedStart ? `${moneyPct(r.result.metrics.totalReturnPct)} net` : "Not evaluated"} · {r.result.metrics.tradeCount} trades</small></span><span aria-hidden="true">↗</span></button>)}</div> : <p className="strategy-small">No saved evaluations yet.</p>}<p className="strategy-small">Device timestamps are not independently verified preregistration. Browser storage can be cleared; export important runs. Nothing is sent to a broker or saved to a shared research registry.</p></section>
    <footer className="strategy-footer"><span>One rule. Explicit assumptions. All outcomes retained.</span><span>Research prototype / {strategyVersion}</span></footer>
  </div>;
}
