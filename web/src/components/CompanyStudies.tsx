import inbox from "../data/companyStudyInbox.json";

export default function CompanyStudies() {
  return <section className="research-section research-updates company-studies" aria-labelledby="company-studies-title">
    <div className="research-section-title">
      <h2 id="company-studies-title">Company study inbox</h2>
      <span>Three contrasting archived cases</span>
    </div>
    <p className="research-caption">Operating deterioration, customer revenue and facility recovery from three existing research tracks. This convenience sample is not statistically representative, selected by verified pipeline recurrence, or a current investment assessment. {inbox.selectionRule}</p>
    {inbox.studies.map(study => <article className="research-panel company-study-card" key={study.id}>
      <div className="research-tags"><span>{study.ticker} · archived case</span><span>{study.caseLabel}</span><span>{study.reviewStatus === "independently_reviewed_descriptive" ? "Independently reviewed · descriptive only" : "Local draft · source review required"}</span></div>
      <h3>{study.issuer}: {study.title}</h3>
      <p>{study.finding}</p>
      <div className="company-study-metrics">
        {study.metricItems.map(metric => <div key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></div>)}
      </div>
      <p className="research-caption">{study.periods.join(" versus ")}. These are descriptive reported observations, not forecasts.</p>
      <p><b>Why here:</b> {study.whyHere} <b>Pipeline appearances:</b> unknown. <b>Inspected source vintages:</b> {study.distinctSourceVintages}; not independent confirmations.</p>
      <p className="research-caption">Document / filing date: {study.documentDate}. Retained local source/metadata receipt: {study.firstLocalReceiptAt}. First pipeline appearance: unknown. {study.timingNote}</p>
      <details><summary>Study question, missing evidence and next step</summary>
        <p><b>Business question:</b> {study.businessQuestion}</p>
        <p><b>Falsifier:</b> {study.falsifier}</p>
        <p><b>Reinvestment payback / incremental return:</b> unknown. <b>Current valuation / stock-return evidence:</b> not supplied.</p>
        <ul>{study.limitations.map(limit => <li key={limit}>{limit}</li>)}</ul>
        {study.sourceTimeline.length > 0 && <ul className="research-sources">{study.sourceTimeline.map(source => <li key={source.url}>
          <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>
          <p className="research-caption">Document date: {source.documentDate}. SEC acceptance: {source.acceptedAt}. First public dissemination: unknown. Evidence: {source.evidenceKind.replace(/_/g, " ")}.</p>
        </li>)}</ul>}
        <p><b>Next:</b> {study.nextAction}</p>
      </details>
      <a href={study.source.url} target="_blank" rel="noopener noreferrer">{study.source.title} ↗</a>
    </article>)}
  </section>;
}

