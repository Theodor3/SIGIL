import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sha,run,verifyCompanyGrowth} from './check-company-growth.mjs';
const base=new URL('../public/research/company-growth/',import.meta.url);
const fixture=()=>({m:JSON.parse(readFileSync(new URL('manifest.json',base),'utf8')),b:readFileSync(new URL('forecast.json',base)),h:readFileSync(new URL('index.html',base),'utf8')});
test('published forecast and exact five-file engine match the issued export',()=>{
 const f=fixture(),root=new URL('../../research/company_growth/',import.meta.url);
 assert.deepEqual(f.b,readFileSync(new URL('boeing-frozen-forecast.json',root)));
 const files=['panel.py','vendor_trial_ledger.py','PROTOCOL.md','prepare_boeing_receipts.py','reviewed-curation-plan.json'];
 assert.equal(sha(Buffer.concat(files.flatMap((name,i)=>i?[Buffer.from([0]),readFileSync(new URL(name,root))]:[readFileSync(new URL(name,root))]))),f.m.codeSha256);
 assert.equal(run().status,'pending_outcome');
});
test('changed forecast, display or receipt semantics fail the publication guard',()=>{
 const f=fixture();assert.throws(()=>verifyCompanyGrowth(f.m,Buffer.concat([f.b,Buffer.from(' ')]),f.h));
 for(const html of [f.h.replace('1 forecasts frozen','2 forecasts frozen'),f.h.replace('$23.093 billion','$99.999 billion'),f.h+'<script>fetch("/api/")</script>',f.h+'file:///C:/Users/private'])assert.throws(()=>verifyCompanyGrowth(f.m,f.b,html));
 const altered=JSON.parse(f.b);altered.receipts.inventory.published_at=altered.receipts.q1_filing.filing_accepted_at;
 const bytes=Buffer.from(JSON.stringify(altered));assert.throws(()=>verifyCompanyGrowth({...f.m,forecastSha256:sha(bytes)},bytes,f.h));
});
test('Experiments links the frozen view without adding an execution path',()=>{
 const page=readFileSync(new URL('../src/pages/Experiments.tsx',import.meta.url),'utf8');
 assert.ok(page.includes('href="/research/company-growth/index.html"'));
 assert.ok(page.includes('outcome pending')||page.includes('OUTCOME PENDING'));
});
