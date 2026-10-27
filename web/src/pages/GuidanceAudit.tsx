import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./Experiments.css";
import "./GuidanceAudit.css";

type Receipt = { url: string; retrievedAt: string; sha256: string | null; status: number | null };
type Candidate = { accession: string; filingDate: string; apiAcceptanceRaw: string | null };
type Document = { url: string; status: string; receipt?: Receipt; keywordWindows?: { start: number; text: string }[] };
const contentLabels: Record<string, string> = { numeric_annual_guidance_found: "Annual numbers found", call_required: "Earnings call needed", period_not_annual: "Quarterly target found", qualitative: "Qualitative outlook", unresolved: "Unresolved", pending: "Content review pending" };
type ContentFinding = { ticker: string; quarter: string; status: string; supportingPassage: string; caveat: string; sourceUrl: string; rawSha256: string };
type Slot = {
  ticker: string; quarter: string; status: string; candidates: Candidate[]; selected: Candidate | null;
  indexReceipt: Receipt | null; index: { secAcceptedLocal: string | null; secAcceptedTimezone: string } | null;
  documents: Document[]; guidanceReview: string; timingVerified: false; eligibleForReturns: false; contentFinding?: ContentFinding | null;
};
type Audit = { schemaVersion: number; id: string; stage: string; startedAt: string; completedAt?: string;
  configSha256: string; predictiveResultsAvailable: false; slots: Slot[] };
const fingerprint = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
function sourceUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.origin === "https://www.sec.gov" && !url.username && !url.password && url.pathname.startsWith("/Archives/"); }
  catch { return false; }
}
function validReceipt(value: unknown): value is Receipt {
  return record(value) && sourceUrl(value.url) && timestamp(value.retrievedAt)
    && (value.sha256 === null || fingerprint(value.sha256)) && (value.status === null || Number.isInteger(value.status));
}
function validCandidate(value: unknown): value is Candidate {
  return record(value) && typeof value.accession === "string" && /^\d{10}-\d{2}-\d{6}$/.test(value.accession)
    && typeof value.filingDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.filingDate)
    && (value.apiAcceptanceRaw === null || typeof value.apiAcceptanceRaw === "string");
}
function validAudit(value: unknown): value is Audit {
  if (!record(value) || value.schemaVersion !== 1 || value.id !== "guidance-revision-v1"
    || value.stage !== "unverified_source_receipts" || value.predictiveResultsAvailable !== false
    || !timestamp(value.startedAt) || (value.completedAt !== undefined && !timestamp(value.completedAt))
    || !fingerprint(value.configSha256) || !Array.isArray(value.slots) || value.slots.length !== 30) return false;
  const keys = new Set<string>();
  return value.slots.every((slot: unknown) => {
    if (!record(slot) || typeof slot.ticker !== "string" || !["ADBE", "CRM", "MSFT", "ORCL", "WMT", "TGT"].includes(slot.ticker)
      || typeof slot.quarter !== "string" || !["2024Q3", "2024Q4", "2025Q1", "2025Q2", "2025Q3"].includes(slot.quarter)
      || typeof slot.status !== "string" || !Array.isArray(slot.candidates) || !slot.candidates.every(validCandidate)
      || (slot.selected !== null && !validCandidate(slot.selected)) || (slot.indexReceipt !== null && !validReceipt(slot.indexReceipt))
      || typeof slot.guidanceReview !== "string" || slot.timingVerified !== false || slot.eligibleForReturns !== false
      || !Array.isArray(slot.documents)) return false;
    if (slot.index !== null && (!record(slot.index) || (slot.index.secAcceptedLocal !== null && typeof slot.index.secAcceptedLocal !== "string")
      || typeof slot.index.secAcceptedTimezone !== "string")) return false;
    const key = `${slot.ticker}-${slot.quarter}`;
    if (keys.has(key)) return false;
    keys.add(key);
    if (slot.contentFinding !== undefined && slot.contentFinding !== null) {
      const finding = slot.contentFinding;
      const doc = slot.documents[0];
      if (!record(finding) || finding.ticker !== slot.ticker || finding.quarter !== slot.quarter
        || typeof finding.status !== "string" || !Object.prototype.hasOwnProperty.call(contentLabels, finding.status) || finding.status === "pending"
        || typeof finding.supportingPassage !== "string" || !finding.supportingPassage.length || finding.supportingPassage.length > 2000
        || typeof finding.caveat !== "string" || !finding.caveat.length || finding.caveat.length > 2000
        || !sourceUrl(finding.sourceUrl) || !fingerprint(finding.rawSha256)
        || !record(doc) || !record(doc.receipt) || finding.sourceUrl !== doc.url || finding.rawSha256 !== doc.receipt.sha256
        || finding.latestPriorVerified !== false || finding.timingVerified !== false || finding.eligibleForReturns !== false) return false;
    }
    return slot.documents.every((doc: unknown) => record(doc) && sourceUrl(doc.url) && typeof doc.status === "string"
      && (doc.receipt === undefined || validReceipt(doc.receipt))
      && (doc.keywordWindows === undefined || (Array.isArray(doc.keywordWindows) && doc.keywordWindows.length <= 12
        && doc.keywordWindows.every((window: unknown) => record(window) && Number.isInteger(window.start)
          && Number(window.start) >= 0 && typeof window.text === "string" && window.text.length <= 2000))));
  });
}
const statusLabel = (status: string) => ({ candidate_unverified: "Source candidate", ambiguous_candidates: "Multiple candidates", missing_filing: "Filing not found", retrieval_failed: "Retrieval failed", no_exhibit_found: "Exhibit not found" }[status] ?? "Needs review");
const utc = (date: string) => new Date(date).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");

