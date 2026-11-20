import test from 'node:test';
import assert from 'node:assert/strict';
import {projectRegistry} from './export-experiments.mjs';
import {exactStudyCitations,rejectedStudyCitations,legacyCitationCases} from './study-source-citation-cases.mjs';
const entry=url=>({id:'SYNTHETIC-CITATION',title:'Synthetic citation check',type:'synthetic',ticker:'TEST',stage:'synthetic',status:'in_progress',hypothesisVersion:'test-1',hypothesis:'Test URL handling only',createdAt:'2026-11-20',nextAction:'No research action',sourceSamples:0,originalPublicationTimesVerified:false,predictiveResultsAvailable:false,findings:[],publicSources:[{title:'Synthetic source test',url}]});
const project=url=>projectRegistry({schemaVersion:1,experiments:[entry(url)]},'2026-11-20');

test('only the three reviewed raw URL strings receive new citation permission',()=>{
  for(const url of exactStudyCitations)assert.equal(project(url).experiments[0].publicSources[0].url,url);
  for(const url of rejectedStudyCitations)assert.throws(()=>project(url),undefined,JSON.stringify(url));
});

test('pre-existing host, transport and userinfo behavior remains unchanged',()=>{
  for(const [url,accepted]of legacyCitationCases){
    if(accepted)assert.doesNotThrow(()=>project(url));
    else assert.throws(()=>project(url));
  }
});
