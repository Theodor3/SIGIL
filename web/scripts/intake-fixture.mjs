// Generated synthetic aggregates only. No vendor prices, measured results or saved study state.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ID,ROOT,draftCandidate,loadContext,validateCandidate} from './intake-study.mjs';
import {projectRegistry} from './export-experiments.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const models=['no_change','training_mean','numeric_ridge'];

function score(daily){
  const rows=daily.reduce((sum,d)=>sum+d.rows,0),metrics={};
  for(const model of models){
    const row=daily.reduce((sum,d)=>sum+d.absoluteErrorSum[model],0)/rows;
    const day=daily.reduce((sum,d)=>sum+d.absoluteErrorSum[model]/d.rows,0)/daily.length;
    metrics[model]={rowWeightedMAE:row,dayWeightedMAE:day,rowWeightedMAELogBps:row*10000,dayWeightedMAELogBps:day*10000};
  }
  return {rows,sessions:daily.length,daily,metrics};
}
function dates(month){
  const result=[];
  for(let day=1;day<=31;day++){
    const date=`2022-${month}-${String(day).padStart(2,'0')}`,value=new Date(date+'T00:00:00Z');
    if(value.toISOString().slice(0,10)!==date||[0,6].includes(value.getUTCDay())||['2022-09-05','2022-11-24'].includes(date))continue;
    result.push(date);
  }
  return result;
}
export function createFixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sigil-intake-synthetic-'));
  const write=(name,value)=>{const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);return {sha256:sha(bytes),bytes:bytes.length};};
  const registry={schemaVersion:1,experiments:Array.from({length:12},(_,i)=>({id:`SYNTHETIC-${i}`,title:'Synthetic fixture only',type:'synthetic',ticker:'TEST',stage:'synthetic',status:'synthetic',hypothesisVersion:'synthetic-v1',hypothesis:'Generated test data, no research claim',createdAt:'2026-11-19',nextAction:'Test only',originalPublicationTimesVerified:false,predictiveResultsAvailable:false,sourceSamples:0,findings:[],publicSources:[]}))};
  const baseline={};
  baseline['.swarm/experiments.json']=write('.swarm/experiments.json',registry);
  baseline['web/public/research/experiments.json']=write('web/public/research/experiments.json',projectRegistry(registry,'2026-11-19'));
  for(const name of ['web/scripts/intake-study.mjs','web/scripts/export-experiments.mjs','web/package.json']){
    const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(ROOT,name),target);
  }
  const sourceHashes={zip:sha('synthetic archive identity'),csv:sha('synthetic CSV identity')};
  const protocolSha256=sha('synthetic protocol');
  const holdout={start:'2022-12-01',end:'2022-12-31',priceRowsParsed:0,examplesConstructed:0,rowsScored:0};
  const status='development_only_corrected_aggregate';
  const report={status,studyId:'spy-2022-raw-numeric-v1',symbol:'SPY',protocolSha256,inputHashes:sourceHashes,holdout,
    scoringCorrection:{modelsRefit:0,priceRowsReloaded:0,newMarketDataRequests:0,tuningPerformed:false},
    ingestionAudit:{parsedDecemberPriceRows:0,parsedPriceRows:41160,missingMinutes:0,invalidRows:0,selectedAdjustment:'raw'},
    inputCoverage:{sessions:106,observedMinutes:41160,expectedMinutes:41160,missingMinutes:0},horizons:{}};
  for(const horizon of [5,10,30]){
    const folds=['09','10','11'].map((month,index)=>{
      const trainEnd=['2022-08-31','2022-09-30','2022-10-31'][index],firstDate=`2022-${month}-01`,lastDate=['2022-09-30','2022-10-31','2022-11-30'][index];
      const daily=dates(month).map(date=>{const rows=(date==='2022-11-25'?180:360)-horizon;
        const ridge=horizon===10?.9995:horizon===30?[1.0005,.996,1.0005][index]:1.002;
        const mean=horizon===10?.999:horizon===30&&index===2?.999:1;
        return {date,rows,absoluteErrorSum:{no_change:rows*.001,training_mean:rows*.001*mean,numeric_ridge:rows*.001*ridge}};});
      return {id:['sep','oct','nov'][index],training:{sessions:[43,64,85][index],rows:100,firstDate:'2022-07-01',lastDate:trainEnd},validation:{sessions:21,firstDate,lastDate},boundaries:{trainEnd,validationStart:firstDate},fit:{latestTrainingLabelTime:trainEnd+'T20:00:00Z',lambda:1,trainingRows:100},score:score(daily)};
    });
    report.horizons[horizon]={coverage:{developmentSessions:106},folds,pooledDevelopmentValidation:score(folds.flatMap(f=>f.score.daily))};
  }
  const evidence={};
  const save=(name,value)=>{evidence[name]=write(`.swarm/intake-evidence/${ID}/${name}`,value);};
  save('development-report.json',report);
  for(const horizon of [5,10,30])save(`horizon-${horizon}m.json`,{status,horizonMinutes:horizon,...report.horizons[horizon]});
  save('correction-manifest.json',{status:'corrected_from_aggregate_errors_only',protocolSha256,sourceHashes,holdout,postflight:{testsPassed:17,testsFailed:0}});
  save('verification.json',{status:'passed',checkedMetricIdentities:18,outputHashChecksPassed:true,foldTrainingLabelsBeforeValidation:true,holdoutCountersZero:true,allExpectedAnchorCountsVerified:true});
  save('study-summary.json',{status,studyId:report.studyId,holdout});
  save('synthetic-tests.tap','# Synthetic fixture text only; not an executed study receipt\n# pass 17\n# fail 0\n');
  save('metrics.csv','synthetic_fixture_only\n');
  write(`.swarm/intake-policies/${ID}.json`,{schemaVersion:1,id:ID,candidateCreatedOn:'2026-11-19',sourceCommit:'4d8806fb5507d39a9cbbbc75e4796bc655826b86',expectedStudyId:report.studyId,expectedStatus:status,expectedProtocolSha256:protocolSha256,sourceHashes,baseline,evidence});
  const context=loadContext(root),candidate=draftCandidate(context);
  const pin=write(`.swarm/candidates/${ID}.json`,candidate);
  write(`.swarm/candidate-checks/${ID}.json`,{...validateCandidate(candidate,context),candidateSha256:pin.sha256,protectedSourceHashesVerified:true});
  return {root,receipt:path.join(root,`.swarm/candidate-checks/${ID}.json`),cleanup(){
    if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('sigil-intake-synthetic-'))throw new Error('Unexpected fixture cleanup target');
    fs.rmSync(root,{recursive:true,force:true});
  }};
}
