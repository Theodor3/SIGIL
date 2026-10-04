import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import "./Experiments.css";

type Finding = { id: string; status: string; summary: string };
type Source = { title: string; url: string; sha256?: string };
type Experiment = {
  id: string; title: string; ticker: string; stage: string; hypothesis: string;
  hypothesisVersion: string; createdAt: string; nextAction: string; sourceSamples: number;
  originalPublicationTimesVerified: boolean; predictiveResultsAvailable: boolean;
  findings: Finding[]; publicSources: Source[];
};
type Snapshot = { schemaVersion: number; publicationMode: string; reviewedOn: string; contentSha256: string; experiments: Experiment[] };
function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as Snapshot;
  return data.schemaVersion === 1 && data.publicationMode === "reviewed_snapshot"
    && typeof data.reviewedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.reviewedOn)
    && typeof data.contentSha256 === "string" && /^[a-f0-9]{64}$/.test(data.contentSha256)
    && Array.isArray(data.experiments) && data.experiments.every(item =>
      item && [item.id, item.title, item.ticker, item.stage, item.hypothesis, item.hypothesisVersion, item.createdAt, item.nextAction].every(v => typeof v === "string")
      && Number.isSafeInteger(item.sourceSamples) && item.sourceSamples >= 0
      && typeof item.originalPublicationTimesVerified === "boolean" && typeof item.predictiveResultsAvailable === "boolean"
      && Array.isArray(item.findings) && item.findings.every(f => f && [f.id, f.status, f.summary].every(v => typeof v === "string"))
      && Array.isArray(item.publicSources) && item.publicSources.every(s => s && typeof s.title === "string"
        && typeof s.url === "string" && /^https:\/\/(www\.)?(stb\.gov|csx\.com)\//.test(s.url)
        && (s.sha256 === undefined || /^[a-f0-9]{64}$/.test(s.sha256))));
}
export default function Experiments() {
  const { experimentId } = useParams();
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setError(false); setData(null);
    fetch("/research/experiments.json", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Unavailable");
        const result: unknown = await response.json();
        if (!validSnapshot(result)) throw new Error("Invalid publication");
        if (current) setData(result);
      }).catch(() => { if (current) setError(true); })
      .finally(() => clearTimeout(timeout));
    return () => { current = false; controller.abort(); clearTimeout(timeout); };
  }, [attempt]);
  const selected = data?.experiments.find(item => item.id === experimentId);
  return <div className="experiment-research">
    <header className="research-heading">
      <p className="research-kicker">SIGIL FIELDNOTES / EXPERIMENTS</p>
      <h1>{selected ? selected.title : "Better questions. Measurable answers."}</h1>
      <p>{selected ? "A company research dossier. Evidence first; market predictions only after testing." : "A home for the ideas that haven’t earned their place in a strategy. Follow what we’re learning, what failed, and what comes next."}</p>
    </header>
    {error ? <section className="research-panel" role="alert"><h2>Research is temporarily unavailable.</h2><p>The saved snapshot could not be loaded. This does not mean experiments were deleted.</p><button className="research-button" onClick={() => setAttempt(n => n + 1)}>Try again</button></section>
      : !data ? <p role="status">Loading the research notebook…</p>
      : <>
        <div className="research-publication"><span>Reviewed snapshot · {data.reviewedOn}</span><span>Published with the app · Not a live swarm feed</span></div>
        {experimentId && !selected ? <section className="research-panel"><h2>Experiment not found</h2><Link to="/experiments">Back to all experiments →</Link></section>
          : selected ? <>
            <Link className="research-back" to="/experiments">← All experiments</Link>
            <div className="research-dossier">
              <section className="research-panel research-thesis">
                <p className="research-kicker">{selected.ticker} / {selected.stage} / {selected.id}</p>
                <h2>The question</h2><p className="research-large">{selected.hypothesis}</p>
                <div className="research-tags"><span>{selected.predictiveResultsAvailable ? "Results recorded · review required" : "Predictive value untested"}</span><span>{selected.originalPublicationTimesVerified ? "Publication timing verified" : "Publication timing unresolved"}</span></div>
                <p className="research-caption">Hypothesis {selected.hypothesisVersion} · Registered {selected.createdAt}</p>
              </section>
              <aside className="research-panel research-plan"><p className="research-kicker">NEXT USEFUL STEP</p><h2>Earn the next experiment.</h2><p>{selected.nextAction}</p><hr/><h3>Paper portfolio</h3><p>No paper-trial results are included in this publication. No performance claim is made.</p></aside>
            </div>
            <section className="research-section"><div className="research-section-title"><h2>Evidence & open questions</h2><span>{selected.findings.length} recorded findings · {selected.sourceSamples} sampled workbooks</span></div>
              <div className="research-findings">{selected.findings.map(f => <article className="research-panel" key={f.id}><p className="research-kicker">{f.id} / {f.status.replace(/_/g, " ")}</p><p>{f.summary}</p></article>)}</div>
              <p className="research-caption">The sample is an audit of data feasibility, not a complete history or a backtest.</p>
            </section>
            <section className="research-panel"><h2>Inspect the source material</h2><p>Primary documents used in the saved audit. A source link is not proof of original publication timing.</p>
              {selected.publicSources.length === 0 ? <p>No public source references published yet.</p> : <ul className="research-sources">{selected.publicSources.map((source, i) => <li key={`${source.url}-${i}`}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>{source.sha256 && <details><summary>Audit fingerprint</summary><code>{source.sha256}</code></details>}</li>)}</ul>}
            </section>
          </> : <>
            <div className="research-section-title"><h2>The research notebook</h2><span>{data.experiments.length} registered {data.experiments.length === 1 ? "experiment" : "experiments"}</span></div>
            {!data.experiments.length ? <section className="research-panel"><h2>Room for the next question.</h2><p>No experiments are included in this reviewed publication yet.</p></section> : data.experiments.map(item => <article className="research-panel research-feature" key={item.id}>
              <div><p className="research-kicker">{item.ticker} / {item.stage} / {item.id}</p><h2>{item.title}</h2><p>{item.hypothesis}</p><div className="research-tags"><span>{item.sourceSamples} source samples</span><span>{item.findings.length} findings</span><span>{item.predictiveResultsAvailable ? "Results recorded" : "Predictive value untested"}</span></div><Link className="research-button" to={`/experiments/${encodeURIComponent(item.id)}`}>Open research dossier <span aria-hidden="true">↗</span></Link></div>
              <aside><p className="research-kicker">THE RESEARCH PATH</p><ol><li className={item.stage === "feasibility" ? "current" : ""}>01 <span>Establish data quality</span></li><li>02 <span>Test the business hypothesis</span></li><li>03 <span>Evaluate market relevance</span></li></ol><p className="research-caption">{item.ticker} · Current stage: {item.stage}. This sequence is proposed; it does not certify completed steps.</p></aside>
            </article>)}
          </>}
        <footer className="research-footer">Research can end in a useful dataset, a rejected idea or a better question. Agreement between agents is not validation.<details><summary>Publication identity</summary><code>{data.contentSha256}</code></details></footer>
      </>}
  </div>;
}
