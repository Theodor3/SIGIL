import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/stockIdeas.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const {savedIdeas, programAssessments, toggleIdeaVote} = await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('only explicitly saved finite scores are ranked; zero and negatives survive',()=>{
 const rows=[{rank:2,ticker:'ZERO',final_score:0},{rank:1,ticker:'A',final_score:.8},{rank:3,ticker:'NEG',final_score:-.1},{rank:4,ticker:'MISSING',final_score:null},{rank:5,ticker:'INVALID',final_score:NaN}];
 assert.deepEqual(savedIdeas(rows,'saved').map(row=>row.ticker),['A','ZERO','NEG']);
 for(const status of [undefined,'no_run','legacy_unavailable','invalid_snapshot'])assert.deepEqual(savedIdeas(rows,status),[]);
 assert.equal(rows[0].ticker,'ZERO');
});
test('raw program assessments retain zero, exclude nonfinite data, never compute contributions',()=>{
 assert.deepEqual(programAssessments({signal_scores:{a:0,b:.5,c:NaN,d:-.2}}),[['b',.5],['a',0],['d',-.2]]);
});
test('votes toggle independently, without mutating any score or vote input',()=>{
 const previous=['cash'];const next=toggleIdeaVote(previous,'materials');assert.deepEqual(previous,['cash']);assert.deepEqual(next,['cash','materials']);assert.deepEqual(toggleIdeaVote(next,'materials'),previous);
});
test('home only reads overview and preview has no backend, socket or mutation entry point',()=>{
 const home=readFileSync(new URL('../src/pages/StockIdeas.tsx',import.meta.url),'utf8');const preview=readFileSync(new URL('../src/pages/StockIdeasPreview.tsx',import.meta.url),'utf8');
 assert.match(home,/useDashboard\('overview'\)/);assert.doesNotMatch(home+preview,/method:\s*['"]POST|useWebSocket|\/api\/pipeline|localStorage|sessionStorage/);assert.match(home,/Exact contribution parts were not retained/);
});