export default function GuidanceAudit() {
  const [data, setData] = useState<Audit | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [ticker, setTicker] = useState("all");
  const [status, setStatus] = useState("all");
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setError(false); setData(null);
    fetch("/research/guidance-audit.json", { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error("Unavailable"); const value: unknown = await response.json(); if (!validAudit(value)) throw new Error("Invalid snapshot"); if (active) setData(value); })
      .catch(() => { if (active) setError(true); }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  const tickers = [...new Set(data?.slots.map(slot => slot.ticker) ?? [])];
  const statuses = [...new Set(data?.slots.map(slot => slot.contentFinding?.status ?? "pending") ?? [])];
  const visible = data?.slots.filter(slot => (ticker === "all" || ticker === slot.ticker) && (status === "all" || status === (slot.contentFinding?.status ?? "pending"))) ?? [];
  const contentCounts = statuses.map(key => ({ key, label: contentLabels[key], count: data?.slots.filter(slot => (slot.contentFinding?.status ?? "pending") === key).length ?? 0 }));
  const withSources = data?.slots.filter(slot => slot.documents.some(doc => doc.status === "retrieved_unverified")).length ?? 0;
  const exhibits = data?.slots.reduce((sum, slot) => sum + slot.documents.filter(doc => doc.status === "retrieved_unverified").length, 0) ?? 0;
  function download() {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "sigil-guidance-source-audit.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="experiment-research guidance-audit">
    <Link className="research-back" to="/experiments">← All experiments</Link>
    <header className="research-heading"><p className="research-kicker">SIGIL FIELDNOTES / GUIDANCE REVISIONS</p><h1>What changed.<br/>What we can prove.</h1><p>A fixed sample of company disclosures, before we look at returns. Can we reliably identify a revenue guidance change—and establish when it became public?</p></header>
    <div className="guidance-stage"><span>01 / Evidence intake</span><span>02 / Guidance comparison</span><span>03 / Return experiment</span></div>
    <section className="research-panel guidance-question"><div><p className="research-kicker">THE HYPOTHESIS / UNTESTED</p><h2>New guidance. A delayed reaction?</h2><p>A revenue guidance increase might contain information that takes days to reach the company’s price or related companies. The proposed main horizon is ten trading sessions. These documents establish a starting point; they do not establish that effect.</p></div><aside><strong>Source audit only</strong><p>No return results, validated signals, or trade recommendations. A guidance revision is not an analyst-consensus surprise.</p></aside></section>
    {error ? <section className="research-panel guidance-state" role="alert"><h2>The evidence snapshot could not be loaded.</h2><p>It may be unavailable or incompatible with this page. No data have been replaced.</p><button className="research-button" onClick={() => setAttempt(n => n + 1)}>Try again</button></section>
      : !data ? <p className="guidance-state" role="status">Loading the evidence snapshot…</p> : <>
        <div className="guidance-metrics" aria-label="Audit coverage"><div><strong>{data.slots.length}<small> / 30</small></strong><span>Sample slots recorded</span></div><div><strong>{withSources}</strong><span>Slots with exhibit receipts</span></div><div><strong>{exhibits}</strong><span>Exhibits retrieved</span></div><div><strong>0</strong><span>Events eligible for return testing</span></div></div>
        <div className="research-publication"><span>Snapshot collected {utc(data.startedAt)}</span><span>{data.completedAt ? "Collection finished · Review remains open" : "Partial collection · Review remains open"}</span></div>
        {data.slots.some(slot => slot.contentFinding) && <section className="research-panel guidance-content-summary"><p className="research-kicker">FIRST EXHIBIT / TARGETED CONTENT REVIEW</p><h2>What the first pass found</h2><div className="guidance-content-counts">{contentCounts.map(item => <div key={item.key}><strong>{item.count}</strong><span>{item.label}</span></div>)}</div><p className="research-caption">These are content findings from selected passages in the first archived exhibit. Other exhibits or earnings calls may contain additional guidance. Annual numbers alone do not establish a comparable revision, verified timing, or an eligible event.</p></section>}
        <section className="guidance-rules"><div><h2>A fixed sample, including dead ends.</h2><p>Six companies × five calendar release quarters, from 2024 Q3 to 2025 Q3. Selection does not use subsequent returns or whether guidance rose. Missing, unchanged, cut, initial, and incomparable guidance stay in the audit.</p><p className="research-caption">This named convenience sample is not representative of the market. The first filing in a quarter is an unverified candidate; all alternative filings remain recorded.</p></div><ol><li><span>Pair the disclosures</span>Match the same fiscal period, metric, currency basis, and company scope.</li><li><span>Verify availability</span>SEC acceptance is not proof of the first public release. Retrieval time is recorded separately.</li><li><span>Test only after review</span>Keep missing evidence visible. Freeze portfolio rules before calculating returns.</li></ol></section>
        <section className="research-section"><div className="research-section-title"><h2>The evidence ledger</h2><button className="research-button" onClick={download}>Download snapshot ↓</button></div>
          <div className="guidance-filters"><label>Company<select value={ticker} onChange={e => setTicker(e.target.value)}><option value="all">All companies</option>{tickers.map(item => <option key={item}>{item}</option>)}</select></label><label>Content finding<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">All findings</option>{statuses.map(item => <option key={item} value={item}>{contentLabels[item]}</option>)}</select></label><span role="status">{visible.length} of {data.slots.length} sample slots</span></div>
          {visible.length === 0 ? <p className="research-panel">No sample slots match these filters.</p> : <div className="guidance-ledger">{visible.map(slot => <article className="research-panel guidance-slot" key={`${slot.ticker}-${slot.quarter}`}>
            <header><div><p className="research-kicker">{slot.quarter} / CALENDAR RELEASE QUARTER</p><h3>{slot.ticker}</h3></div><span className="guidance-status">{statusLabel(slot.status)}</span></header>
            <p className="guidance-date">Candidate filing: {slot.selected?.filingDate ?? "Not found"} · {slot.candidates.length} recorded candidate{slot.candidates.length === 1 ? "" : "s"}</p>
            <div className="guidance-gates"><span>Guidance pair: pending</span><span>Publication timing: unverified</span><span>Returns: not tested</span></div>
            {slot.contentFinding && <div className="guidance-content-finding"><p className="research-kicker">FIRST-EXHIBIT CONTENT FINDING</p><h4>{contentLabels[slot.contentFinding.status]}</h4><blockquote>{slot.contentFinding.supportingPassage}</blockquote><p>{slot.contentFinding.caveat}</p><a className="guidance-source" href={slot.contentFinding.sourceUrl} target="_blank" rel="noreferrer">Inspect the supporting exhibit ↗</a><p className="research-caption">Targeted passage review; not a full-document absence check or a verified guidance pair.</p></div>}
            {slot.indexReceipt && <a className="guidance-source" href={slot.indexReceipt.url} target="_blank" rel="noreferrer">Open SEC filing index ↗</a>}
            <details><summary>Source timing & candidate record</summary><dl className="guidance-timing"><dt>SEC accepted, as displayed</dt><dd>{slot.index?.secAcceptedLocal ?? "Unavailable"}{slot.index?.secAcceptedLocal ? ` (${slot.index.secAcceptedTimezone})` : ""}</dd><dt>Filing index retrieved</dt><dd>{slot.indexReceipt ? utc(slot.indexReceipt.retrievedAt) : "Unavailable"}</dd><dt>Original public availability</dt><dd>Not verified</dd></dl><p className="research-caption">Filing date, SEC acceptance, and our retrieval time are different facts. None establishes the first time the company released this information.</p><ul>{slot.candidates.map(candidate => <li key={candidate.accession}>{candidate.filingDate} · {candidate.accession}{candidate.accession === slot.selected?.accession ? " · selected candidate" : " · alternative retained"}</li>)}</ul></details>
            {slot.documents.length === 0 ? <p className="research-caption">No exhibit receipt is available for this slot.</p> : slot.documents.map((doc, i) => <details className="guidance-document" key={doc.url}><summary>Exhibit {i + 1} · {doc.status === "retrieved_unverified" ? "retrieved, unverified" : "retrieval failed"}</summary><a className="guidance-source" href={doc.url} target="_blank" rel="noreferrer">Read original SEC exhibit ↗</a>{doc.receipt && <><p className="research-caption">Retrieved {utc(doc.receipt.retrievedAt)}</p><details><summary>Document fingerprint</summary><code>{doc.receipt.sha256 ?? "Unavailable"}</code></details></>}<p className="research-caption">Automated keyword excerpts below are discovery aids. They can include disclaimers or partial tables. They are not a verified guidance comparison.</p>{doc.keywordWindows?.length ? doc.keywordWindows.map((window, j) => <blockquote key={`${window.start}-${j}`}>{window.text}</blockquote>) : <p className="research-caption">No keyword excerpts available.</p>}</details>)}
          </article>)}</div>}
        </section>
        <footer className="research-footer">The next decision is whether the evidence supports a reproducible experiment. Disagreement, exclusions, and failed comparisons are useful findings. This snapshot does not activate trading.<details><summary>Frozen configuration fingerprint</summary><code>{data.configSha256}</code></details></footer>
      </>}
  </div>;
}
