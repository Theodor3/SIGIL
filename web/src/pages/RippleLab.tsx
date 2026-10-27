import { useState } from "react";
import { Link } from "react-router-dom";
import "./RippleLab.css";

const KEY = "sigil.ripple-lab.notebook.v1";
const MODEL = "freight-demand-illustration-v1";
const SOURCE = "https://www.stb.gov/wp-content/uploads/CSX_Methodology.pdf";
const channels = [
  { id: "csx", name: "CSX", category: "Rail operator", exposure: 1, elasticity: .7, lag: "1–4 weeks", mechanism: "Fewer shipments could reduce rail activity. Pricing, mix and contract terms may offset the revenue effect.", challenge: "A fall in reported carloads could reflect service disruption, seasonality or modal switching rather than weaker customer demand.", metric: "CSX originated carloads, by commodity", evidence: "The CSX methodology defines weekly originated and received counts by commodity (Item 11). It does not estimate a revenue sensitivity.", source: true },
  { id: "industrial", name: "Industrial shippers", category: "Customer channel", exposure: .6, elasticity: .5, lag: "2–8 weeks", mechanism: "A shared demand slowdown could reduce shipment requirements and production. Rail volume alone does not establish that causal direction.", challenge: "Inventory changes and shipment timing may move freight independently of end demand. No individual supplier or customer relationship is verified here.", metric: "Matched commodity shipments and customer production", evidence: "Illustrative sector relationship. No company-level customer link or calibrated effect has been established.", source: false },
  { id: "equipment", name: "Rail equipment", category: "Supplier channel", exposure: .4, elasticity: .8, lag: "1–4 quarters", mechanism: "Persistently lower utilization could delay equipment replacement or leasing demand.", challenge: "Long contracts, maintenance obligations and fleet age could dominate. A short freight dip may have no effect on orders.", metric: "Equipment orders, utilization and lease renewals", evidence: "Hypothesis only. No supplier contract or company exposure has been verified.", source: false },
  { id: "trucking", name: "Truck freight", category: "Alternative mode", exposure: .5, elasticity: .6, lag: "1–6 weeks", mechanism: "Under a broad demand shock, truck freight could weaken too. Under a rail disruption, substitution could instead help trucking.", challenge: "The sign depends on the cause of the shock. This example assumes weaker demand, not a rail outage.", metric: "Comparable truck volumes and spot rates", evidence: "Hypothesis only. Cross-mode substitution has not been measured in this example.", source: false },
];
type Outcome = { recordedAt: string; verdict: "supported" | "rejected" | "inconclusive"; note: string };
type RecordItem = { id: string; version: 1; createdAt: string; reviewAt: string; modelVersion: string; severity: number; transmission: number; channel: string; target: string; prediction: string; baseline: string; rejection: string; horizon: number; effect: number; assumptions: string; sources: string[]; outcomes: Outcome[] };
function validRecord(r: RecordItem): boolean {
  return !!r && r.version === 1 && [r.id, r.createdAt, r.reviewAt, r.modelVersion, r.channel, r.target, r.prediction, r.baseline, r.rejection, r.assumptions].every(x => typeof x === "string")
    && [r.createdAt, r.reviewAt].every(x => Number.isFinite(Date.parse(x)))
    && [r.severity, r.transmission, r.horizon, r.effect].every(Number.isFinite)
    && Array.isArray(r.sources) && r.sources.every(x => typeof x === "string")
    && Array.isArray(r.outcomes) && r.outcomes.every(o => o && Number.isFinite(Date.parse(o.recordedAt)) && ["supported", "rejected", "inconclusive"].includes(o.verdict) && typeof o.note === "string");
}
function readRecords(): RecordItem[] {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return [];
  const parsed = JSON.parse(raw);
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records) || !parsed.records.every(validRecord)) throw new Error("The saved notebook could not be read. Existing data has been preserved; saving is blocked.");
  return parsed.records;
}
function initialNotebook(): { records: RecordItem[]; error: string } {
  try { return { records: readRecords(), error: "" }; }
  catch { return { records: [], error: "Notebook storage is unavailable or contains an unsupported record. Existing data has been preserved." }; }
}
const formatDate = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const effectFor = (severity: number, transmission: number, channel: typeof channels[number]) => -(severity * transmission / 100 * channel.exposure * channel.elasticity);
const pct = (value: number) => `${value === 0 ? "0.0" : value.toFixed(1)}%`;
const defaultPrediction = (days: number) => `CSX originated non-intermodal carloads will decline at least 5% over the next ${days} calendar days versus the preceding ${days} days, using matched commodity categories.`;
const defaultBaseline = (days: number) => `Preceding ${days} calendar days; preserve weekly boundaries and record any partial-week exclusion. Compare seasonality separately.`;

