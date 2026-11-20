import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {projectRegistry} from './export-experiments.mjs';
const json=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const registry=json('../../.swarm/experiments.json');
const snapshot=json('../public/research/experiments.json');
const additions=registry.experiments.slice(12);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const study=id=>additions.find(item=>item.id===id);

test('all twelve prior registry objects and projected entries remain unchanged',()=>{
  assert.equal(digest(registry.experiments.slice(0,12)),'22857dbace72a58fef40751e8c16692988fdf9a6fa8bbf9e4bc79ab0a520b73d');
  assert.equal(digest(snapshot.experiments.slice(0,12)),'450a447e7d24b34d7f4a4379fff0cbc081bde4b10331e189e2c9714c8080fe46');
});

test('snapshot is the existing publisher projection of the whole deduplicated catalog',()=>{
  assert.equal(additions.length,34);assert.equal(snapshot.experiments.length,46);
  assert.equal(new Set(registry.experiments.map(item=>item.id)).size,46);
  assert.deepEqual(projectRegistry(registry,snapshot.reviewedOn),snapshot);
});

test('new public summaries contain only permitted summary fields and no private artifacts',()=>{
  const allowed=['id','title','type','ticker','stage','status','hypothesisVersion','hypothesis','createdAt','nextAction','originalPublicationTimesVerified','predictiveResultsAvailable','sourceSamples','findings','publicSources'];
  for(const item of additions){
    assert.deepEqual(Object.keys(item).sort(),allowed.sort());
    assert.equal(item.originalPublicationTimesVerified,false);
    const text=JSON.stringify(item);
    assert.doesNotMatch(text,/(?:^|["\s])[A-Z]:[\\/]|\/Users\/|file:\/\/|api_key|access_token|runtimeDispatch|mission_id|BEGIN.*PRIVATE KEY/i);
    for(const finding of item.findings)assert.doesNotMatch(finding.summary,/https?:\/\//);
  }
});

test('pending forecasts and source-feasibility records do not claim predictive results',()=>{
  for(const item of additions.filter(e=>['pending_outcome','source_audit','feasibility_blocked','timing_blocked','blocked_missing_labels'].includes(e.status)))assert.equal(item.predictiveResultsAvailable,false,item.id);
  const pending=additions.filter(e=>e.status==='pending_outcome');assert.equal(pending.length,4);
  for(const item of pending)assert.match(JSON.stringify(item.findings),/unscored|unresolved|not.*scored|no.*scored/i);
  assert.match(JSON.stringify(study('COST-MONTHLY-PROSPECTIVE-001').findings),/deadline.*elapsed/);
});

test('SPY retains correction, negative baselines and sealed-holdout limits',()=>{
  const text=JSON.stringify(study('SPY-2022-INTRADAY-001'));
  assert.match(text,/did not beat the best simple baseline/);assert.match(text,/accumulator was wrong/);
  assert.match(text,/sealed and unscored/);assert.match(text,/without price reloads, refitting or tuning/);
});

test('unverified cloud handoffs and synthetic QA remain outside catalog results',()=>{
  for(const item of additions)assert.doesNotMatch(item.id,/IBM|KIBOT|BARGE|WASDE|ISO-NE|SYNTHETIC|SCORER|BENCHMARK/);
  const backlog=readFileSync(new URL('../../docs/study-catalog-review.md',import.meta.url),'utf8');
  for(const phrase of ['Cairo','WASDE','ISO New England','IBM/Kibot','Synthetic 30-minute','MOS / Compass'])assert.ok(backlog.includes(phrase));
});

test('curated updates keep their partial coverage and original entries',()=>{
  const updates=json('../public/research/updates.json');assert.equal(updates.coverage,'curated_partial');
  assert.equal(updates.updates.length,4);assert.equal(updates.registryContentSha256,snapshot.contentSha256);
  assert.ok(updates.updates.every(item=>snapshot.experiments.some(e=>e.id===item.experimentId)));
});
