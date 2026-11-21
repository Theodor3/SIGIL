import test, {after} from 'node:test';
import {createFixture} from './intake-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {projectRegistry} from './export-experiments.mjs';
import {ID,loadContext,draftCandidate,validateCandidate,validateEvidence,preserveCheck,main} from './intake-study.mjs';
const fixture=createFixture();after(()=>fixture.cleanup());
const ROOT=fixture.root;
const context=()=>loadContext(ROOT);
test('one corrected candidate fits the existing registry without publishing or altering entries',()=>{const c=context(),before=fs.readFileSync(`${ROOT}/web/public/research/experiments.json`),candidate=draftCandidate(c),result=validateCandidate(candidate,c);assert.equal(result.accepted,true);assert.equal(result.published,false);assert.equal(result.existingRegistryEntries,12);assert.equal(result.inMemoryCompatibilityEntries,13);assert.equal(result.reviewedSnapshotWritten,false);assert.deepEqual(fs.readFileSync(`${ROOT}/web/public/research/experiments.json`),before);});
test('draft has truthful negative/mixed findings and explicit source/timing limits',()=>{const x=draftCandidate(context());assert.equal(x.experiment.sourceSamples,106);assert.equal(x.experiment.originalPublicationTimesVerified,false);assert.equal(x.experiment.status,'mixed_exploratory_result');assert.equal(x.experiment.findings.find(f=>f.id==='H5').status,'did_not_beat_best_simple_baseline');assert.equal(x.experiment.findings.find(f=>f.id==='H10').status,'did_not_beat_best_simple_baseline');assert.match(x.experiment.findings.find(f=>f.id==='H30').summary,/only narrowly/);assert.match(x.experiment.findings.find(f=>f.id==='LIMITS').summary,/No trading edge/);});
test('same evidence produces deterministic draft bytes',()=>{assert.deepEqual(draftCandidate(context()),draftCandidate(context()));});
test('missing required corrected evidence rejects',()=>{for(const name of ['development-report.json','correction-manifest.json','horizon-10m.json','verification.json','synthetic-tests.tap']){const c=context();delete c.evidence[name];assert.throws(()=>validateEvidence(c));}});
test('superseded reports and wrong source/protocol cannot be substituted',()=>{for(const mutate of [c=>c.evidence['development-report.json'].status='development_only',c=>c.evidence['development-report.json'].protocolSha256='0'.repeat(64),c=>c.evidence['development-report.json'].inputHashes.csv='0'.repeat(64)]){const c=context();mutate(c);assert.throws(()=>validateEvidence(c));}});
test('unlocked or scored holdout rejects in report, manifest, summary and draft',()=>{for(const file of ['development-report.json','correction-manifest.json','study-summary.json']){const c=context();c.evidence[file].holdout.rowsScored=1;assert.throws(()=>validateEvidence(c));}const c=context(),draft=draftCandidate(c);draft.holdoutState='unlocked';assert.throws(()=>validateCandidate(draft,c),/unlocked holdout/);});
test('duplicate IDs reject in existing registry, snapshot or another draft',()=>{const c=context(),x=draftCandidate(c);for(const change of [a=>a.registry.experiments.push(a.registry.experiments[0]),a=>a.registry.experiments.push(x.experiment),a=>a.snapshot.experiments.push(x.experiment)]){const a=context();change(a);assert.throws(()=>validateCandidate(x,a),/duplicate/);}assert.throws(()=>validateCandidate(x,c,[{id:ID}]),/duplicate/);});
test('overstated evidence, extra permission fields and published status reject',()=>{const c=context();for(const change of [x=>x.experiment.title='Validated profitable strategy',x=>x.experiment.originalPublicationTimesVerified=true,x=>x.experiment.findings.find(f=>f.id==='H30').summary='Reliable trading edge',x=>x.runtimeDispatchEnabled=true,x=>x.published=true,x=>x.publicationMode='reviewed_snapshot']){const x=draftCandidate(c);change(x);assert.throws(()=>validateCandidate(x,c));}});
test('source URLs stay in handoff; exact-host publisher remains restrictive',()=>{const c=context(),x=draftCandidate(c);assert.deepEqual(x.experiment.publicSources,[]);assert.ok(x.handoffSources.every(s=>new URL(s.url).hostname==='historicaldata.net'));for(const url of ['https://historicaldata.net/stocks.html','https://historicaldata.net.evil.example/','http://www.eia.gov/']){const bad=structuredClone(x.experiment);bad.publicSources=[{title:'unsupported',url}];assert.throws(()=>projectRegistry({schemaVersion:1,experiments:[bad]},'2026-11-19'));}preserveCheck(c.policy,ROOT);});
test('tampered MAE or mismatched horizon cannot be accepted',()=>{const c=context();c.evidence['horizon-30m.json'].pooledDevelopmentValidation.metrics.numeric_ridge.rowWeightedMAE=0;assert.throws(()=>validateEvidence(c));const a=context();a.evidence['development-report.json'].horizons['30'].folds[0].fit.latestTrainingLabelTime='2022-12-01T00:00:00Z';assert.throws(()=>validateEvidence(a));});
test('evidence provenance requiring fresh data, refit or tuning rejects',()=>{for(const [k,v]of [['modelsRefit',1],['priceRowsReloaded',1],['newMarketDataRequests',1],['tuningPerformed',true]]){const c=context();c.evidence['development-report.json'].scoringCorrection[k]=v;assert.throws(()=>validateEvidence(c));}});
test('protected snapshot/publisher hashes fail closed',()=>{const c=context();c.policy.baseline['web/public/research/experiments.json'].sha256='0'.repeat(64);assert.throws(()=>preserveCheck(c.policy,ROOT),/protected source changed/);});
test('offline gate requires neither fetch nor sign-in',()=>{const old=globalThis.fetch;globalThis.fetch=()=>{throw new Error('network forbidden in offline check');};try{const c=context(),r=validateCandidate(draftCandidate(c),c);assert.equal(r.networkRequired,false);assert.equal(r.signInRequired,false);}finally{globalThis.fetch=old;}});
test('unknown CLI actions and publish flags fail closed',()=>{assert.throws(()=>main(['publish']));assert.throws(()=>main(['generate','--publish']));assert.throws(()=>main(['generate','--record']));});

