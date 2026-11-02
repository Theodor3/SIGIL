import test from 'node:test';
import assert from 'node:assert/strict';
import {activityView} from '../static/activity-view.mjs';
const now='2026-11-01T23:55:00Z';
const off={scheduler_enabled:false,queue:{enabled:false,running:false,expires_at:null}};
test('an absent observation never implies off',()=>{
 const result=activityView(null,null,{now});assert.equal(result.freshness,'unavailable');assert.equal(result.scheduler,'Unknown');assert.equal(result.queue,'Unknown');assert.ok(result.warnings.length);
});
test('fresh explicit booleans report observed off without dispatch authority',()=>{
 const result=activityView(off,now,{now});assert.equal(result.freshness,'recent');assert.equal(result.scheduler,'Off');assert.equal(result.queue,'Off');assert.equal(result.running,'Not running');assert.deepEqual(result.warnings,[]);
});
test('refresh failure retains dated values with current-activity warning',()=>{
 const result=activityView(off,now,{now,failed:true});assert.equal(result.freshness,'stale');assert.equal(result.queue,'Off');assert.match(result.warnings[0],/unknown/);
});
test('staleness boundary and future/zoneless times cannot look recent',()=>{
 assert.equal(activityView(off,'2026-11-01T23:50:00Z',{now}).freshness,'recent');
 for(const time of ['2026-11-01T23:49:59Z','2026-11-02T00:00:00Z','2026-11-01T23:55:00'])assert.equal(activityView(off,time,{now}).freshness,'stale');
});
test('invalid flags remain unknown instead of coercing truthiness',()=>{
 const result=activityView({scheduler_enabled:'false',queue:{enabled:0,running:'yes'}},now,{now});assert.equal(result.scheduler,'Unknown');assert.equal(result.queue,'Unknown');assert.equal(result.running,'Unknown');
});
test('enabled queue with absent or elapsed deadline is flagged',()=>{
 for(const expires_at of [null,'2026-11-01T23:55:00Z']){
  const result=activityView({scheduler_enabled:false,queue:{enabled:true,running:true,expires_at}},now,{now});assert.equal(result.queue,'Enabled');assert.equal(result.running,'Running');assert.ok(result.warnings.length);
 }
 const valid=activityView({scheduler_enabled:false,queue:{enabled:true,running:true,expires_at:'2026-11-02T00:05:00Z'}},now,{now});assert.deepEqual(valid.warnings,[]);
});
