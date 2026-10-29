import {test} from 'node:test';
import assert from 'node:assert/strict';
import {usageView,formatMoney} from '../static/usage-view-model.mjs';
const stamp='2026-10-29T20:30:00Z';
const fixture=()=>({budget:{timezone:'America/New_York',by_provider:{openai:{today_usd:.475852,pilot_usd:2.530462},gemini:{today_usd:.718966,pilot_usd:2.703185}},allowance:{limit_usd:20,used_usd:1.194818,remaining_usd:18.805182,reserved_usd:0,expires_at:null},historical_spend_usd:4.038829,pilot_usd:5.233647,uncertain:false},runtime:{subscription:{installed:true}},missions:[{prompt:'PRIVATE'}],api_key:'PRIVATE'});
test('view distinguishes new allowance, history, provider estimates and unknown billing',()=>{
 const out=usageView(fixture(),stamp,{now:stamp});
 assert.equal(out.allowance.limit,20);assert.equal(out.allowance.used,1.194818);assert.equal(out.allowance.historical,4.038829);
 assert.equal(out.summary.api.providers.openai.lifetime_estimated_usd,2.530462);assert.equal(out.summary.api.actual_billed_usd,null);
 assert.equal(out.summary.claude.five_hour,null);assert.equal(out.freshness,'recent');assert.ok(!JSON.stringify(out).includes('PRIVATE'));
});
test('first failure or invalid snapshot never invents zero balances',()=>{
 for(const state of [null,{}, {budget:[]}]){
  const out=usageView(state,null,{now:stamp,failed:true});assert.equal(out.freshness,'unavailable');assert.equal(out.allowance.remaining,null);assert.equal(out.summary.api.providers.openai.today_estimated_usd,null);
 }
 assert.equal(formatMoney(null),'Unknown');assert.equal(formatMoney(undefined),'Unknown');assert.equal(formatMoney(0),'$0.00');assert.equal(formatMoney('0'),'Unknown');
});
test('failed refresh keeps dated estimates visibly stale',()=>{
 const out=usageView(fixture(),stamp,{now:'2026-10-29T20:30:01Z',failed:true});assert.equal(out.freshness,'stale');assert.equal(out.allowance.remaining,18.805182);assert.equal(out.received_at,'2026-10-29T20:30:00.000Z');
});
test('aged and future-dated snapshots never look recent',()=>{
 for(const now of ['2026-10-29T20:35:01Z','2026-10-29T20:29:59Z'])assert.equal(usageView(fixture(),stamp,{now}).freshness,'stale');
});
test('uncertain cost flag is displayed without settling or changing the allowance',()=>{
 const state=fixture();state.budget.uncertain=true;const original=structuredClone(state);const out=usageView(state,stamp,{now:stamp});assert.equal(out.uncertain,true);assert.deepEqual(state,original);
});
test('missing and invalid provider values remain unknown, real zero stays zero',()=>{
 const state=fixture();state.budget.by_provider.openai.today_usd='0';state.budget.by_provider.gemini.today_usd=0;delete state.budget.allowance;
 const out=usageView(state,stamp,{now:stamp});assert.equal(out.summary.api.providers.openai.today_estimated_usd,null);assert.equal(out.summary.api.providers.gemini.today_estimated_usd,0);assert.equal(out.allowance.has_allowance,false);assert.equal(out.allowance.limit,null);
});