function recompute(c,h){
  const report=c.evidence['development-report.json'].horizons[h];
  const metrics=score=>{
    score.rows=score.daily.reduce((sum,d)=>sum+d.rows,0);score.sessions=score.daily.length;
    for(const model of ['no_change','training_mean','numeric_ridge']){
      const row=score.daily.reduce((sum,d)=>sum+d.absoluteErrorSum[model],0)/score.rows;
      const day=score.daily.reduce((sum,d)=>sum+d.absoluteErrorSum[model]/d.rows,0)/score.daily.length;
      score.metrics[model]={rowWeightedMAE:row,dayWeightedMAE:day,rowWeightedMAELogBps:row*10000,dayWeightedMAELogBps:day*10000};
    }
  };
  report.folds.forEach(f=>metrics(f.score));
  report.pooledDevelopmentValidation.daily=report.folds.flatMap(f=>f.score.daily);
  metrics(report.pooledDevelopmentValidation);
  c.evidence[`horizon-${h}m.json`].folds=structuredClone(report.folds);
  c.evidence[`horizon-${h}m.json`].pooledDevelopmentValidation=structuredClone(report.pooledDevelopmentValidation);
}

test('arithmetically consistent comparisons contradicting fixed prose fail closed',()=>{
  for(const [h,folds,model,factor,message]of [
    [10,[0,1,2],'numeric_ridge',1.002,/10 minute baseline ordering/],
    [10,[0,1,2],'numeric_ridge',1,/10 minute baseline ordering/],
    [30,[0],'numeric_ridge',.9995,/September ordering/],
    [30,[1],'training_mean',.995,/October ordering/],
    [30,[2],'training_mean',1.001,/November training-mean ordering/],
    [30,[2],'no_change',1.002,/November equal-day ordering/],
  ]){
    const c=context(),a=c.evidence['development-report.json'].horizons[h];
    for(const index of folds)for(const day of a.folds[index].score.daily)day.absoluteErrorSum[model]=day.rows*.001*factor;
    recompute(c,h);
    assert.throws(()=>validateEvidence(c),message);
    assert.throws(()=>draftCandidate(c),message);
  }
});

test('accepted synthetic evidence supports every fixed baseline and monthly statement',()=>{
  const c=context(),r=c.evidence['development-report.json'];draftCandidate(c);
  for(const w of ['rowWeightedMAE','dayWeightedMAE']){
    const ten=r.horizons[10].pooledDevelopmentValidation.metrics;
    assert.ok(ten.training_mean[w]<ten.numeric_ridge[w]&&ten.numeric_ridge[w]<ten.no_change[w]);
    const [sep,oct,nov]=r.horizons[30].folds.map(f=>f.score.metrics);
    assert.ok(sep.numeric_ridge[w]>Math.max(sep.no_change[w],sep.training_mean[w]));
    assert.ok(oct.numeric_ridge[w]<Math.min(oct.no_change[w],oct.training_mean[w]));
    assert.ok(nov.numeric_ridge[w]>nov.training_mean[w]);
  }
  const nov=r.horizons[30].folds[2].score.metrics;
  assert.ok(nov.numeric_ridge.dayWeightedMAE>nov.no_change.dayWeightedMAE);
});
