import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require = createRequire(import.meta.url);
function load(path, deps={}) {
 const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('require','exports',code)(name=>deps[name]??require(name),exports);return exports;
}
const saved=load('../src/lib/savedScores.ts');
const history=load('../src/lib/scoreHistory.ts');
const component=load('../src/components/SavedScoreHistory.tsx',{'../lib/scoreHistory':history,'../lib/savedScores':saved}).default;
const point=(run_id,date,score,score_status='saved')=>({run_id,date,score,score_status,signals:{}});
test('chronological run identity preserves intraday runs, zero, negatives and missing data',()=>{
 const rows=history.prepareScoreHistory([point('c','2026-11-10T15:00:00',-.2),point('a','2026-11-10T10:00:00',0),point('b','2026-11-10T12:00:00',null,'legacy_unavailable')]);
 assert.deepEqual(rows.map(r=>r.run_id),['a','b','c']);assert.deepEqual(rows.map(r=>r.plottedScore),[0,null,-20]);
});
test('untrusted status and nonfinite values never plot',()=>{
 for(const row of [point('a','bad',NaN),point('b','2026-11-10',Infinity),point('c','2026-11-10',.5,'invalid_snapshot'),{...point('d','2026-11-10',.4),score_status:undefined}])assert.equal(history.prepareScoreHistory([row])[0].plottedScore,null);
});
test('empty and missing states are visible without fabricated values',()=>{
 const html=renderToStaticMarkup(React.createElement(component,{points:[point('old-run','2026-11-10T10:00:00',null,'legacy_unavailable')]}));
 assert.match(html,/No plottable saved scores/);assert.match(html,/older run/);assert.match(html,/old-run/);assert.match(html,/2026-11-10T10:00:00/);assert.match(html,/1 unavailable runs/);
 const empty=renderToStaticMarkup(React.createElement(component,{points:[]}));assert.match(empty,/No plottable/);
});
test('chart retains gaps, static points and explicit timestamp warning',()=>{
 const source=readFileSync(new URL('../src/components/SavedScoreHistory.tsx',import.meta.url),'utf8');assert.match(source,/connectNulls=\{false\}/);assert.match(source,/type="linear"/);assert.match(source,/dot=\{\{ r: 3 \}\}/);
 const html=renderToStaticMarkup(React.createElement(component,{points:[point('bad-time','invalid timestamp',.2)]}));assert.match(html,/timestamps could not be read/);assert.match(html,/bad-time/);assert.match(html,/20.00/);
});

test('Research search, watchlist and idea selections update the URL, retaining unrelated parameters',()=>{
 const source=readFileSync(new URL('../src/pages/Research.tsx',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const watchlist=()=>null;
 function render(query,ideas=[]) {
  let slot=0, next;
  const values=[query,null,null,ideas,undefined,false,null];
  const fakeReact={...React,useState:()=>[values[slot++],()=>{}],useEffect:()=>{},useCallback:fn=>fn,useRef:()=>({current:0})};
  const deps={'react':fakeReact,'react-router-dom':{useSearchParams:()=>[new URLSearchParams('ticker=AAPL&view=detail'),p=>{next=p;}]},'../components/SavedScoreHistory':{default:()=>null},'../lib/savedScores':saved,'../components/WatchlistCard':{default:watchlist}};
  const exports={};new Function('require','exports',code)(name=>deps[name]??require(name),exports);
  const tree=exports.default();
  function all(node){if(!node||typeof node!=='object')return [];return [node,...React.Children.toArray(node.props?.children).flatMap(all)];}
  return {nodes:all(tree),url:()=>next};
 }
 const search=render(' msft ');search.nodes.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(search.url().get('ticker'),'MSFT');assert.equal(search.url().get('view'),'detail');
 const watch=render('');watch.nodes.find(n=>n.type===watchlist).props.onSelect(' nvda ');assert.equal(watch.url().get('ticker'),'NVDA');
 const ideas=render('',[{ticker:'MSFT',rank:1,final_score:.3,score_status:'saved',confidence:.5,signal_scores:{},top_drivers:[]}]);
 const row=ideas.nodes.find(n=>typeof n.props?.onClick==='function'&&n.type==='button'&&String(n.props.className).includes('text-left'));assert.ok(row);row.props.onClick();assert.equal(ideas.url().get('ticker'),'MSFT');
});
