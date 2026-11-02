import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('../static/',import.meta.url);
async function app(responses){
 const nodes=new Map();let requests=[];
 const element=()=>({textContent:'',hidden:false,disabled:false,children:[],handlers:{},append(x){this.children.push(x);},replaceChildren(...x){this.children=x;},addEventListener(name,handler){this.handlers[name]=handler;}});
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element};
 const context=vm.createContext({document,Date,Intl,TextEncoder,AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async(url,options)=>{
  requests.push({url,options});const value=responses[url];if(value instanceof Error)throw value;if(typeof value==='function')return value(options);return {ok:true,json:async()=>value};
 }});
 const cache=new Map();
 async function load(name){if(cache.has(name))return cache.get(name);const module=new vm.SourceTextModule(await readFile(new URL(name,root),'utf8'),{context});cache.set(name,module);await module.link(spec=>load(spec.replace('./','')));return module;}
 const module=await load('usage.js');await module.evaluate();await new Promise(setImmediate);
 return {nodes,requests,responses,async refresh(){await nodes.get('refresh').handlers.click();}};
}
const budget={allowance:{limit_usd:20,used_usd:1,remaining_usd:19,reserved_usd:0,expires_at:null},by_provider:{openai:{today_usd:0,pilot_usd:1}},uncertain:false};
const readiness={scheduler_enabled:false,queue:{enabled:false,running:false,expires_at:null}};
test('manual refresh reads only state/readiness and does not start work',async()=>{
 const run=await app({'/api/state':{budget},'/api/readiness':readiness});
 assert.equal(run.nodes.get('scheduler-status').textContent,'Off');assert.equal(run.nodes.get('queue-status').textContent,'Off');assert.equal(run.nodes.get('refresh').disabled,false);
 assert.deepEqual(run.requests.map(x=>x.url).sort(),['/api/readiness','/api/state']);
 for(const req of run.requests){assert.equal(req.options.method,undefined);assert.equal(req.options.cache,'no-store');}
});
test('activity failure keeps money available and does not report unknown queue as off',async()=>{
 const run=await app({'/api/state':{budget},'/api/readiness':new Error('unavailable')});
 assert.equal(run.nodes.get('error').hidden,true);assert.equal(run.nodes.get('queue-status').textContent,'Unknown');assert.match(run.nodes.get('activity-warning').textContent,/unknown/);
 assert.match(run.nodes.get('freshness').textContent,/Recent/);
});
test('later failure retains dated off observation with stale warning',async()=>{
 const run=await app({'/api/state':{budget},'/api/readiness':readiness});
 run.responses['/api/readiness']=new Error('unavailable');await run.refresh();
 assert.match(run.nodes.get('activity-freshness').textContent,/STALE/);assert.match(run.nodes.get('activity-warning').textContent,/unknown/);
 assert.equal(run.nodes.get('queue-status').textContent,'Off');assert.equal(run.nodes.get('error').hidden,true);
});
test('budget failure does not hide a successful activity observation',async()=>{
 const run=await app({'/api/state':new Error('unavailable'),'/api/readiness':readiness});
 assert.equal(run.nodes.get('error').hidden,false);assert.match(run.nodes.get('freshness').textContent,/unavailable/);
 assert.match(run.nodes.get('activity-freshness').textContent,/Recent/);assert.equal(run.nodes.get('queue-status').textContent,'Off');assert.equal(run.nodes.get('activity-warning').hidden,true);
});
test('non-200 readiness response is unknown despite a valid-looking body',async()=>{
 const run=await app({'/api/state':{budget},'/api/readiness':()=>({ok:false,json:async()=>readiness})});
 assert.equal(run.nodes.get('queue-status').textContent,'Unknown');assert.match(run.nodes.get('activity-warning').textContent,/unknown/);assert.equal(run.nodes.get('error').hidden,true);
});
test('successful manual refresh recovers both error states',async()=>{
 const run=await app({'/api/state':new Error('unavailable'),'/api/readiness':new Error('unavailable')});
 run.responses['/api/state']={budget};run.responses['/api/readiness']=readiness;await run.refresh();
 assert.equal(run.nodes.get('error').hidden,true);assert.equal(run.nodes.get('activity-warning').hidden,true);assert.match(run.nodes.get('freshness').textContent,/Recent/);assert.match(run.nodes.get('activity-freshness').textContent,/Recent/);
});
