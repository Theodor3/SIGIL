import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require=createRequire(import.meta.url);
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const data=JSON.parse(read('../src/data/researchCheckpoint.json'));
function load(source,imports={}){
 const module={exports:{}};
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(name=>name in imports?imports[name]:require(name),module,module.exports);
 return module.exports;
}
const helpers=load(read('../src/lib/researchCheckpoint.ts'));
const component=()=>load(read('../src/components/ResearchCheckpoint.tsx'),{
 'react':React,'../data/researchCheckpoint.json':data,'../lib/researchCheckpoint':helpers}).default;
const evidenceRoot=process.env.SIGIL_LOCAL_EVIDENCE_ROOT;
const artifact=relative=>JSON.parse(readFileSync(join(evidenceRoot,relative),'utf8'));

test('local-only: curated figures bind to retained outputs',{skip:!evidenceRoot},()=>{
 helpers.checkpoint(data);
 const sources={
  'HYPERSCALER-CASH':['hyperscaler-original-releases-20261103/checkpoint.json',r=>r.metrics.map(m=>m.value),r=>r.metrics[0].source_sha256],
  'COST-WC':['costco-working-capital-20261103/results/result.json',r=>[+r.cash_after_ppe_growth_pct,+r.two_item_neutral_after_ppe_growth_pct],r=>r.source_sha256],
  'WMT-ROI':['wmt-reinvestment-identification-20261103/results/result.json',r=>[+r.prior_ROI_pct,+r.current_ROI_pct],r=>r.source_sha256],
  'NOW-CASH':['now-capex-quality-20261103/results/result.json',r=>[+r.quarter.per_share_growth_pct,+r.quarter.normalized_per_share_growth_pct],r=>r.source_hashes.q3],
  'NOW-CFO-PENDING':['now-capex-quality-20261103/results/result.json',r=>[+r.forecast.candidate_pct,+r.forecast.seasonal_baseline_pct,+r.forecast.latest_quarter_baseline_pct],r=>r.source_hashes.q3],
  'TRANSIT-BLEND':['transit-fixed-blend-test/result.json',r=>[r.macro_annual,r.macro_blend],r=>r.source_sha256],
 };
 const representations={
  'HYPERSCALER-CASH':'hyperscaler-original-releases-20261103/msft-q2.html',
  'COST-WC':'costco-membership-study/official-reader-response.json',
  'WMT-ROI':'wmt-fy25-timing/raw/q3-ir-exhibit.html',
  'NOW-CASH':'servicenow-margin-prospective/q3-reader.json',
  'NOW-CFO-PENDING':'servicenow-margin-prospective/q3-reader.json',
  'TRANSIT-BLEND':'investment-pilot-data/ridership-panel-extension-20261102/panel-final.json',
 };
 for(const item of data.items){
  const [file,metrics,hash]=sources[item.id];const raw=readFileSync(join(evidenceRoot,file));const result=JSON.parse(raw);
  assert.deepEqual(item.metrics.map(m=>m.value),metrics(result));
  assert.equal(item.source.sha256,hash(result));
  assert.equal(item.source.sha256,createHash('sha256').update(readFileSync(join(evidenceRoot,representations[item.id]))).digest('hex'));
  assert.equal(item.artifactSha256,createHash('sha256').update(raw).digest('hex'));
 }
 assert.equal(data.items.find(i=>i.id==='NOW-CFO-PENDING').status,'pending');
 assert.equal(artifact('now-capex-quality-20261103/results/result.json').forecast.observed_outcome,null);
});
test('portable checkpoint validates explicit representations and pending state',()=>{
 helpers.checkpoint(data);
 assert.equal(data.items.find(i=>i.id==='TRANSIT-BLEND').source.representation,'Retained derived model panel');
 assert.equal(data.items.find(i=>i.id==='NOW-CFO-PENDING').status,'pending');
});
test('status filtering preserves original data and sorts by recording date',()=>{
 const before=JSON.stringify(data);const negative=helpers.visibleEvidence(data.items,'negative');
 assert.equal(negative.length,2);assert.ok(negative.every(i=>i.status==='negative'));
 const all=helpers.visibleEvidence(data.items,'all');
 assert.equal(all[0].id,'HYPERSCALER-CASH');assert.equal(JSON.stringify(data),before);
});
test('invalid evidence, unsafe URLs and private paths fail visibly',()=>{
 for(const change of [d=>d.items.push(d.items[0]),d=>d.items[0].metrics[0].value=NaN,
  d=>d.items[0].source.url='file:///private',d=>d.items[0].source.url='https://www.sec.gov.evil.example/file',
  d=>d.items[0].source.url='https://secret@www.sec.gov/file',d=>d.items[0].finding='Private C:\\Users\\owner',
  d=>d.items[0].recordedAt='2026-11-03T01:00:00',d=>d.reviewedOn='2026-02-30',d=>d.items[0].artifactSha256='bad',
  d=>d.items[0].metrics[1].label=d.items[0].metrics[0].label,d=>delete d.evidenceCheckedAt,
  d=>delete d.manifestSha256,d=>delete d.items.find(i=>i.status==='pending').outcomeDueAt]){
  const copy=structuredClone(data);change(copy);assert.throws(()=>helpers.checkpoint(copy));
 }
});
test('as-of warnings distinguish old snapshots, future clocks and overdue pending entries',()=>{
 const before=JSON.stringify(data),checked=Date.parse(data.evidenceCheckedAt);
 assert.match(helpers.checkpointAgeNotice(data,checked+8*86400000),/more than seven days/);
 assert.match(helpers.checkpointAgeNotice(data,checked-1),/future/);
 assert.match(helpers.checkpointAgeNotice(data,checked),/not added automatically/);
 const pending=data.items.find(i=>i.status==='pending');const deadline=Date.parse(pending.outcomeDueAt);
 assert.equal(helpers.pendingReviewNeeded(pending,deadline),false);
 assert.equal(helpers.pendingReviewNeeded(pending,deadline+1),true);
 assert.equal(JSON.stringify(data),before);
});
test('signed charts have a shared zero and monotonic scale within each study',()=>{
 const x=helpers.chartScale([-3,30]);assert.ok(x(-3)<x(0)&&x(0)<x(30));
 assert.equal(helpers.chartScale([0,0])(0),210);
});
test('actual component server-renders periods, limitations and unscored predictions',()=>{
 const html=renderToStaticMarkup(React.createElement(component()));
 assert.match(html,/Curated evidence/);assert.match(html,/not newly published company data/);
 assert.match(html,/Snapshot as of/);assert.match(html,/Evidence checked/);assert.match(html,/not added automatically/);
 assert.match(html,/Predictions only/);assert.match(html,/not performance/);assert.match(html,/Archived TTM October 2023/);
 assert.match(html,/Inconclusive/);assert.match(html,/Negative result/);assert.match(html,/Pending outcome/);
 assert.equal((html.match(/<svg /g)||[]).length,6);assert.equal((html.match(/<table /g)||[]).length,6);
 assert.doesNotMatch(html,/C:\\Users|file:\/\//);
});

test('hyperscaler paired quarters share signed scale and explicit cash definition',()=>{
 const item=data.items.find(i=>i.id==='HYPERSCALER-CASH');
 assert.deepEqual(item.metrics.map(m=>m.value),[5.882,24.551,15.803,10.116,19.639,-5.855,18.633,-9.065]);
 assert.equal(item.supportingSources.length,7);assert.match(item.finding,/not AI-specific return or a trading signal/);
 const html=renderToStaticMarkup(React.createElement(component()));
 for(const metric of item.metrics)assert.ok(html.includes(metric.label));
 assert.match(html,/USD billions/);assert.match(html,/No separate lease adjustment/);
 const bad=structuredClone(data);bad.items.find(i=>i.id===item.id).metrics.push({label:'extra',value:0});assert.throws(()=>helpers.checkpoint(bad));
});
test('page integrates checkpoint without claiming registry or live-worker availability',()=>{
 const page=read('../src/pages/Experiments.tsx');assert.match(page,/!experimentId && <ResearchCheckpoint \/>/);
 const css=read('../src/pages/Experiments.css');assert.match(css,/@media\(max-width:800px\)\{\.checkpoint-grid\{grid-template-columns:1fr/);
});
