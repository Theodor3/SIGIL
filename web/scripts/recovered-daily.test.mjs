import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const source=readFileSync(new URL('../src/components/RecoveredDailyHistory.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};new Function('require','exports',code)(createRequire(import.meta.url),exports);
const fixture=()=>({schema_version:1,available:true,source_label:'Alpaca paper account history',source_sha256:'a'.repeat(64),retrieved_at:'2026-11-03T17:08:47Z',separate_from_hourly:true,comparison_allowed:false,valuation_time_known:false,metrics:null,points:[{date_index:'2026-10-09',provider_epoch:1791590400,provider_label_utc:'2026-10-10T00:00:00Z',equity:100,valuation_at:null,resolution:'daily'}]});

test('source labels and provisional dates stay separate from hourly statistics',()=>{
 const data=fixture();assert.equal(exports.validRecovery(data),true);
 const html=renderToStaticMarkup(React.createElement(exports.RecoveredDailyPanel,{data}));
 assert.match(html,/proposed session dates/);assert.match(html,/valuation time unknown/);
 assert.match(html,/2026-10-10T00:00:00Z/);assert.match(html,/not inserted into the hourly curve/);
 assert.match(html,/No synchronized investment-return or alpha calculation/);
 assert.doesNotMatch(html,/<script|<form|Return:|Sharpe:/i);
});
test('initial card is manual and independent of existing performance data',()=>{
 const html=renderToStaticMarkup(React.createElement(exports.default));
 assert.match(html,/Load recovered daily observations/);assert.doesNotMatch(html,/\$100/);
 const page=readFileSync(new URL('../src/pages/Performance.tsx',import.meta.url),'utf8');
 assert.ok(page.indexOf('<RecoveredDailyHistory />')<page.indexOf('{!hasData ?'));
 assert.match(page,/<EquityCurve \/>/);
});
test('duplicates, false precision, invalid values and mixed series reject',()=>{
 for(const change of [d=>d.points.push({...d.points[0]}),d=>d.points[0].valuation_at='2026-10-09T20:00:00Z',d=>d.points[0].equity=NaN,d=>d.points[0].provider_epoch=Number.MAX_SAFE_INTEGER,d=>d.points[0].resolution='hourly',d=>d.separate_from_hourly=false,d=>d.points[0]=null,d=>d.points[0].date_index='2026-10-10',d=>d.retrieved_at='2099-01-01T00:00:00Z',d=>d.retrieved_at='2026-10-01T00:00:00Z']){
  const data=fixture();change(data);assert.equal(exports.validRecovery(data),false);
 }
});
test('wrong field types and nonchronological valid points reject',()=>{
 const typed=fixture();typed.retrieved_at=[typed.retrieved_at];assert.equal(exports.validRecovery(typed),false);
 const data=fixture();data.points.push({...data.points[0],provider_epoch:1791504000,provider_label_utc:'2026-10-09T00:00:00Z',date_index:'2026-10-08'});
 assert.equal(exports.validRecovery(data),false);
});
test('old backend absence and disabled source remain unavailable, not zeros',async()=>{
 for(const status of [404,501])assert.equal((await exports.requestRecovery(async()=>({status,ok:false}))).state,'unavailable');
 assert.equal((await exports.requestRecovery(async()=>({status:200,ok:true,json:async()=>({schema_version:1,available:false})}))).state,'unavailable');
});
test('auth/error responses do not reveal raw backend messages and valid response binds endpoint',async()=>{
 for(const status of [401,403,500])assert.equal((await exports.requestRecovery(async()=>({status,ok:false}))).state,'error');
 let seen;const result=await exports.requestRecovery(async(url,options)=>{seen={url,options};return{status:200,ok:true,json:async()=>fixture()};});
 assert.equal(result.state,'available');assert.equal(seen.url,'/api/portfolio/recovered-daily');
 assert.equal(seen.options.cache,'no-store');assert.equal(seen.options.credentials,'same-origin');
 assert.equal((await exports.requestRecovery(async()=>({status:200,ok:true,json:async()=>({})}))).state,'error');
});
