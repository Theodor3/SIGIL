import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sha,contentHash,verify,evidenceReader,run} from './check-research-checkpoint.mjs';

function fixture(){
 const source=Buffer.from('synthetic source'),code=Buffer.from('synthetic code'),review=Buffer.from('synthetic review record, no authentication');
 const result={values:{base:1,candidate:2},source:sha(source),recorded:'2026-11-03T05:00:00.000001+00:00',code:sha(code),outcome:null,deadline:'2027-03-15T23:59:59Z'};
 const files={'result.json':Buffer.from(JSON.stringify(result)),'source.txt':source,'code.py':code,'review.md':review};
 const spec=name=>({path:name,sha256:sha(files[name])});
 const item={id:'A',status:'pending',recordedAt:'2026-11-03T00:00:00.000001-05:00',outcomeDueAt:result.deadline,
  metrics:[{label:'Baseline',value:1},{label:'Candidate',value:2}],artifactSha256:sha(files['result.json']),source:{sha256:sha(source)}};
 const snapshot={schemaVersion:1,reviewedOn:'2026-11-03',evidenceCheckedAt:'2026-11-03T05:00:00Z',items:[item]};
 const manifest={schemaVersion:1,reviewedOn:snapshot.reviewedOn,snapshotItemsSha256:contentHash(snapshot.items),entries:[{
  id:'A',artifact:spec('result.json'),source:{...spec('source.txt'),artifactHashPath:'source'},code:spec('code.py'),reviewNote:spec('review.md'),
  metricPaths:['values.base','values.candidate'],recordedAtPath:'recorded',pendingOutcomePath:'outcome',deadlinePath:'deadline',codeHashPath:'code'}]};
 const readEvidence=name=>{if(!files[name])throw Error('missing synthetic file');return files[name];};
 return {snapshot,manifest,files,result,readEvidence};
}
function repin(f){
 f.files['result.json']=Buffer.from(JSON.stringify(f.result));
 f.snapshot.items[0].artifactSha256=f.manifest.entries[0].artifact.sha256=sha(f.files['result.json']);
 f.manifest.snapshotItemsSha256=contentHash(f.snapshot.items);
}
test('portable structure check is distinct from local evidence verification',()=>{
 const f=fixture();assert.equal(verify(f.snapshot,f.manifest).mode,'snapshot_manifest_only');
 assert.equal(verify(f.snapshot,f.manifest,f).mode,'retained_evidence_verified');
});
test('missing or changed source, code, review and artifact are refused',()=>{
 for(const name of ['source.txt','code.py','review.md','result.json']){
  for(const change of ['missing','changed']){
   const f=fixture();if(change==='missing')delete f.files[name];else f.files[name]=Buffer.from('changed');
   assert.throws(()=>verify(f.snapshot,f.manifest,f));
  }
 }
});
test('unsupported narrative changes and missing provenance block consistency',()=>{
 for(const change of [f=>f.snapshot.items[0].finding='new claim',f=>delete f.manifest.entries[0].reviewNote,
  f=>f.manifest.entries.push(f.manifest.entries[0]),f=>f.manifest.entries[0].source.path='../private',
  f=>f.manifest.entries[0].metricPaths[0]='constructor.prototype',f=>f.manifest.entries[0].artifact.sha256='bad']){
  const f=fixture();change(f);assert.throws(()=>verify(f.snapshot,f.manifest,f));
 }
});
test('repinned result cannot silently preserve wrong metrics, resolved pending state or deadline',()=>{
 for(const change of [f=>f.result.values.base=99,f=>f.result.outcome=true,f=>f.result.deadline='2027-03-16T23:59:59Z',f=>delete f.result.values.base]){
  const f=fixture();change(f);repin(f);assert.throws(()=>verify(f.snapshot,f.manifest,f));
 }
});
test('offset-equivalent timestamps match, microsecond changes do not',()=>{
 const f=fixture();assert.doesNotThrow(()=>verify(f.snapshot,f.manifest,f));
 f.snapshot.items[0].recordedAt='2026-11-03T00:00:00.000002-05:00';f.manifest.snapshotItemsSha256=contentHash(f.snapshot.items);
 assert.throws(()=>verify(f.snapshot,f.manifest,f),/Recording time/);
});

