import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveAdapter,EXPECTED_STORE} from './vision-adapter.mjs';
const health={app:'sigil-swarm',storage:{store_id:EXPECTED_STORE}};
const state={runtime:{storage:{store_id:EXPECTED_STORE},status:'idle',blockers:[]},active_mission_id:null,missions:[{id:'m',title:'<script>untrusted</script>',status:'needs_review',review_resolution:{disposition:'rejected'},mode:'local',updated_at:'2026-10-29T00:00:00Z'}]};
test('only same-origin GETs and recorded review preserved',async()=>{
 const routes=[];const read=createLiveAdapter(async(url,options)=>{routes.push(url);assert.equal(options.method,undefined);return{ok:true,json:async()=>url.endsWith('health')?health:state}});
 const r=await read();assert.deepEqual(routes,['/api/health','/api/state']);assert.equal(r.available,true);assert.equal(r.tasks[0].status,'needs_review (review: rejected)');assert.equal(r.tasks[0].objective,'<script>untrusted</script>');
});
test('failed refresh retains explicitly stale last verified data',async()=>{
 let fail=false;const read=createLiveAdapter(async url=>{if(fail)throw Error('offline');return{ok:true,json:async()=>url.endsWith('health')?health:state}});
 const a=await read();fail=true;const b=await read();assert.equal(b.available,false);assert.equal(b.stale,true);assert.equal(b.fetched_at,a.fetched_at);assert.equal(b.tasks.length,1);
});
test('identity mismatch clears previously cached records',async()=>{
 let mismatch=false;const read=createLiveAdapter(async url=>({ok:true,json:async()=>url.endsWith('health')?(mismatch?{...health,storage:{store_id:'wrong'}}:health):state}));
 await read();mismatch=true;const b=await read();assert.deepEqual(b.tasks,[]);assert.equal(b.stale,false);assert.match(b.message,/Identity mismatch/);
});
test('malformed state hides records',async()=>{
 const r=await createLiveAdapter(async url=>({ok:true,json:async()=>url.endsWith('health')?health:{runtime:state.runtime,missions:null}}))();assert.equal(r.available,false);assert.deepEqual(r.tasks,[]);
});
