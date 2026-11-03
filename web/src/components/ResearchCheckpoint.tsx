import { useState } from "react";
import raw from "../data/researchCheckpoint.json";
import { checkpoint, checkpointAgeNotice, pendingReviewNeeded, visibleEvidence, chartScale, evidenceStates, type EvidenceState, type EvidenceItem } from "../lib/researchCheckpoint";

const labels = { qualified: "Qualified finding", negative: "Negative result", inconclusive: "Inconclusive", pending: "Pending outcome" };
function Comparison({ item }: { item: EvidenceItem }) {
  const x = chartScale(item.metrics.map(m => m.value));
  return <>
    <svg className="checkpoint-chart" viewBox={`0 0 600 ${item.metrics.length * 38 + 18}`} role="img" aria-label={`${item.title}: ${item.comparisonMeaning}. Values also listed below.`}>
      <line x1={x(0)} x2={x(0)} y1="0" y2={item.metrics.length * 38} stroke="#849489" />
      {item.metrics.map((m, i) => <g key={m.label}>
        <text x="0" y={i * 38 + 23} fill="#cad8c9" fontSize="13">{m.label}</text>
        <rect x={Math.min(x(0), x(m.value))} y={i * 38 + 7} width={Math.abs(x(m.value) - x(0))} height="22" rx="2" fill={m.value < 0 ? "#daab92" : "#b8cfa1"} opacity={item.status === "pending" ? .45 : .85} />
        <text x="540" y={i * 38 + 23} fill="#eef1e3" fontSize="13">{m.value.toFixed(2)}</text>
      </g>)}
    </svg>
    <table className="checkpoint-values"><caption>{item.unit} · {item.comparisonMeaning}</caption>
      <tbody>{item.metrics.map(m => <tr key={m.label}><th scope="row">{m.label}</th><td>{m.value.toFixed(2)}</td></tr>)}</tbody>
    </table>
  </>;
}

export default function ResearchCheckpoint() {
  const [state, setState] = useState<EvidenceState | "all">("all");
  let data;
  try { data = checkpoint(raw); } catch { return <section role="alert">Research checkpoint unavailable; no results inferred.</section>; }
  const items = visibleEvidence(data.items, state);
  return <section className="research-section research-checkpoint" aria-labelledby="checkpoint-heading">
    <div className="research-section-title"><h2 id="checkpoint-heading">Research checkpoint</h2><span>Reviewed {data.reviewedOn} · curated research snapshot</span></div>
    <p className="research-caption">Snapshot as of {data.reviewedOn} · Evidence checked <time dateTime={data.evidenceCheckedAt}>{new Date(data.evidenceCheckedAt).toISOString().replace("T", " ")}</time><br />{checkpointAgeNotice(data)}</p>
    <p className="research-caption">Curated evidence, not the complete experiment registry or live swarm status. “New” means analysis recorded, not newly published company data. None is a validated investment signal.</p>
    <div className="checkpoint-filters" aria-label="Filter evidence status">
      {(["all", ...evidenceStates] as const).map(value => <button type="button" key={value} aria-pressed={state === value} onClick={() => setState(value)}>
        {value === "all" ? "All findings" : labels[value]} ({value === "all" ? data.items.length : data.items.filter(i => i.status === value).length})
      </button>)}
    </div>
    <p role="status" className="research-caption">{items.length} matching entries · newest recorded analysis first</p>
    <div className="checkpoint-grid">{items.map(item => <article className={`research-panel checkpoint-card checkpoint-${item.status}`} key={item.id}>
      <div className="research-tags"><span>{item.ticker}</span><span>{labels[item.status]}</span></div>
      <h3>{item.title}</h3>
      <p className="research-caption">Business period: {item.period}<br />Analysis recorded: <time dateTime={item.recordedAt}>{item.recordedAt.replace("T", " ")}</time></p>
      <p>{item.finding}</p>
      {item.status === "pending" && <p className="checkpoint-pending">Predictions only. Observed outcome is unscored; these bars are not performance.</p>}
      {pendingReviewNeeded(item) && <p className="checkpoint-pending">Recorded outcome deadline has passed; this entry needs review. No result is inferred.</p>}
      <Comparison item={item} />
      <p><strong>Limit:</strong> {item.limitation}</p>
      <details><summary>Evidence and next step</summary><p>{item.nextStep}</p>
        <a href={item.source.url} target="_blank" rel="noopener noreferrer">{item.source.title}</a>
        <p className="research-caption">Source hash identifies the retained representation; it does not prove historical availability or authenticate every claim.</p>
        <code>{item.source.representation} SHA-256: {item.source.sha256}</code><code>Analysis artifact SHA-256: {item.artifactSha256}</code>
        {item.supportingSources?.map(source => <div key={source.sha256}><a href={source.url} target="_blank" rel="noopener noreferrer">Additional input: {source.title}</a><code>{source.representation} SHA-256: {source.sha256}</code></div>)}
      </details>
    </article>)}</div>
    {!items.length && <p>No entries in this category in the curated checkpoint.</p>}
  </section>;
}