test('primary source must be bound to the unchanged result, even when manifest and card are repinned',()=>{
 const f=fixture();f.files['source.txt']=Buffer.from('different retained source');
 f.manifest.entries[0].source.sha256=f.snapshot.items[0].source.sha256=sha(f.files['source.txt']);
 f.manifest.snapshotItemsSha256=contentHash(f.snapshot.items);
 assert.throws(()=>verify(f.snapshot,f.manifest,f),/Primary source differs/);
 for(const path of [undefined,'constructor.prototype','missing']){
  const g=fixture();g.manifest.entries[0].source.artifactHashPath=path;
  assert.throws(()=>verify(g.snapshot,g.manifest,g));
 }
 const g=fixture();delete g.manifest.entries[0].source.artifactHashPath;
 assert.throws(()=>verify(g.snapshot,g.manifest));
});

function protocolFixture(){
 const f=fixture();f.snapshot.items[0].source.url='https://www.sec.gov/Archives/original.htm';
 f.manifest.snapshotItemsSha256=contentHash(f.snapshot.items);f.manifest.protocolBindingIds=['A'];
 f.protocol={source_url:f.snapshot.items[0].source.url,data:[{id:'source',sha256:sha(f.files['source.txt'])}],
   code_sha256:sha(f.files['code.py']),experiment_id:'experiment',trial_id:'trial'};
 f.files['protocol.json']=Buffer.from(JSON.stringify(f.protocol));
 f.manifest.entries[0].protocol={path:'protocol.json',sha256:sha(f.files['protocol.json']),sourceUrlPath:'source_url',
   sourceHashPath:'data.0.sha256',sourceIdPath:'data.0.id',sourceId:'source',codeHashPath:'code_sha256',experimentId:'experiment',trialId:'trial'};
 return f;
}

test('unbound legacy source links are explicitly outside protocol coverage',()=>{
 const f=fixture();f.snapshot.items[0].source.url='https://www.sec.gov/Archives/different.htm';
 f.manifest.snapshotItemsSha256=contentHash(f.snapshot.items);
 const result=verify(f.snapshot,f.manifest,f);
 assert.equal(result.sourceUrlsWithoutProtocolBinding,1);assert.equal(result.protocolBindingsChecked,0);
 assert.equal(result.ledgerVerification,'not_checked_by_this_tool');
});

test('configured protocol binds URL, source, code and identities with exact retained bytes',()=>{
 const f=protocolFixture();assert.equal(verify(f.snapshot,f.manifest,f).protocolBindingsChecked,1);
 f.snapshot.items[0].source.url='https://www.sec.gov/Archives/another-valid-host-link.htm';
 f.manifest.snapshotItemsSha256=contentHash(f.snapshot.items);
 assert.throws(()=>verify(f.snapshot,f.manifest,f),/URL differs/);
 for(const mutate of [p=>p.data[0].sha256='f'.repeat(64),p=>p.code_sha256='f'.repeat(64),
   p=>p.data[0].id='other-source',p=>p.experiment_id='other-experiment',p=>p.trial_id='other-trial']){
  const g=protocolFixture();mutate(g.protocol);g.files['protocol.json']=Buffer.from(JSON.stringify(g.protocol));
  g.manifest.entries[0].protocol.sha256=sha(g.files['protocol.json']);
  assert.throws(()=>verify(g.snapshot,g.manifest,g));
 }
});

test('missing or changed configured protocol refuses verification without refreshing the stamp',()=>{
 for(const mutate of [f=>delete f.files['protocol.json'],f=>f.files['protocol.json']=Buffer.from('{}'),
   f=>delete f.manifest.entries[0].protocol,f=>delete f.manifest.entries[0].protocol.sourceIdPath]){
  const f=protocolFixture(),stamp=f.snapshot.evidenceCheckedAt;mutate(f);
  assert.throws(()=>verify(f.snapshot,f.manifest,f));assert.equal(f.snapshot.evidenceCheckedAt,stamp);
 }
});

