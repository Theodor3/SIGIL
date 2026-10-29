import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseClaudeStatusline,projectClaudeStatusline,usageSummary} from './usage-summary.mjs';
const now='2026-10-29T20:00:00Z';
const reset=Date.parse('2026-10-29T21:00:00Z')/1000;
const fixture=()=>({rate_limits:{five_hour:{used_percentage:25,resets_at:reset},seven_day:{used_percentage:0,resets_at:reset+86400}},session_id:'PRIVATE',transcript_path:'PRIVATE',cost:{total_cost_usd:77},context_window:{used_percentage:99},api_key:'PRIVATE'});
test('projects only documented quota fields, preserving a real zero',()=>{
 const out=projectClaudeStatusline(fixture(),now);
 assert.equal(out.five_hour.remaining_percentage,75);assert.equal(out.seven_day.used_percentage,0);
 const text=JSON.stringify(out);for(const field of ['PRIVATE','session_id','transcript','cost','context_window','api_key'])assert.ok(!text.includes(field));
});
test('missing rate limits are unknown, never zero usage',()=>{
 const out=projectClaudeStatusline({context_window:{used_percentage:30}},now);
 assert.equal(out.five_hour,null);assert.equal(out.seven_day,null);
});
test('rejects invalid percentage/reset types without coercion',()=>{
 for(const used of [-1,101,true,'20',null,Infinity])assert.equal(projectClaudeStatusline({rate_limits:{five_hour:{used_percentage:used,resets_at:reset}}},now).five_hour,null);
 for(const r of [null,'123',0,1.5,Infinity])assert.equal(projectClaudeStatusline({rate_limits:{five_hour:{used_percentage:10,resets_at:r}}},now).five_hour,null);
});
test('stale, future or reset-expired observations cannot imply available quota',()=>{
 const observed=projectClaudeStatusline(fixture(),now);
 assert.equal(usageSummary({},observed,'2026-10-29T20:05:01Z').claude.five_hour,null);
 assert.equal(usageSummary({},observed,'2026-10-29T19:59:59Z').claude.five_hour,null);
 const expired=projectClaudeStatusline({rate_limits:{five_hour:{used_percentage:5,resets_at:reset-3600}}},now);
 assert.equal(usageSummary({},expired,now).claude.five_hour,null);
});
test('recent reported quota remains separate from unknown actual billing',()=>{
 const state={budget:{by_provider:{openai:{today_usd:.5,pilot_usd:2.5},gemini:{today_usd:0,pilot_usd:1}},uncertain:true}};
 const out=usageSummary(state,projectClaudeStatusline(fixture(),now),now);
 assert.equal(out.api.providers.openai.lifetime_estimated_usd,2.5);assert.equal(out.api.actual_billed_usd,null);assert.equal(out.api.scope,'this_swarm_only');assert.equal(out.api.uncertain,true);
 assert.equal(out.claude.five_hour.used_percentage,25);assert.equal(out.claude.actual_billed_usd,null);
});
test('malformed and oversized input fails with fixed non-sensitive error',()=>{
 for(const input of ['PRIVATE','null','[]','x'.repeat(262145)])assert.throws(()=>parseClaudeStatusline(input,now),/^Error: Invalid statusline payload$/);
 assert.equal(usageSummary({},null,now).api.providers.openai.today_estimated_usd,null);
});
test('standalone stdin adapter emits sanitized JSON and never echoes bad input',()=>{
 const cli=fileURLToPath(new URL('./project-claude-statusline.mjs',import.meta.url));
 const good=spawnSync(process.execPath,[cli],{input:JSON.stringify(fixture()),encoding:'utf8'});
 assert.equal(good.status,0);assert.equal(JSON.parse(good.stdout).five_hour.used_percentage,25);assert.ok(!good.stdout.includes('PRIVATE'));
 const bad=spawnSync(process.execPath,[cli],{input:'PRIVATE malformed',encoding:'utf8'});
 assert.equal(bad.status,1);assert.equal(bad.stdout,'');assert.ok(!bad.stderr.includes('PRIVATE'));
});