export default function RippleLab() {
  const [severity, setSeverity] = useState(12);
  const [transmission, setTransmission] = useState(60);
  const [selected, setSelected] = useState("csx");
  const [notebook, setNotebook] = useState(initialNotebook);
  const [hypothesisTarget, setHypothesisTarget] = useState("csx");
  const [prediction, setPrediction] = useState(defaultPrediction(28));
  const [baseline, setBaseline] = useState(defaultBaseline(28));
  const [rejection, setRejection] = useState("Reject if the matched series declines less than 5%; mark inconclusive if categories, units or reporting periods cannot be reconciled.");
  const [horizon, setHorizon] = useState(28);
  const [message, setMessage] = useState("");
  const [outcomeFor, setOutcomeFor] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");
  const [verdict, setVerdict] = useState<Outcome["verdict"]>("inconclusive");
  const channel = channels.find(c => c.id === selected)!;
  const effect = effectFor(severity, transmission, channel);
  const hypothesisChannel = channels.find(c => c.id === hypothesisTarget)!;
  function changeHorizon(days: number) {
    if (prediction === defaultPrediction(horizon)) setPrediction(defaultPrediction(days));
    if (baseline === defaultBaseline(horizon)) setBaseline(defaultBaseline(days));
    setHorizon(days);
  }
  function changeTarget(target: string) {
    if (prediction === defaultPrediction(horizon) || !prediction.trim()) setPrediction(target === "csx" ? defaultPrediction(horizon) : "");
    setHypothesisTarget(target);
  }
  function persist(change: (records: RecordItem[]) => RecordItem[]) {
    try {
      const next = change(readRecords());
      localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 1, records: next }));
      setNotebook({ records: next, error: "" });
      return true;
    } catch { setNotebook(n => ({ ...n, error: "Could not save. Storage may be full, disabled or unsupported. Existing records have not been replaced." })); return false; }
  }
  function saveHypothesis(event: React.FormEvent) {
    event.preventDefault();
    if (![prediction, baseline, rejection].every(s => s.trim())) return;
    const now = new Date();
    const review = new Date(now); review.setDate(review.getDate() + horizon);
    const item: RecordItem = { id: crypto.randomUUID(), version: 1, createdAt: now.toISOString(), reviewAt: review.toISOString(), modelVersion: MODEL, severity, transmission, channel: hypothesisChannel.id, target: hypothesisChannel.name, prediction: prediction.trim(), baseline: baseline.trim(), rejection: rejection.trim(), horizon, effect: effectFor(severity, transmission, hypothesisChannel), assumptions: `Illustrative demand shock. Effect = -${severity}% shock × ${transmission / 100} transmission × ${hypothesisChannel.exposure} exposure × ${hypothesisChannel.elasticity} elasticity. Assumed lag: ${hypothesisChannel.lag}. Coefficients are invented for exploration, not fitted or observed. No security-return estimate.`, sources: hypothesisChannel.source ? [SOURCE] : [], outcomes: [] };
    if (persist(records => [item, ...records])) setMessage("Hypothesis saved with the current assumptions and timestamp. Review it when observations are available.");
  }
  function saveOutcome(event: React.FormEvent) {
    event.preventDefault();
    if (!outcomeNote.trim()) return;
    if (persist(records => {
      if (!records.some(r => r.id === outcomeFor)) throw new Error("Missing record");
      return records.map(r => r.id === outcomeFor ? { ...r, outcomes: [...r.outcomes, { recordedAt: new Date().toISOString(), verdict, note: outcomeNote.trim() }] } : r);
    })) { setOutcomeFor(""); setOutcomeNote(""); setMessage("Observation appended. The original hypothesis is unchanged."); }
  }
  function exportNotebook() {
    try {
      const records = readRecords();
      const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), records }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "sigil-ripple-notebook.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setMessage("Export unavailable: the saved notebook could not be read."); }
  }
  return <div className="ripple-lab">
    <nav className="ripple-topnav" aria-label="Research navigation"><Link to="/">SIGIL <span>RESEARCH</span></Link><div><Link to="/experiments/freight-strategy">Strategy lab ↗</Link><a href="#ripple-notebook">Notebook ↓</a><Link to="/experiments">Experiments ↗</Link></div></nav>
    <header className="ripple-hero"><div><p className="ripple-eyebrow">SIGIL / MARKET RIPPLE LAB</p><h1>One event.<br/><span>Many possible futures.</span></h1><p>Follow a freight slowdown through the economy. Change the assumptions, challenge the story, and keep a record of what you expected.</p></div><div className="ripple-orbit" aria-hidden="true"><i/><i/><i/><b>↗</b><span>FREIGHT / 01</span></div></header>
    <div className="ripple-disclosure"><span className="ripple-dot"/> Interactive scenario · Illustrative coefficients · No live market data or trading connection</div>
    <div className="ripple-workbench">
      <section className="ripple-panel ripple-controls"><p className="ripple-eyebrow">01 / THE EVENT</p><h2>Freight demand cools.</h2><p>A broad demand slowdown reduces shipments. This scenario does not represent a rail service outage.</p>
        <div className="ripple-presets">{[{ name: "Mild", value: 5 }, { name: "Material", value: 12 }, { name: "Severe", value: 25 }].map(p => <button key={p.name} aria-pressed={severity === p.value} onClick={() => setSeverity(p.value)}>{p.name}</button>)}</div>
        <label className="ripple-slider">Shipment decline <strong>{severity}%</strong><input type="range" min="0" max="30" value={severity} onChange={e => setSeverity(Number(e.target.value))}/><span>0% · No shock <span>30% · Severe</span></span></label>
        <label className="ripple-slider">Assumed transmission <strong>{transmission}%</strong><input type="range" min="0" max="100" step="5" value={transmission} onChange={e => setTransmission(Number(e.target.value))}/><span>Fully absorbed <span>Fully transmitted</span></span></label>
        <p className="ripple-caption">Transmission is the share of the demand shock passed into this illustrative model. It is not a probability or confidence score.</p>
      </section>
      <section className="ripple-panel ripple-map"><div className="ripple-section-heading"><div><p className="ripple-eyebrow">02 / TRACE THE RIPPLE</p><h2>Where could it travel?</h2></div><span className="ripple-chip">Demand shock</span></div><p>Select a channel to inspect its mechanism and strongest counterargument.</p>
        <div className="ripple-event"><span>INITIAL EVENT</span><strong>Freight shipments −{severity}%</strong><small>Hypothetical input</small></div>
        <div className="ripple-branches">{channels.map(c => <button key={c.id} className={`ripple-node ${selected === c.id ? "selected" : ""}`} aria-pressed={selected === c.id} onClick={() => { setSelected(c.id); setMessage(""); }}><span>{c.category}</span><strong>{c.name}</strong><b>{pct(effectFor(severity, transmission, c))}</b><small>Illustrative activity effect</small></button>)}</div>
        <p className="ripple-caption">Each branch is a separate assumed response to the same shock. Effects are not added together, calibrated forecasts, or expected share-price moves.</p>
      </section>
    </div>
    <section className="ripple-panel ripple-detail" aria-live="polite"><div className="ripple-detail-title"><p className="ripple-eyebrow">SELECTED CHANNEL / {channel.category}</p><h2>{channel.name}</h2><strong>{pct(effect)}</strong><p>Illustrative activity effect</p><span className="ripple-chip">Assumed lag: {channel.lag}</span></div><div><h3>The mechanism</h3><p>{channel.mechanism}</p><h3>What would undermine it?</h3><p>{channel.challenge}</p></div><div><h3>{channel.source ? "Evidence for measurement" : "Evidence still needed"}</h3><p>{channel.evidence}</p>{channel.source && <a href={SOURCE} target="_blank" rel="noreferrer">Read CSX methodology · Item 11 ↗</a>}<details><summary>Inspect the assumptions</summary><p>−{severity}% × {transmission / 100} transmission × {channel.exposure} exposure × {channel.elasticity} sensitivity = {pct(effect)}.</p><p>Exposure, sensitivity and lag are illustrative choices, not estimates from CSX data. Model: {MODEL}.</p></details></div></section>
    <section className="ripple-evidence"><div><p className="ripple-eyebrow">A STARTING POINT, NOT A SIGNAL</p><h2>Keep the evidence honest.</h2></div><div><h3>What the source establishes</h3><p>CSX describes separate weekly originated and received commodity counts. Fertilizer is a subgroup of Chemicals, so adding both would double-count it.</p><a href={SOURCE} target="_blank" rel="noreferrer">Primary methodology, checked October 27, 2026 ↗</a></div><div><h3>What remains unresolved</h3><p>The existing audit did not establish original publication timestamps. Keep containers and trailers separate; their unit interpretation remains unresolved. This lab imports no historical observations.</p><Link to="/experiments/EXP-CSX-001">Open the existing CSX dossier →</Link></div></section>
    <div className="ripple-notebook-grid" id="ripple-notebook"><section className="ripple-panel"><p className="ripple-eyebrow">03 / MAKE IT TESTABLE</p><h2>Write down the prediction.</h2><p>Choose the hypothesis target below. Exploring channels above does not change this draft. Saving captures this target's coefficients with the current shipment decline and transmission. No agent has reviewed this hypothesis yet.</p>
      <form onSubmit={saveHypothesis} className="ripple-form"><label>Hypothesis target<select value={hypothesisTarget} onChange={e => changeTarget(e.target.value)}>{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><p className="ripple-caption">Your edited wording is preserved when target or review timing changes. Check that all measurement rules still match.</p><label>Measurable prediction<textarea required maxLength={2000} value={prediction} onChange={e => setPrediction(e.target.value)} rows={3}/></label><label>Baseline and measurement rules<textarea required maxLength={2000} value={baseline} onChange={e => setBaseline(e.target.value)} rows={2}/></label><label>Rejection condition<textarea required maxLength={2000} value={rejection} onChange={e => setRejection(e.target.value)} rows={2}/></label><label>Review after<select value={horizon} onChange={e => changeHorizon(Number(e.target.value))}><option value={7}>7 calendar days</option><option value={28}>28 calendar days</option><option value={90}>90 calendar days</option></select></label><button className="ripple-primary" disabled={!!notebook.error} type="submit">Save hypothesis <span>↗</span></button></form>
      <p className="ripple-caption">Saved in this browser only. Timestamps use your device clock; they are not independently verified preregistration. Export a copy to keep it.</p>
    </section><section className="ripple-panel ripple-notebook"><div className="ripple-section-heading"><div><p className="ripple-eyebrow">04 / RETURN TO THE EVIDENCE</p><h2>The notebook <span>{notebook.records.length}</span></h2></div><button className="ripple-secondary" disabled={!!notebook.error} onClick={exportNotebook}>Export JSON ↓</button></div>
      {notebook.error && <p className="ripple-error" role="alert">{notebook.error}</p>}{message && <p className="ripple-message" role="status">{message}</p>}
      {!notebook.records.length && !notebook.error && <div className="ripple-empty"><span>◎</span><h3>The first entry starts here.</h3><p>Capture a prediction before observing the outcome. Rejected ideas belong in this notebook too.</p></div>}
      {notebook.records.map(r => <article className="ripple-record" key={r.id}><div className="ripple-section-heading"><span className="ripple-chip">{r.target} · v{r.version}</span><small>{r.outcomes.length ? `${r.outcomes.length} observations` : "Awaiting evidence"}</small></div><h3>{r.prediction}</h3><p className="ripple-caption">Saved {formatDate(r.createdAt)}<br/>Review {formatDate(r.reviewAt)} · {r.horizon} calendar days</p><details><summary>Frozen scenario & evaluation rules</summary><p>Shipment decline {r.severity}% · Transmission {r.transmission}% · Illustrative effect {pct(r.effect)}</p><p><strong>Baseline:</strong> {r.baseline}</p><p><strong>Reject when:</strong> {r.rejection}</p><p>{r.assumptions}</p><p className="ripple-caption">{r.modelVersion} · ID {r.id}</p></details>
        {r.outcomes.map((o, i) => <div className="ripple-outcome" key={`${o.recordedAt}-${i}`}><strong>{o.verdict} · user observation</strong><p>{o.note}</p><small>{formatDate(o.recordedAt)}</small></div>)}
        {outcomeFor === r.id ? <form className="ripple-form" onSubmit={saveOutcome}><label>Assessment<select value={verdict} onChange={e => setVerdict(e.target.value as Outcome["verdict"])}><option value="inconclusive">Inconclusive</option><option value="supported">Supported</option><option value="rejected">Rejected</option></select></label><label>Observed result, dates and source references<textarea required maxLength={4000} value={outcomeNote} onChange={e => setOutcomeNote(e.target.value)} rows={3}/></label><div className="ripple-actions"><button className="ripple-primary" disabled={!!notebook.error}>Append observation</button><button type="button" onClick={() => setOutcomeFor("")}>Cancel</button></div></form> : <button className="ripple-secondary" disabled={!!notebook.error} onClick={() => { setOutcomeFor(r.id); setOutcomeNote(""); setVerdict("inconclusive"); }}>+ Add an observation</button>}
      </article>)}
    </section></div><footer className="ripple-footer">Explore mechanisms. Preserve disagreements. Let observations change the story.<span>Research prototype / {MODEL}</span></footer>
  </div>;
}