test('failed protocol recheck preserves the actual prior snapshot file and timestamp',()=>{
 for(const kind of ['missing','url-mismatch']){
  const root=fs.mkdtempSync(join(tmpdir(),'sigil-protocol-check-')),f=protocolFixture();
  const snapshotFile=join(root,'snapshot.json'),manifestFile=join(root,'manifest.json');
  const before=Buffer.from(JSON.stringify(f.snapshot));
  if(kind==='url-mismatch'){
   f.protocol.source_url='https://www.sec.gov/Archives/different.htm';
   f.files['protocol.json']=Buffer.from(JSON.stringify(f.protocol));
   f.manifest.entries[0].protocol.sha256=sha(f.files['protocol.json']);
  }else delete f.files['protocol.json'];
  try{
   fs.writeFileSync(snapshotFile,before);fs.writeFileSync(manifestFile,JSON.stringify(f.manifest));
   for(const [name,bytes]of Object.entries(f.files))fs.writeFileSync(join(root,name),bytes);
   assert.throws(()=>run({record:true,root,snapshotFile,manifestFile}));
   assert.deepEqual(fs.readFileSync(snapshotFile),before);
   assert.equal(JSON.parse(fs.readFileSync(snapshotFile)).evidenceCheckedAt,f.snapshot.evidenceCheckedAt);
  }finally{
   for(const name of [...Object.keys(f.files),'snapshot.json','manifest.json','snapshot.json.verified.tmp']){
    const path=join(root,name);if(fs.existsSync(path))fs.unlinkSync(path);
   }
   fs.rmdirSync(root);
  }
 }
});
test('missing or changed supporting forecast input refuses a fresh check',()=>{
 const f=fixture(),extra=Buffer.from('synthetic annual input');f.files['annual.txt']=extra;
 f.result.annual=sha(extra);repin(f);
 f.snapshot.items[0].supportingSources=[{sha256:sha(extra)}];
 f.manifest.entries[0].supportingSources=[{path:'annual.txt',sha256:sha(extra),artifactHashPath:'annual'}];
 f.manifest.snapshotItemsSha256=contentHash(f.snapshot.items);
 assert.doesNotThrow(()=>verify(f.snapshot,f.manifest,f));
 delete f.files['annual.txt'];assert.throws(()=>verify(f.snapshot,f.manifest,f));
 f.files['annual.txt']=Buffer.from('changed annual');assert.throws(()=>verify(f.snapshot,f.manifest,f));
 f.files['annual.txt']=extra;delete f.manifest.entries[0].supportingSources;assert.throws(()=>verify(f.snapshot,f.manifest,f));
});
test('failed recording preserves the prior snapshot and cannot bless missing evidence',()=>{
 const root=fs.mkdtempSync(join(tmpdir(),'sigil-checkpoint-'));const f=fixture();
 const snapshotFile=join(root,'snapshot.json'),manifestFile=join(root,'manifest.json');
 const raw=Buffer.from(JSON.stringify(f.snapshot));fs.writeFileSync(snapshotFile,raw);fs.writeFileSync(manifestFile,JSON.stringify(f.manifest));
 try{
  assert.throws(()=>run({record:true,root,snapshotFile,manifestFile}));
  assert.deepEqual(fs.readFileSync(snapshotFile),raw);
  assert.throws(()=>evidenceReader(root)('../outside'));
  for(const [name,bytes]of Object.entries(f.files))fs.writeFileSync(join(root,name),bytes);
  const result=run({record:true,root,snapshotFile,manifestFile});assert.equal(result.mode,'retained_evidence_verified');
  const saved=JSON.parse(fs.readFileSync(snapshotFile));assert.equal(saved.manifestSha256,sha(fs.readFileSync(manifestFile)));
 }finally{
  for(const name of [...Object.keys(f.files),'snapshot.json','manifest.json','snapshot.json.verified.tmp']){
   const path=join(root,name);if(fs.existsSync(path))fs.unlinkSync(path);
  }
  fs.rmdirSync(root); // Empty directory only; no recursive deletion.
 }
});

test('reader URL bindings reject changed primary/supporting links and missing configuration',()=>{
 const f=fixture();const url='https://issuer.example/release';f.files['source.txt']=Buffer.from(JSON.stringify('Issuer release ('+url+')\nretained text'));
 f.result.source=sha(f.files['source.txt']);f.manifest.entries[0].source.sha256=f.snapshot.items[0].source.sha256=f.result.source;
 f.snapshot.items[0].source.url=url;f.manifest.entries[0].source.urlBinding='reader_header';f.manifest.readerUrlBindingIds=['A'];repin(f);
 assert.equal(verify(f.snapshot,f.manifest,f).readerUrlsChecked,1);
 f.snapshot.items[0].source.url='https://issuer.example/other';f.manifest.snapshotItemsSha256=contentHash(f.snapshot.items);
 assert.throws(()=>verify(f.snapshot,f.manifest,f),/reader header/);
 delete f.manifest.entries[0].source.urlBinding;assert.throws(()=>verify(f.snapshot,f.manifest,f),/binding missing/);
});

