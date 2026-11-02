import {useEffect,useState} from "react";
import {Link} from "react-router-dom";
import {selectResearchUpdates,validateResearchUpdates,type ResearchUpdates as Updates,type UpdateCategory} from "../lib/researchUpdates";
type Registry = {contentSha256:string;reviewedOn:string;experiments:{id:string;title:string}[]};
export default function ResearchUpdates({registry}:{registry:Registry}) {
  const [data,setData]=useState<Updates|null>(null),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
  const [filter,setFilter]=useState<"all"|UpdateCategory|"local">("all");
  useEffect(()=>{
    const controller=new AbortController();let current=true;const timer=setTimeout(()=>controller.abort(),10000);
    setError(false);setData(null);
    fetch("/research/updates.json",{cache:"no-store",signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error("Unavailable");
      const raw=await response.text();if(raw.length>200000)throw new Error("Oversized updates");
      const result=validateResearchUpdates(JSON.parse(raw),registry.contentSha256,registry.experiments.map(item=>item.id));
      if(current)setData(result);
    }).catch(()=>{if(current)setError(true);}).finally(()=>clearTimeout(timer));
    return()=>{current=false;controller.abort();clearTimeout(timer);};
  },[registry,attempt]);
  const rows=data?selectResearchUpdates(data.updates,filter):[];
  return <section className="research-section research-updates" aria-label="What changed">
    <div className="research-section-title"><h2>What changed</h2><span>Curated updates — Reviewed reading list</span></div>
    <p className="research-caption">A partial reading list, not a complete swarm activity log. Feed-entry dates show when summaries were added here, not when research occurred or a source became public. Published dossiers are from the reviewed {registry.reviewedOn} snapshot; newer notebook files and worker drafts are not automatically published.</p>
    {error?<div className="research-panel" role="alert"><h3>Updates could not be loaded</h3><p>The existing research notebook is still available below. An unavailable feed does not mean no research happened.</p><button className="research-button" onClick={()=>setAttempt(n=>n+1)}>Retry updates</button></div>
    :!data?<p role="status">Loading research updates…</p>:<>
      <label className="research-update-filter">Show updates <select value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}><option value="all">All updates</option><option value="result">Results / datasets</option><option value="negative">Negative findings</option><option value="blocked">Limits / blocked</option><option value="local">Local-only research</option></select></label>
      <p className="research-caption" role="status">{rows.length} of {data.updates.length} curated entries shown. No trading performance is established by this feed.</p>
      {!rows.length?<p>No entries match this filter. Coverage is partial; this is not proof that no work exists.</p>:<div className="research-update-list">{rows.map(item=><article className="research-panel" key={item.id}>
        <div className="research-tags"><span>{item.category==="negative"?"Negative finding":item.category==="blocked"?"Limits / blocked":"Result / dataset"}</span><span>{item.availability==="local_only"?"Local only — not in published dossier":"Existing published dossier"}</span><span>{item.review==="published_summary"?"Previously reviewed summary":"Independently reviewed · descriptive only"}</span></div>
        <h3>{registry.experiments.find(experiment=>experiment.id===item.experimentId)?.title}</h3>
        <p>{item.summary}</p><p className="research-caption">Feed entry added: <time dateTime={item.recordedAt}>{item.recordedAt}</time><br/>Original result time: {item.originalResultAt??"Unrecorded — not inferred from registration"}</p><p className="research-caption">{item.timingNote}</p>
        <Link to={`/experiments/${encodeURIComponent(item.experimentId)}`} className="research-back">{item.availability==="local_only"?"Open existing dossier (earlier summary)":"Open research dossier"} →</Link>
        <ul className="research-sources">{item.sources.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a></li>)}</ul>
      </article>)}</div>}
    </>}
  </section>;
}

