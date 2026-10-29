import {usageView,formatMoney} from './usage-view-model.mjs';
const el=id=>document.getElementById(id);
let snapshot=null,receivedAt=null,failed=false;
function text(id,value){el(id).textContent=value;}
function render(){
 const view=usageView(snapshot,receivedAt,{failed});
 text('freshness',view.freshness==='unavailable'?'Ledger unavailable — amounts are unknown.':`${view.freshness==='stale'?'STALE':'Recent'} ledger snapshot · received ${view.received_at}. Manual refresh only.`);
 const rows=['openai','gemini'].map(provider=>{
  const row=document.createElement('tr');const values=[provider==='openai'?'OpenAI (coordinator + search)':'Gemini',formatMoney(view.summary.api.providers[provider].today_estimated_usd),formatMoney(view.summary.api.providers[provider].lifetime_estimated_usd)];
  for(const value of values){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}return row;
 });el('providers').replaceChildren(...rows);
 text('timezone',`Today follows the ledger timezone: ${view.timezone}. All amounts are estimates.`);
 el('uncertain').hidden=!view.uncertain;
 const pairs=[['Allowance limit',view.allowance.limit],['Used in this allowance',view.allowance.used],['Reserved for calls',view.allowance.reserved],['Remaining allowance',view.allowance.remaining],['Historical estimate before this allowance',view.allowance.historical],['Lifetime estimate, all providers',view.allowance.lifetime]];
 const cells=[];for(const [label,value] of pairs){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=formatMoney(value);cells.push(dt,dd);}el('allowance').replaceChildren(...cells);text('expiry',view.allowance.expiry);
 text('claude-installed',view.installed);text('five-hour','Unknown — no verified observation');text('seven-day','Unknown — no verified observation');
 el('error').hidden=!failed;
}
async function refresh(){
 el('refresh').disabled=true;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
 try{const response=await fetch('/api/state',{signal:controller.signal,cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();if(!data?.budget||typeof data.budget!=='object'||Array.isArray(data.budget))throw new Error();
  // Keep only display fields, never missions/prompts/paths or provider credentials.
  snapshot={budget:{by_provider:data.budget.by_provider,allowance:data.budget.allowance,historical_spend_usd:data.budget.historical_spend_usd,pilot_usd:data.budget.pilot_usd,timezone:data.budget.timezone,uncertain:data.budget.uncertain},runtime:{subscription:{installed:data.runtime?.subscription?.installed}}};receivedAt=new Date().toISOString();failed=false;
 }catch{failed=true;}finally{clearTimeout(timer);render();el('refresh').disabled=false;}
}
el('refresh').addEventListener('click',refresh);render();refresh();
// Time-only freshness display: no network requests or background work.
setInterval(render,30000);