test('all retained checkpoint cards reject metric and bound URL mismatches',{skip:!process.env.SIGIL_LOCAL_EVIDENCE_ROOT},()=>{
 const snapshot=JSON.parse(fs.readFileSync(new URL('../src/data/researchCheckpoint.json',import.meta.url)));
 const manifest=JSON.parse(fs.readFileSync(new URL('./research-checkpoint.manifest.json',import.meta.url)));
 const readEvidence=evidenceReader(process.env.SIGIL_LOCAL_EVIDENCE_ROOT);
 const result=verify(snapshot,manifest,{readEvidence});assert.equal(result.protocolBindingsChecked,2);assert.equal(result.readerUrlsChecked,3);
 for(const original of snapshot.items){const s=structuredClone(snapshot),m=structuredClone(manifest);s.items.find(x=>x.id===original.id).metrics[0].value+=1;m.snapshotItemsSha256=contentHash(s.items);assert.throws(()=>verify(s,m,{readEvidence}),/Metric differs/);}
 for(const id of ['WMT-ROI','NOW-CASH','NOW-CFO-PENDING']){const s=structuredClone(snapshot),m=structuredClone(manifest);s.items.find(x=>x.id===id).source.url+='?wrong';m.snapshotItemsSha256=contentHash(s.items);assert.throws(()=>verify(s,m,{readEvidence}),/URL differs/);}
 const s=structuredClone(snapshot),m=structuredClone(manifest);s.items.find(x=>x.id==='NOW-CFO-PENDING').supportingSources[0].url+='?wrong';m.snapshotItemsSha256=contentHash(s.items);assert.throws(()=>verify(s,m,{readEvidence}),/reader header/);
});

test('portable supporting reader mismatch fails even with repinned public metadata',()=>{
 const f=fixture(),url='https://issuer.example/annual';
 f.files['annual.json']=Buffer.from(JSON.stringify('Annual ('+url+')\nretained'));
 f.result.annual=sha(f.files['annual.json']);
 f.manifest.entries[0].supportingSources=[{path:'annual.json',sha256:f.result.annual,artifactHashPath:'annual',urlBinding:'reader_header'}];
 f.snapshot.items[0].supportingSources=[{sha256:f.result.annual,url}];repin(f);
 assert.doesNotThrow(()=>verify(f.snapshot,f.manifest,f));
 f.snapshot.items[0].supportingSources[0].url+='?wrong';f.manifest.snapshotItemsSha256=contentHash(f.snapshot.items);
 assert.throws(()=>verify(f.snapshot,f.manifest,f),/reader header/);
});

test('hyperscaler source links bind to retained artifact for both issuers',{skip:!process.env.SIGIL_LOCAL_EVIDENCE_ROOT},()=>{
 const snapshot=JSON.parse(fs.readFileSync(new URL('../src/data/researchCheckpoint.json',import.meta.url)));
 const manifest=JSON.parse(fs.readFileSync(new URL('./research-checkpoint.manifest.json',import.meta.url)));
 const readEvidence=evidenceReader(process.env.SIGIL_LOCAL_EVIDENCE_ROOT);
 for(const index of [-1,0,6]){
  const s=structuredClone(snapshot),m=structuredClone(manifest),item=s.items.find(x=>x.id==='HYPERSCALER-CASH');
  const source=index===-1?item.source:item.supportingSources[index];source.url+='?wrong';m.snapshotItemsSha256=contentHash(s.items);
  assert.throws(()=>verify(s,m,{readEvidence}),/URL differs from artifact/);
 }
});

test('hyperscaler labels and units cannot drift from reviewed artifact',{skip:!process.env.SIGIL_LOCAL_EVIDENCE_ROOT},()=>{
 const snapshot=JSON.parse(fs.readFileSync(new URL('../src/data/researchCheckpoint.json',import.meta.url)));
 const manifest=JSON.parse(fs.readFileSync(new URL('./research-checkpoint.manifest.json',import.meta.url)));
 for(const change of [i=>i.metrics[0].label='GOOGL wrong quarter',i=>i.unit='USD millions']){
  const s=structuredClone(snapshot),m=structuredClone(manifest);change(s.items.find(x=>x.id==='HYPERSCALER-CASH'));m.snapshotItemsSha256=contentHash(s.items);
  assert.throws(()=>verify(s,m,{readEvidence:evidenceReader(process.env.SIGIL_LOCAL_EVIDENCE_ROOT)}),/label differs|unit differs/);
 }
});

test('checked-out reviewed manifest retains its recorded byte digest',()=>{
 const manifestBytes=fs.readFileSync(new URL('./research-checkpoint.manifest.json',import.meta.url));
 const snapshot=JSON.parse(fs.readFileSync(new URL('../src/data/researchCheckpoint.json',import.meta.url)));
 assert.equal(sha(manifestBytes),snapshot.manifestSha256);
 assert.equal(verify(snapshot,JSON.parse(manifestBytes)).mode,'snapshot_manifest_only');
});
