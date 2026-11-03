/** Offline manifest checks. No discovery, source downloads, model calls or dispatch. */
import { createHash } from 'node:crypto';
import { readFileSync,realpathSync,statSync,writeFileSync,renameSync } from 'node:fs';
import { resolve,relative,isAbsolute,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export const contentHash=items=>sha(JSON.stringify(stable(items)));
function pathParts(value){
 if(typeof value!=='string'||!value||value.includes('\\')||value.includes(':')||isAbsolute(value)
  ||value.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid evidence path');
 return value;
}
function spec(value){if(!value||!hash(value.sha256))throw Error('Missing evidence provenance');pathParts(value.path);}
function fieldParts(path){
 if(typeof path!=='string'||!path||path.split('.').some(p=>!/^\w+$/.test(p)||['__proto__','prototype','constructor'].includes(p)))throw Error('Invalid field binding');
 return path.split('.');
}
function field(value,path){
 for(const part of fieldParts(path)){if(!value||!Object.hasOwn(value,part))throw Error('Missing bound field');value=value[part];}
 return value;
}
function numeric(value){
 if((typeof value!=='number'&&typeof value!=='string')||(typeof value==='string'&&!value.trim())||!Number.isFinite(Number(value)))throw Error('Invalid bound metric');
 return Number(value);
}
function instant(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error('Invalid evidence instant');
 const fraction=(value.match(/\.(\d+)/)?.[1]??'').padEnd(9,'0');
 return BigInt(Date.parse(value))*1000000n+BigInt(fraction.slice(3)||'0');
}
export function verify(snapshot,manifest,{readEvidence,allowMissingCheck=false}={}){
 if(!snapshot||!manifest||manifest.schemaVersion!==1||manifest.reviewedOn!==snapshot.reviewedOn
  ||!Array.isArray(snapshot.items)||!snapshot.items.length||!Array.isArray(manifest.entries)
  ||manifest.snapshotItemsSha256!==contentHash(snapshot.items))throw Error('Snapshot not bound to reviewed manifest');
 if(!allowMissingCheck&&(!snapshot.evidenceCheckedAt||!Number.isFinite(Date.parse(snapshot.evidenceCheckedAt))
   ||!/(?:Z|[+-]\d{2}:\d{2})$/.test(snapshot.evidenceCheckedAt)))throw Error('Evidence check timestamp missing');
 const ids=new Set(snapshot.items.map(i=>i.id));
 if(ids.size!==snapshot.items.length||manifest.entries.length!==ids.size||new Set(manifest.entries.map(e=>e.id)).size!==ids.size)throw Error('Manifest identity mismatch');
 const protocolIds=manifest.protocolBindingIds??[];
 if(!Array.isArray(protocolIds)||new Set(protocolIds).size!==protocolIds.length||protocolIds.some(id=>!ids.has(id)))throw Error('Invalid configured protocol bindings');
 const configuredProtocols=new Set(protocolIds);let protocolsChecked=0;
 const readerIds=manifest.readerUrlBindingIds??[];
 if(!Array.isArray(readerIds)||new Set(readerIds).size!==readerIds.length||readerIds.some(id=>!ids.has(id)))throw Error('Invalid reader URL bindings');
 let readerUrlsChecked=0;
 const get=entry=>{
  spec(entry);
  const bytes=readEvidence(entry.path);
  if(!Buffer.isBuffer(bytes)||bytes.length>1_000_000||sha(bytes)!==entry.sha256)throw Error('Evidence missing, oversized or changed');
  return bytes;
 };
 for(const binding of manifest.entries){
  const item=snapshot.items.find(i=>i.id===binding.id);
  if(!item)throw Error('Unknown manifest entry');
  for(const name of ['artifact','source','reviewNote','code'])spec(binding[name]);
  if(Boolean(binding.protocol)!==configuredProtocols.has(binding.id))throw Error('Configured protocol binding missing or unexpected');
  if(binding.protocol){
   spec(binding.protocol);
   for(const name of ['sourceUrlPath','sourceHashPath','sourceIdPath','codeHashPath'])fieldParts(binding.protocol[name]);
   for(const name of ['sourceId','experimentId','trialId'])if(typeof binding.protocol[name]!=='string'||!binding.protocol[name].trim()||binding.protocol[name].length>256)throw Error('Protocol identity missing');
   if(typeof item.source?.url!=='string'||!item.source.url)throw Error('Public source URL missing');
  }
  fieldParts(binding.source.artifactHashPath);
  const supporting=binding.supportingSources??[],publicSupporting=item.supportingSources??[];
  if(Boolean(binding.source.urlBinding)!==readerIds.includes(binding.id))throw Error('Configured reader URL binding missing or unexpected');
  for(const source of [binding.source,...supporting])if(source.urlBinding&&source.urlBinding!=='reader_header')throw Error('Invalid reader binding');
  if(readerIds.includes(binding.id)&&supporting.some(source=>source.urlBinding!=='reader_header'))throw Error('Supporting reader binding missing');
  if(!Array.isArray(supporting)||!Array.isArray(publicSupporting)||supporting.length!==publicSupporting.length)throw Error('Supporting provenance missing');
  supporting.forEach((source,index)=>{spec(source);if(source.sha256!==publicSupporting[index].sha256)throw Error('Supporting source digest differs');if(source.artifactHashPath)fieldParts(source.artifactHashPath);});
  if(binding.artifact.sha256!==item.artifactSha256||binding.source.sha256!==item.source.sha256
   ||!Array.isArray(binding.metricPaths)||binding.metricPaths.length!==item.metrics.length)throw Error('Invalid provenance binding');
  binding.metricPaths.forEach(fieldParts);
  for(const name of ['recordedAtPath','codeHashPath','pendingOutcomePath','deadlinePath'])if(binding[name])fieldParts(binding[name]);
  if(!binding.recordedAtPath&&binding.recordedDate!==item.recordedAt)throw Error('Recording date not declared');
  if(item.status==='pending'&&(!binding.pendingOutcomePath||!binding.deadlinePath||!item.outcomeDueAt))throw Error('Pending outcome binding missing');
  if(readEvidence){
   const result=JSON.parse(get(binding.artifact));get(binding.source);get(binding.reviewNote);get(binding.code);
   for(const [source,publicSource] of [[binding.source,item.source],...supporting.map((source,i)=>[source,publicSupporting[i]])]){
    if(source.artifactUrlPath&&field(result,source.artifactUrlPath)!==publicSource.url)throw Error('Public source URL differs from artifact');
    if(source.urlBinding){
     const text=JSON.parse(get(source));
     // Retained reader header identifies its requested URL; it is not source authentication.
     const header=typeof text==='string'?text.split(/\r?\n/,1)[0]:'';
     const match=header.match(/\((https:\/\/[^\s()]+)\)$/);
     if(!match||match[1]!==publicSource.url)throw Error('Public source URL differs from retained reader header');
     readerUrlsChecked++;
    }
   }
   if(binding.protocol){
    const p=JSON.parse(get(binding.protocol));
    if(field(p,binding.protocol.sourceUrlPath)!==item.source.url)throw Error('Public source URL differs from protocol');
    if(field(p,binding.protocol.sourceHashPath)!==binding.source.sha256||field(p,binding.protocol.codeHashPath)!==binding.code.sha256)throw Error('Protocol source/code provenance differs');
    if(field(p,binding.protocol.sourceIdPath)!==binding.protocol.sourceId||p.experiment_id!==binding.protocol.experimentId||p.trial_id!==binding.protocol.trialId)throw Error('Protocol identity differs');
    protocolsChecked++;
   }
   if(field(result,binding.source.artifactHashPath)!==binding.source.sha256)throw Error('Primary source differs from artifact');
   for(const source of supporting){get(source);if(source.artifactHashPath&&field(result,source.artifactHashPath)!==source.sha256)throw Error('Supporting source differs from artifact');}
   if(binding.codeHashPath&&field(result,binding.codeHashPath)!==binding.code.sha256)throw Error('Code differs from artifact provenance');
   binding.metricPaths.forEach((path,index)=>{if(numeric(field(result,path))!==item.metrics[index].value)throw Error('Metric differs from retained evidence');});
   if(binding.metricLabelPaths){
    if(!Array.isArray(binding.metricLabelPaths)||binding.metricLabelPaths.length!==item.metrics.length)throw Error('Metric label binding missing');
    binding.metricLabelPaths.forEach((path,index)=>{if(field(result,path)!==item.metrics[index].label)throw Error('Metric label differs from artifact');});
   }
   if(binding.unitPath&&field(result,binding.unitPath)!==item.unit)throw Error('Metric unit differs from artifact');
   if(binding.recordedAtPath&&instant(field(result,binding.recordedAtPath))!==instant(item.recordedAt))throw Error('Recording time differs from evidence');
   if(item.status==='pending'&&field(result,binding.pendingOutcomePath)!==null)throw Error('Pending claim no longer supported');
   if(item.status==='pending'&&instant(field(result,binding.deadlinePath))!==instant(item.outcomeDueAt))throw Error('Pending deadline differs from evidence');
  }
 }
 return {mode:readEvidence?'retained_evidence_verified':'snapshot_manifest_only',entries:ids.size,
         protocolBindingsConfigured:protocolIds.length,protocolBindingsChecked:protocolsChecked,
         sourceUrlsWithoutProtocolBinding:ids.size-protocolIds.length,
         readerUrlsChecked,readerBindingsConfigured:readerIds.length,
         ledgerVerification:'not_checked_by_this_tool',externalUrlReachability:'not_checked_offline'};
}
export function evidenceReader(root){
 const base=realpathSync(root);
 return name=>{
  const target=realpathSync(resolve(base,pathParts(name))),path=relative(base,target);
  if(path==='..'||path.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(path))throw Error('Evidence escaped selected root');
  if(!statSync(target).isFile()||statSync(target).size>1_000_000)throw Error('Evidence file invalid');
  return readFileSync(target);
 };
}
export function run({record=false,root=process.env.SIGIL_LOCAL_EVIDENCE_ROOT,snapshotFile,manifestFile}={}){
 const script=dirname(fileURLToPath(import.meta.url));
 const snapshotPath=snapshotFile??resolve(script,'../src/data/researchCheckpoint.json');
 const manifestBytes=readFileSync(manifestFile??resolve(script,'research-checkpoint.manifest.json'));
 const manifest=JSON.parse(manifestBytes),snapshot=JSON.parse(readFileSync(snapshotPath));
 if(record&&!root)throw Error('Recording a check requires retained evidence root');
 if(!record&&snapshot.manifestSha256!==sha(manifestBytes))throw Error('Manifest digest mismatch');
 const result=verify(snapshot,manifest,{readEvidence:root?evidenceReader(root):undefined,allowMissingCheck:record});
 if(record){
  snapshot.evidenceCheckedAt=new Date().toISOString();snapshot.manifestSha256=sha(manifestBytes);
  const temporary=snapshotPath+'.verified.tmp';writeFileSync(temporary,JSON.stringify(snapshot,null,2)+'\n');renameSync(temporary,snapshotPath);
 }
 return {...result,evidenceCheckedAt:snapshot.evidenceCheckedAt,
  scope:'Curated partial snapshot; hashes do not authenticate sources or discover new studies'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(run({record:process.argv.includes('--record-check')}),null,2));}
 catch{console.error('Research checkpoint verification failed; preserve prior snapshot and review provenance.');process.exitCode=1;}
}
