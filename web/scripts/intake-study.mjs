// Offline draft intake only. Import the existing publisher as a validator; never run its CLI.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {projectRegistry} from './export-experiments.mjs';
export const ID='SPY-2022-INTRADAY-001';
export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const check=(ok,message)=>{if(!ok)throw new Error(`Studies intake rejected: ${message}`);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=(file)=>{const stat=fs.lstatSync(file);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1000000,'missing, linked or oversized evidence');return fs.readFileSync(file);};
const json=file=>JSON.parse(read(file).toString('utf8'));
const models=['no_change','training_mean','numeric_ridge'];
const weights=['rowWeightedMAE','dayWeightedMAE'];
const same=(a,b)=>isDeepStrictEqual(a,b);
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-12;

export function preserveCheck(policy,root=ROOT){
  for(const [file,expected]of Object.entries(policy.baseline))check(hash(read(path.join(root,file)))===expected.sha256,`protected source changed: ${file}`);
  return true;
}
export function loadContext(root=ROOT){
  const policy=json(path.join(root,`.swarm/intake-policies/${ID}.json`));
  check(policy.schemaVersion===1&&policy.id===ID&&policy.sourceCommit==='4d8806fb5507d39a9cbbbc75e4796bc655826b86','unrecognized intake policy/source');
  preserveCheck(policy,root);
  const directory=path.join(root,`.swarm/intake-evidence/${ID}`),evidence={},fileHashes={};
  for(const [name,expected]of Object.entries(policy.evidence)){
    check(!name.includes('/')&&!name.includes('\\'),'evidence path escape');const b=read(path.join(directory,name));
    check(b.length===expected.bytes&&hash(b)===expected.sha256,`missing or altered evidence: ${name}`);
    fileHashes[name]=hash(b);evidence[name]=name.endsWith('.json')?JSON.parse(b.toString('utf8')):b.toString('utf8');
  }
  const registry=json(path.join(root,'.swarm/experiments.json')),snapshot=json(path.join(root,'web/public/research/experiments.json'));
  const context={root,policy,evidence,fileHashes,registry,snapshot};validateEvidence(context);return context;
}
export function validateEvidence(context){
  const {evidence:e,policy:p}=context,r=e['development-report.json'],m=e['correction-manifest.json'],v=e['verification.json'],s=e['study-summary.json'];
  check(r?.status===p.expectedStatus&&r.studyId===p.expectedStudyId&&r.symbol==='SPY','superseded, uncorrected or wrong study');
  check(r.protocolSha256===p.expectedProtocolSha256&&same(r.inputHashes,p.sourceHashes),'wrong protocol or source hashes');
  check(m?.status==='corrected_from_aggregate_errors_only'&&m.protocolSha256===r.protocolSha256&&same(m.sourceHashes,r.inputHashes),'missing corrected provenance');
  check(r.scoringCorrection?.modelsRefit===0&&r.scoringCorrection.priceRowsReloaded===0&&r.scoringCorrection.newMarketDataRequests===0&&r.scoringCorrection.tuningPerformed===false,'scoring correction changed experiment');
  for(const h of [r.holdout,m.holdout,s.holdout])check(h?.start==='2022-12-01'&&h.end==='2022-12-31'&&h.priceRowsParsed===0&&h.examplesConstructed===0&&h.rowsScored===0,'unlocked or scored holdout');
  check(r.ingestionAudit?.parsedDecemberPriceRows===0&&r.ingestionAudit.parsedPriceRows===41160&&r.ingestionAudit.missingMinutes===0&&r.ingestionAudit.invalidRows===0&&r.ingestionAudit.selectedAdjustment==='raw','incomplete or wrong development coverage');
  check(r.inputCoverage?.sessions===106&&r.inputCoverage.observedMinutes===41160&&r.inputCoverage.expectedMinutes===41160&&r.inputCoverage.missingMinutes===0,'development coverage not 106 complete sessions');
  check(m.postflight?.testsPassed===17&&m.postflight.testsFailed===0&&/# pass 17\s/.test(e['synthetic-tests.tap']??'')&&/# fail 0\s/.test(e['synthetic-tests.tap']??''),'missing passing synthetic evidence');
  check(v?.status==='passed'&&v.checkedMetricIdentities===18&&v.outputHashChecksPassed===true&&v.foldTrainingLabelsBeforeValidation===true&&v.holdoutCountersZero===true&&v.allExpectedAnchorCountsVerified===true,'missing final verification');
  check(s.status===p.expectedStatus&&s.studyId===r.studyId,'superseded summary');
  check(same(Object.keys(r.horizons).sort(),['10','30','5']),'horizons changed');
  for(const h of [5,10,30]){
    const a=r.horizons[h],individual=e[`horizon-${h}m.json`];
    check(individual?.status===p.expectedStatus&&individual.horizonMinutes===h&&same(individual.folds,a.folds)&&same(individual.pooledDevelopmentValidation,a.pooledDevelopmentValidation),'missing or divergent horizon report');
    check(a.coverage.developmentSessions===106&&a.pooledDevelopmentValidation.sessions===63&&a.pooledDevelopmentValidation.rows===({5:22185,10:21870,30:20610})[h],'wrong validation coverage');
    check(same(a.folds.map(f=>f.id),['sep','oct','nov']),'validation folds changed');
    const dates=new Set();
    for(const [index,f]of a.folds.entries()){
      check(f.training.sessions===[43,64,85][index]&&f.validation.sessions===21&&f.training.firstDate==='2022-07-01'&&f.training.lastDate<f.validation.firstDate,'training/validation coverage mismatch');
      check(f.boundaries.trainEnd===['2022-08-31','2022-09-30','2022-10-31'][index]&&f.validation.lastDate===['2022-09-30','2022-10-31','2022-11-30'][index],'fold boundary mismatch');
      check(Date.parse(f.fit.latestTrainingLabelTime)<Date.parse(f.boundaries.validationStart+'T00:00:00Z')&&f.fit.lambda===1&&f.fit.trainingRows===f.training.rows,'training leakage or model change');
      for(const d of f.score.daily){check(d.date>=f.validation.firstDate&&d.date<=f.validation.lastDate&&d.date<'2022-12-01'&&!dates.has(d.date),'duplicate or holdout validation dates');dates.add(d.date);}
      checkMetrics(f.score);
    }
    check(dates.size===63,'wrong unique validation dates');checkMetrics(a.pooledDevelopmentValidation);
    check(same(a.pooledDevelopmentValidation.daily,a.folds.flatMap(f=>f.score.daily)),'pooled daily evidence diverges');
  }
  const metrics=h=>r.horizons[h].pooledDevelopmentValidation.metrics;
  for(const h of [5,10])for(const w of weights)check(metrics(h).numeric_ridge[w]>=Math.min(metrics(h).no_change[w],metrics(h).training_mean[w]),'5/10 minute claim no longer matches evidence');
  for(const w of weights){const gain=1-metrics(30).numeric_ridge[w]/metrics(30).no_change[w];check(gain>0&&gain<.005,'30 minute gain is not narrowly positive');check(r.horizons[30].folds.some(f=>f.score.metrics.numeric_ridge[w]>=f.score.metrics.no_change[w]),'30 minute inconsistency claim no longer matches evidence');}
  return true;
}
function checkMetrics(score){
  check(Array.isArray(score.daily)&&score.daily.length===score.sessions&&score.daily.reduce((n,d)=>n+d.rows,0)===score.rows,'metric coverage mismatch');
  for(const model of models){
    check(score.daily.every(d=>d.rows>0&&Number.isFinite(d.absoluteErrorSum[model])&&d.absoluteErrorSum[model]>=0),'invalid daily errors');
    const row=score.daily.reduce((n,d)=>n+d.absoluteErrorSum[model],0)/score.rows;
    const day=score.daily.reduce((n,d)=>n+d.absoluteErrorSum[model]/d.rows,0)/score.daily.length;
    const a=score.metrics[model];check(a&&close(a.rowWeightedMAE,row)&&close(a.dayWeightedMAE,day)&&close(a.rowWeightedMAELogBps,row*10000)&&close(a.dayWeightedMAELogBps,day*10000),'invalid MAE arithmetic');
  }
}
export function draftCandidate(context){
  validateEvidence(context);const {policy:p,evidence:e}=context,r=e['development-report.json'];
  const format=h=>{const a=r.horizons[h].pooledDevelopmentValidation.metrics;return models.map(m=>`${m}: ${a[m].rowWeightedMAELogBps.toFixed(6)} row / ${a[m].dayWeightedMAELogBps.toFixed(6)} equal-day`).join('; ');};
  const experiment={id:ID,title:'SPY 2022: fixed intraday numeric comparator',type:'intraday_forecast_comparator',ticker:'SPY',stage:'retrospective_development',status:'mixed_exploratory_result',hypothesisVersion:'spy-2022-raw-numeric-v1',hypothesis:'Do eight fixed causal numeric features reduce 5-, 10- and 30-minute SPY close-to-close log-return forecast MAE versus no-change and training-mean baselines in monthly expanding development folds? This checks forecast error, not a trading strategy.',createdAt:p.candidateCreatedOn,nextAction:'Keep December 2022 locked and unscored. Obtain manual review of the corrected evidence and a separately predeclared independent development replication before considering tokens, LSTMs or a strategy change. No automatic publication, retraining or trading.',originalPublicationTimesVerified:false,predictiveResultsAvailable:true,sourceSamples:106,findings:[
    {id:'COVERAGE',status:'verified_development_only',summary:'July-November 2022: 106 complete SPY regular sessions, 41,160 raw minute bars. September, October and November supply 63 validation sessions. Expanding training uses 43, 64 and 85 sessions. Eligible validation rows: 22,185 at 5 minutes, 21,870 at 10 minutes and 20,610 at 30 minutes.'},
    {id:'PROTOCOL',status:'fixed_numeric_comparator',summary:'Eight fixed trailing numeric features; ridge lambda 1; training-only normalization and fitting; no tuning. Separate 5/10/30-minute log-return targets require complete same-session windows. Decision time is current finalized bar end, not its start label.'},
    {id:'H5',status:'did_not_beat_best_simple_baseline',summary:`Five-minute ridge did not beat the best simple baseline under either MAE weighting. Pooled MAE in log basis points: ${format(5)}.`},
    {id:'H10',status:'did_not_beat_best_simple_baseline',summary:`Ten-minute ridge did not beat the best simple baseline under either MAE weighting. It narrowly improved on no change but trailed training mean. Pooled MAE in log basis points: ${format(10)}.`},
    {id:'H30',status:'narrow_inconsistent_development_improvement',summary:`Thirty-minute ridge only narrowly improved on no change in pooled development MAE. Pooled log basis points: ${format(30)}. This is forecast error, not a return or trading edge.`},
    {id:'MONTHLY_STABILITY',status:'inconsistent_across_months',summary:'Thirty-minute ridge lost to both baselines in September, beat both in October, and lost to training mean in November; equal-day November MAE also lost to no change. A tiny pooled advantage does not establish stable superiority.'},
    {id:'HOLDOUT',status:'locked_unscored',summary:'Every December 2022 SPY observation was reserved unscored: zero December price rows parsed numerically, zero examples constructed and zero scores. Only byte date prefixes were used to exclude December after whole-file integrity hashing. Existing 2026 holdouts were untouched.'},
    {id:'SCORING_CORRECTION',status:'corrected_reports_only',summary:'A daily-error accumulator bug invalidated the first scoring reports. Daily error totals and MAEs were corrected from saved aggregates without reloading prices, refitting models or tuning. Fourteen preflight tests and seventeen post-correction tests passed. Superseded reports are excluded from this candidate.'},
    {id:'LIMITS',status:'no_trading_inference',summary:'One ETF in five months of 2022; overlapping targets; finalized/revised bars with no proof of first receipt or exact availability. No quotes, fills, spreads, fees or slippage were modeled. No trading edge, investment profit, prospective validation or generalization to 2026 IBM is established.'}
  ],publicSources:[]};
  return {schemaVersion:1,publicationMode:'draft_candidate',reviewState:'pending_manual_review',published:false,id:ID,target:{catalogRoute:'/experiments',registryPath:'.swarm/experiments.json',reviewedSnapshotPath:'web/public/research/experiments.json',sourceCommit:p.sourceCommit},holdoutState:'locked_unscored',experiment,evidence:{directory:`.swarm/intake-evidence/${ID}`,reportStatus:p.expectedStatus,protocolSha256:p.expectedProtocolSha256,files:p.evidence},handoffSources:[{title:'HistoricalData.net source documentation; draft handoff only',url:'https://historicaldata.net/stocks.html?direct=1'},{title:'Free sample terms; draft handoff only',url:'https://historicaldata.net/terms.html'},{title:'Exact evaluated sample; draft handoff only',url:'https://historicaldata.net/file/stocks_sample_2022H2.zip',sha256:p.sourceHashes.zip}],sourceLinkPolicy:'No publicSources emitted: historicaldata.net is outside the existing exact-host allowlist. These links stay in the private draft handoff. Publisher and page validation remain unchanged.'};
}
export function validateCandidate(candidate,context,otherDrafts=[]){
  validateEvidence(context);const {registry,snapshot}=context;
  check(registry.schemaVersion===1&&Array.isArray(registry.experiments),'invalid registry');
  const ids=registry.experiments.map(x=>x.id);check(new Set(ids).size===ids.length,'duplicate existing registry IDs');
  check(!ids.includes(ID)&&!snapshot.experiments.some(x=>x.id===ID)&&!otherDrafts.some(x=>x.id===ID),'duplicate candidate ID');
  check(candidate.publicationMode==='draft_candidate'&&candidate.published===false&&candidate.reviewState==='pending_manual_review','candidate must remain unpublished draft');
  check(candidate.holdoutState==='locked_unscored','unlocked holdout');
  check(same(candidate,draftCandidate(context)),'overstated, altered or unsupported candidate evidence');
  const base=projectRegistry(registry,snapshot.reviewedOn);
  check(same(base,snapshot),'registry and reviewed snapshot disagree');
  const temporaryProjection=projectRegistry({...registry,experiments:[...registry.experiments,candidate.experiment]},snapshot.reviewedOn);
  check(same(temporaryProjection.experiments.slice(0,-1),base.experiments),'existing entries altered');
  check(temporaryProjection.experiments.at(-1).publicSources.length===0,'unsupported source link projected');
  return {schemaVersion:1,id:ID,accepted:true,acceptance:'draft_for_manual_review_only',publicationMode:'draft_candidate',published:false,manualReviewPending:true,catalogRoute:'/experiments',existingRegistryEntries:ids.length,inMemoryCompatibilityEntries:temporaryProjection.experiments.length,existingEntriesPreserved:true,publisherUsedForValidationOnly:true,reviewedSnapshotWritten:false,sourceAllowlistChanged:false,sourceLinksKeptInDraftHandoff:true,evidenceFilesVerified:Object.keys(context.fileHashes).length,holdoutLockedAndUnscored:true,correctedEvidenceOnly:true,networkRequired:false,signInRequired:false};
}
// Receipt equality compares parsed JSON objects: whitespace and object key order are irrelevant.
// Candidate SHA-256 deliberately binds the exact bytes that were accepted.
export function validateReceipt(receipt,candidateBytes,context,otherDrafts=[]){
  const candidate=JSON.parse(candidateBytes.toString('utf8'));
  const expected=validateCandidate(candidate,context,otherDrafts);
  preserveCheck(context.policy,context.root);
  expected.candidateSha256=hash(candidateBytes);
  expected.protectedSourceHashesVerified=true;
  check(same(receipt,expected),'stored receipt differs from recomputed acceptance');
  return expected;
}
export function checkReceipt(context,target){
  const receiptPath=path.join(context.root,`.swarm/candidate-checks/${ID}.json`);
  check(fs.existsSync(receiptPath),'required acceptance receipt missing');
  return validateReceipt(json(receiptPath),read(target),context,otherDrafts(context.root,target));
}
function otherDrafts(root,target){const dir=path.join(root,'.swarm/candidates');return fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>f.endsWith('.json')&&path.join(dir,f)!==target).map(f=>json(path.join(dir,f))):[];}
export function main(args=process.argv.slice(2)){
  const [command,...flags]=args;check(['generate','check'].includes(command)&&flags.every(x=>x==='--record')&&flags.length<=1,'usage: intake-study.mjs generate | check [--record]');
  check(command==='check'||flags.length===0,'generation cannot record review');
  const context=loadContext(),target=path.join(ROOT,`.swarm/candidates/${ID}.json`);let candidate;
  if(command==='generate'){check(!fs.existsSync(target),'duplicate draft file');candidate=draftCandidate(context);validateCandidate(candidate,context,otherDrafts(ROOT,target));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(candidate,null,2)+'\n',{flag:'wx'});}
  else candidate=json(target);
  const result=validateCandidate(candidate,context,otherDrafts(ROOT,target));preserveCheck(context.policy);
  result.candidateSha256=hash(read(target));result.protectedSourceHashesVerified=true;
  if(command==='check'&&!flags.includes('--record'))checkReceipt(context,target);
  if(flags.includes('--record')){const file=path.join(ROOT,`.swarm/candidate-checks/${ID}.json`);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
  console.log(JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
