import { useState } from "react";
import { Link } from "react-router-dom";
import { selectStudies, studyStatus, type Study } from "../lib/studies";

export default function StudyCatalog({ studies, reviewedOn, refresh, refreshing }: { studies: Study[]; reviewedOn: string; refresh: () => void; refreshing: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [order, setOrder] = useState("registered");
  const rows = selectStudies(studies, query, status, order);
  const statuses = [...new Set(studies.map(study => study.status))].sort();
  return <section className="research-section study-catalog" aria-labelledby="study-catalog-title">
    <div className="research-section-title"><h2 id="study-catalog-title">Published studies</h2><button className="research-button" onClick={refresh} disabled={refreshing}>Refresh publication</button></div>
    <p className="research-caption">Reviewed publication: {reviewedOn}. This list comes from the published study registry, not the curated updates below. New registered studies appear here when a reviewed publication is deployed. Local drafts and worker activity are not a live feed.</p>
    <p className="research-caption">Studies record a question, evidence, limitations and a next step. A finding is not proof of a profitable strategy. Registration dates are not last-updated dates; study update times are not recorded in this publication.</p>
    <div className="study-controls">
      <label>Find a study<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Company, topic, question or study ID" /></label>
      <label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map(value => <option key={value} value={value}>{studyStatus(value)}</option>)}</select></label>
      <label>Sort<select value={order} onChange={event => setOrder(event.target.value)}><option value="registered">Newest registered first</option><option value="title">Title A to Z</option></select></label>
    </div>
    <p className="research-caption" role="status">Showing {rows.length} of {studies.length} published studies.</p>
    {!rows.length ? <div className="research-panel"><h3>{studies.length ? "No studies match these filters" : "No studies in this publication"}</h3><p>{studies.length ? "Try another company or topic, or clear the filters." : "This does not mean there are no local drafts or ongoing work."}</p>{studies.length > 0 && <button className="research-button" onClick={() => { setQuery(""); setStatus("all"); }}>Clear filters</button>}</div>
      : <div className="study-grid">{rows.map(study => <article className="research-panel" key={study.id}>
        <p className="research-kicker">{study.ticker} / {study.id}</p><h3><Link to={`/experiments/${encodeURIComponent(study.id)}`}>{study.title}</Link></h3>
        <p className="study-status">{studyStatus(study.status)}</p><p>{study.hypothesis}</p>
        <p><strong>Next step:</strong> {study.nextAction}</p>
        <p className="research-caption">Registered: <time dateTime={study.createdAt}>{study.createdAt}</time><br/>{study.sourceSamples} source samples / {study.findings.length} recorded findings<br/>{study.predictiveResultsAvailable ? "Results recorded; scope and limitations in dossier" : "Predictive value not established"}</p>
        <Link className="research-button" to={`/experiments/${encodeURIComponent(study.id)}`}>Read evidence and limitations</Link>
      </article>)}</div>}
  </section>;
}

