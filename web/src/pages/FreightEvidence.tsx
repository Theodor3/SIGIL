import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { validateFreightEvidence } from "../lib/freightEvidence";
import type { FreightEvidence as Packet } from "../lib/freightEvidence";
import "./FreightEvidence.css";

export default function FreightEvidence() {
  const [data, setData] = useState<Packet | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setError(false); setData(null);
    fetch("/research/freight-evidence.json", { signal: controller.signal, cache: "no-store" })
      .then(async r => { if (!r.ok) throw new Error(); return validateFreightEvidence(await r.json()); })
      .then(d => { if (current) setData(d); })
      .catch(() => { if (current) setError(true); }).finally(() => clearTimeout(timeout));
    return () => { current = false; controller.abort(); clearTimeout(timeout); };
  }, [attempt]);
  return <div className="freight-evidence">
    <Link to="/signals">← Signal health</Link>
    <header><p className="freight-eyebrow">OPERATING DATA / RESEARCH PREVIEW</p><h1>Follow the freight.<br/><span>Inspect the evidence.</span></h1><p>Explore CSX’s reported service conditions. A starting point for finding sustained business improvement before earnings.</p><strong className="freight-status">Predictive value untested · Research only</strong></header>
    {error ? <section role="alert"><h2>Source packet unavailable</h2><p>No freight readings are being displayed.</p><button onClick={() => setAttempt(n => n + 1)}>Retry source packet</button></section>
      : !data ? <p role="status">Loading freight evidence…</p> : <>
      <section className="freight-timing" aria-label="Evidence timeline"><div><small>OBSERVATION PERIOD</small><strong>{data.periodStart} → {data.periodEnd}</strong><p>Dates inside the workbook</p></div><div><small>ORIGINAL PUBLICATION</small><strong>Unverified</strong><p>The October 21 filename is not a verified release time.</p></div><div><small>RETRIEVED / KNOWN TO THIS LAB</small><strong>{new Date(data.retrievedAt).toISOString().replace("T", " ")}</strong><p>Later retrieval does not establish earlier public availability.</p></div></section>
      <div className="freight-metrics"><section><small>SYSTEM SPEED · B13</small><strong>{data.systemSpeedMph.toFixed(2)} <em>mph</em></strong></section><section><small>SYSTEM TERMINAL DWELL · B27</small><strong>{data.systemDwellHours.toFixed(2)} <em>hours</em></strong></section><section><small>EIGHT-WEEK TREND</small><strong>Unavailable</strong><p>One workbook is bound to this view. A sustained trend needs aligned, separately receipted weeks.</p></section></div>
      <div className="freight-grid"><section><p className="freight-eyebrow">SELECT A TERMINAL</p><h2>Where cars spend time.</h2><p>Average dwell, excluding run-through trains. Single-week comparison; terminal mix and operating roles differ.</p><div className="freight-bars" role="group" aria-label="Terminal dwell observations">{data.terminals.map((t, i) => <button key={t.cell} aria-pressed={selected === i} onClick={() => setSelected(i)}><span>{t.name}</span><span className="freight-track" aria-hidden="true"><i style={{ width: `${t.dwellHours / Math.max(1, ...data.terminals.map(v => v.dwellHours)) * 100}%` }}/></span><b>{t.dwellHours.toFixed(2)} h</b></button>)}</div></section>
      <aside aria-live="polite"><p className="freight-eyebrow">OBSERVATION DETAIL</p><h2>{data.terminals[selected].name}</h2><strong className="freight-reading">{data.terminals[selected].dwellHours.toFixed(2)} <small>hours</small></strong><p>Weekly average terminal dwell. Lower dwell may indicate improved flow; it can also reflect volume, traffic mix or service changes.</p><dl><dt>Source sheet</dt><dd>{data.sheet}</dd><dt>Source cell</dt><dd>{data.terminals[selected].cell}</dd><dt>Company exposure supported here</dt><dd>CSX — reporting rail operator. No individual customer or supplier exposure is mapped.</dd></dl><a href={data.sourceUrl} target="_blank" rel="noreferrer">Open STB source workbook ↗</a><details><summary>Source fingerprint</summary><code>{data.sha256}</code></details></aside></div>
      <section className="freight-thesis"><p className="freight-eyebrow">BUY-AND-HOLD RESEARCH QUESTION</p><h2>Does better service become a better business?</h2><p>Test whether eight weeks of broad service improvement, alongside resilient freight volume, precedes stronger reported operating performance. Compare operators and seasons before evaluating a 6–12 month investment horizon.</p><div><p><strong>Evidence still needed</strong><br/>Verified availability, consistent terminal identities, commodity units and volume, revisions, peer comparables and later company results.</p><p><strong>Price still matters</strong><br/>Valuation, capital spending, fuel and labor costs, traffic mix, and 10/25/50 bps assumed round-trip costs. None is loaded into this preview.</p><p><strong>What would weaken the idea?</strong><br/>Lower dwell caused by falling demand, no margin/cash-flow improvement, or no incremental information versus peers. Faster event-driven trades require a separate test.</p></div><Link to="/experiments/EXP-CSX-001">Read the existing CSX dossier →</Link></section>
    </>}
  </div>;
}
