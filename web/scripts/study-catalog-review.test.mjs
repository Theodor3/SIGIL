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
  assert.equal(additions.length,38);assert.equal(snapshot.experiments.length,50);
  assert.equal(new Set(registry.experiments.map(item=>item.id)).size,50);
  assert.deepEqual(projectRegistry(registry,snapshot.reviewedOn),snapshot);
});

test('exact-citation follow-up preserves all 46 existing entries',()=>{
  assert.equal(digest(registry.experiments.slice(0,46)),'f0d333c172f24a59ceff229c5994be96aa22cdfd3d23321ee44f4015bbea5bc8');
  assert.equal(digest(snapshot.experiments.slice(0,46)),'b923a5f9a5c9923505a85c02b11bcb2798635e27a22088238b9d9be03b7b1dad');
});

test('feasibility follow-through preserves all 48 previous entries',()=>{
  assert.equal(digest(registry.experiments.slice(0,48)),'6664fa481b89356b5c602b6066790a2aa795346e00ca74a0f61f4d257a9faa9b');
  assert.equal(digest(snapshot.experiments.slice(0,48)),'a59916cdb0a1e4649676186ab2d6660dab333ba4f8b6c0b3c41f8dfb8843e1f4');
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

test('remaining unverified handoffs and synthetic QA stay outside catalog results',()=>{
  for(const item of additions)assert.doesNotMatch(item.id,/SYNTHETIC|SCORER|BENCHMARK/);
  const backlog=readFileSync(new URL('../../docs/study-catalog-review.md',import.meta.url),'utf8');
  for(const phrase of ['Synthetic 30-minute','MOS / Compass'])assert.ok(backlog.includes(phrase));
});

test('barge and ISO summaries are timing-blocked source audits, not forecast results',()=>{
  const barge=study('BARGE-CAIRO-MEMPHIS-FEASIBILITY-001'),iso=study('ISO-NE-GAS-GENERATION-FEASIBILITY-001');
  for(const item of [barge,iso]){assert.equal(item.status,'timing_blocked');assert.equal(item.predictiveResultsAvailable,false);assert.equal(item.originalPublicationTimesVerified,false);}
  assert.equal(barge.sourceSamples,8);assert.equal(iso.sourceSamples,2);
  const b=JSON.stringify(barge.findings),i=JSON.stringify(iso.findings);
  assert.match(b,/not zero notices.*not a recomputed post-recovery/);
  assert.match(b,/percent of tariff, not dollars per ton/);
  assert.match(b,/September 19 reference does not establish.*effective time/);
  assert.match(b,/869–953.8.*483–869/);
  assert.match(i,/154,390 and 183,857 MWh/);assert.match(i,/not gas fuel use, gas price/);
  assert.match(i,/outcome report must not be used as an input/);
  assert.equal(barge.publicSources[4].url,'https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message?guid=66239383');
  assert.equal(iso.publicSources.length,4);
});

test('new IBM and WASDE summaries retain the reconciled scope and exact citations',()=>{
  const ibm=study('IBM-KIBOT-30M-DEV-001'),wasde=study('CORN-EXPORT-WASDE-2026-001');
  assert.equal(ibm.status,'negative_result');assert.equal(ibm.sourceSamples,47);
  assert.match(JSON.stringify(ibm.findings),/490 eligible paths overall/);
  assert.match(JSON.stringify(ibm.findings),/400 paths in folds of 83, 157 and 160/);
  assert.match(JSON.stringify(ibm.findings),/rolling documentation, not the pinned historical payload/);
  assert.equal(ibm.publicSources[0].url,'https://www.kibot.com/free-historical-intraday-data.html');
  assert.equal(wasde.predictiveResultsAvailable,false);assert.equal(wasde.sourceSamples,1);
  assert.match(JSON.stringify(wasde.findings),/3,300 to 3,275 million bushels/);
  assert.deepEqual(wasde.publicSources.map(s=>s.url),[
    'https://esmis.nal.usda.gov/sites/default/release-files/796099/wasde1026.pdf',
    'https://esmis.nal.usda.gov/sites/default/release-files/796142/wasde1126.pdf',
  ]);
});

test('curated updates keep their partial coverage and original entries',()=>{
  const updates=json('../public/research/updates.json');assert.equal(updates.coverage,'curated_partial');
  assert.equal(updates.updates.length,4);assert.equal(updates.registryContentSha256,snapshot.contentSha256);
  assert.equal(digest(updates.updates),'3c632f4eafcc2a4e0b1c80c9ba5ae782156f266bb8cff81d2e750095ae3f72a3');
  assert.ok(updates.updates.every(item=>snapshot.experiments.some(e=>e.id===item.experimentId)));
});
