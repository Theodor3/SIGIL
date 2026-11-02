import test from 'node:test';
import assert from 'node:assert/strict';
import {usageSummary,projectClaudeStatusline} from '../static/usage-summary.mjs';
import {formatMoney} from '../static/usage-view-model.mjs';
const now='2026-11-02T00:05:00Z';
test('positive swarm estimates do not establish actual invoices or credits',()=>{
 const result=usageSummary({budget:{by_provider:{openai:{today_usd:2,pilot_usd:8}},uncertain:true}},null,now);
 assert.equal(result.api.providers.openai.lifetime_estimated_usd,8);
 assert.equal(result.api.actual_billed_usd,null);assert.equal(result.api.actual_billing_status,'not_connected');assert.equal(result.api.uncertain,true);
 assert.equal(result.api.providers.gemini.lifetime_estimated_usd,null);assert.equal(formatMoney(null),'Unknown');assert.notEqual(formatMoney(0),'Unknown');
});
test('context percentages and dollar estimates cannot become subscription quota',()=>{
 const observation=projectClaudeStatusline({context_window:{used_percentage:1},cost:{total_cost_usd:0}},now);
 const result=usageSummary({},observation,now);
 assert.equal(result.claude.five_hour,null);assert.equal(result.claude.seven_day,null);assert.equal(result.claude.actual_billed_usd,null);
});
test('only recent unexpired supported subscription windows produce quota',()=>{
 const observation=projectClaudeStatusline({rate_limits:{five_hour:{used_percentage:25,resets_at:Date.parse('2026-11-02T01:00:00Z')/1000}}},now);
 assert.equal(usageSummary({},observation,now).claude.five_hour.remaining_percentage,75);
 const stale=usageSummary({},observation,'2026-11-02T00:10:01Z');assert.equal(stale.claude.five_hour,null);assert.equal(stale.claude.observation_status,'stale_or_invalid');
 assert.equal(usageSummary({},observation,'2026-11-02T01:00:00Z').claude.five_hour,null);
});
