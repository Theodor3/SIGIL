import {useEffect, useRef, useState} from "react";

interface DailyPoint {date_index:string; provider_epoch:number; provider_label_utc:string; equity:number; valuation_at:null; resolution:"daily"}
interface Recovery {schema_version:1; available:true; source_label:string; source_sha256:string; retrieved_at:string; separate_from_hourly:true; comparison_allowed:false; valuation_time_known:false; metrics:null; points:DailyPoint[]}
type Result = {state:"available";data:Recovery}|{state:"unavailable"}|{state:"error"};

export function validRecovery(value:any):value is Recovery {
  if(value?.schema_version!==1||value.available!==true||value.separate_from_hourly!==true||value.comparison_allowed!==false||value.valuation_time_known!==false||value.metrics!==null||value.source_label!=="Alpaca paper account history"||!/^[a-f0-9]{64}$/.test(value.source_sha256||"")||!/(Z|[+-]\d\d:\d\d)$/.test(value.retrieved_at||"")||!Number.isFinite(Date.parse(value.retrieved_at))||!Array.isArray(value.points)||value.points.length<1||value.points.length>1000)return false;
  if(typeof value.retrieved_at!=="string"||typeof value.source_sha256!=="string"||Date.parse(value.retrieved_at)>Date.now())return false;
  const dates=new Set<string>(),epochs=new Set<number>();
  const ny=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"});
  let previousEpoch=-1;
  for(const point of value.points){
    if(!point||typeof point!=="object"||!Number.isSafeInteger(point.provider_epoch)||point.provider_epoch<0||!Number.isFinite(new Date(point.provider_epoch*1000).getTime())||!/(Z|[+-]\d\d:\d\d)$/.test(point.provider_label_utc)||!Number.isFinite(Date.parse(point.provider_label_utc))||Date.parse(point.provider_label_utc)!==point.provider_epoch*1000||point.provider_epoch*1000>Date.parse(value.retrieved_at)||ny.format(new Date(point.provider_epoch*1000))!==point.date_index||dates.has(point.date_index)||epochs.has(point.provider_epoch)||typeof point.equity!=="number"||!Number.isFinite(point.equity)||point.equity<=0||point.valuation_at!==null||point.resolution!=="daily")return false;
    if(typeof point.provider_label_utc!=="string"||point.provider_epoch<=previousEpoch)return false;
    previousEpoch=point.provider_epoch;dates.add(point.date_index);epochs.add(point.provider_epoch);
  }
  return true;
}

export async function requestRecovery(fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<Result>{
  const response=await fetcher("/api/portfolio/recovered-daily",{credentials:"same-origin",cache:"no-store",signal});
  if(response.status===404||response.status===501)return {state:"unavailable"};
  if(!response.ok)return {state:"error"};
  const value=await response.json();
  if(value?.schema_version===1&&value.available===false)return {state:"unavailable"};
  return validRecovery(value)?{state:"available",data:value}:{state:"error"};
}

export function RecoveredDailyPanel({data}:{data:Recovery}){
 return <div className="space-y-3">
  <p className="text-sm text-amber-300">Recovered daily observations · proposed session dates · valuation time unknown</p>
  <p className="text-xs text-sigil-muted">{data.source_label}; captured {data.retrieved_at}. {data.points.length} separate observations. These are not inserted into the hourly curve or included in its return, drawdown or benchmark statistics.</p>
  <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="text-left p-2">Proposed session date</th><th className="text-left p-2">Original provider UTC label</th><th className="text-right p-2">Account equity</th><th className="text-left p-2">Valuation time</th></tr></thead><tbody>{data.points.map(p=><tr key={p.provider_epoch} className="border-t border-sigil-border"><td className="p-2 whitespace-nowrap">{p.date_index}</td><td className="p-2 whitespace-nowrap">{p.provider_label_utc}</td><td className="p-2 text-right">${p.equity.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td className="p-2">Unknown</td></tr>)}</tbody></table></div>
  <p className="text-xs text-sigil-muted">No synchronized investment-return or alpha calculation. Missing cash/exposure, strategy versions and valuation alignment remain unresolved. Byte matching does not independently authenticate the source.</p>
  <p className="text-xs text-sigil-muted break-all">Source SHA-256: {data.source_sha256}</p>
 </div>;
}

export default function RecoveredDailyHistory(){
 const [result,setResult]=useState<Result|null>(null),[loading,setLoading]=useState(false);
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>{controller.current?.abort();controller.current=null;},[]);
 async function load(){
  controller.current?.abort();const current=new AbortController();controller.current=current;setLoading(true);
  const timer=setTimeout(()=>current.abort(),3000);
  try{const next=await requestRecovery(fetch,current.signal);if(!current.signal.aborted)setResult(next);}
  catch{if(controller.current===current)setResult({state:"error"});}
  finally{clearTimeout(timer);if(controller.current===current)setLoading(false);}
 }
 return <section className="rounded-xl border border-sigil-border bg-sigil-surface p-5 space-y-3" aria-label="Separate recovered daily history">
  <h2 className="text-sm font-semibold uppercase tracking-wider">Recovered daily history</h2>
  <p className="text-xs text-sigil-muted">Optional, separately sourced account observations. Original hourly history remains unchanged.</p>
  <button type="button" className="rounded border border-sigil-border px-3 py-2 text-sm" onClick={load} disabled={loading}>{loading?"Loading separate observations…":"Load recovered daily observations"}</button>
  {result?.state==="available"&&<RecoveredDailyPanel data={result.data}/>}
  {result?.state==="unavailable"&&<p className="text-sm text-sigil-muted">Not configured on this backend. Existing hourly history is unchanged.</p>}
  {result?.state==="error"&&<p role="status" className="text-sm text-amber-300">Recovered history unavailable or invalid. No daily values were merged into hourly history.</p>}
 </section>;
}
