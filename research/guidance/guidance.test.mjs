import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidates, indexDetails, textOf, windows, collect } from './collect.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareGuidance } from './compare.mjs';
const base = {issuer:'EXAMPLE',fiscalStart:'2025-01-01',fiscalEnd:'2025-12-31',metric:'annual_revenue',currency:'USD',basis:'reported',unit:'billion',scope:'consolidated',low:10,high:12};
test('rollover and currency-basis changes cannot become revisions', () => {
  for (const changes of [{fiscalEnd:'2026-12-31'}, {currency:'EUR'}, {basis:'constant_currency'}, {scope:'segment'}, {unit:'growth_percent'}, {metric:'EPS'}]) {
    assert.equal(compareGuidance(base,{...base,...changes,low:20,high:22}).classification,'noncomparable');
  }
});
test('missing dimensions and malformed ranges fail closed', () => {
  for(const changes of [{fiscalStart:''},{low:NaN},{low:null},{low:15},{high:'12'}]) assert.equal(compareGuidance(base,{...base,...changes}).classification,'noncomparable');
});
test('low-only raises and mixed ranges remain distinct', () => {
  assert.equal(compareGuidance(base,{...base,low:11}).classification,'raised');
  assert.equal(compareGuidance(base,{...base,low:9,high:15}).classification,'mixed');
  assert.equal(compareGuidance(base,base).classification,'unchanged');
  assert.equal(compareGuidance(base,{...base,high:11}).classification,'cut');
});
test('percentage-point growth revisions are not relative dollar growth', () => {
  const a={...base,basis:'constant_currency',unit:'growth_percent',low:3,high:4};
  const result=compareGuidance(a,{...a,low:3.75,high:4.75});
  assert.equal(result.midpointChange,.75); assert.equal(result.midpointChangeUnit,'percentage_points'); assert.equal(result.relativeMidpointChange,null);
});
test('zero and negative midpoint never produce percentage changes', () => {
  for (const low of [-12,-6]) assert.equal(compareGuidance({...base,low,high:6},{...base,low:10,high:12}).relativeMidpointChange,null);
});
test('numeric agreement cannot certify historical tradability', () => {
  const result=compareGuidance(base,{...base,low:11,high:13});
  assert.equal(result.eligibleForReturns,false);
});
test('impossible calendar dates fail even when both records match', () => {
  for (const date of ['2025-02-31','2025-13-31']) {
    const bad={...base,fiscalStart:date};assert.equal(compareGuidance(bad,{...bad,low:11}).classification,'noncomparable');
  }
});
test('malformed source metadata stays incomplete and cannot overwrite an earlier run', async () => {
  const parent=await mkdtemp(join(tmpdir(),'sigil-guidance-'));
  try {
    const dir=join(parent,'run');
    const result=await collect(dir,{spacingMs:0,fetchImpl:async()=>new Response('{malformed',{status:200})});
    assert.equal(result.slots.length,30);assert.ok(result.slots.every(s=>s.status==='incomplete_filing_coverage' && !s.eligibleForReturns));
    await assert.rejects(()=>collect(dir),{code:'EEXIST'});
  } finally {await rm(parent,{recursive:true,force:true});}
});
test('an unavailable exhibit is a retrieval failure, not a missing guidance observation', async () => {
  const parent=await mkdtemp(join(tmpdir(),'sigil-guidance-'));
  try {
    const result=await collect(join(parent,'run'),{spacingMs:0,fetchImpl:async url=>{
      if(url.includes('submissions/')) return Response.json({filings:{recent:{form:['8-K'],filingDate:['2025-06-12'],items:['2.02'],accessionNumber:['0000000001-25-000001']},files:[]}});
      if(url.endsWith('-index.html')) return new Response('<tr><td>EX-99.1</td><td><a href="/Archives/failed.htm">x</a></td></tr>');
      return new Response('blocked',{status:403});
    }});
    assert.equal(result.slots.filter(s=>s.status==='exhibit_retrieval_failed').length,6);
  } finally {await rm(parent,{recursive:true,force:true});}
});
test('filing selection preserves all exact-item candidates in deterministic chronological order', () => {
  const rows={form:['8-K','8-K/A','8-K','8-K'], filingDate:['2025-06-03','2025-05-01','2025-04-01','2025-04-01'],items:['2.02,9.01','2.02','12.02','2.02'],accessionNumber:['0000000001-25-000004','0000000001-25-000003','0000000001-25-000002','0000000001-25-000001']};
  assert.deepEqual(candidates(rows,'2025Q2').map(r=>r.accession),['0000000001-25-000001','0000000001-25-000004']);
  assert.equal(candidates(rows,'2025Q1').length,0);
});
test('missing accession and timing do not produce fabricated metadata', () => {
  assert.deepEqual(candidates({form:['8-K'],items:['2.02'],filingDate:['2025-01-01']},'2025Q1'),[]);
  assert.equal(indexDetails('<html></html>').secAcceptedLocal,null);
});
test('archive exhibits are restricted to SEC and accepted time retains timezone separately', () => {
  const html='<div>Accepted</div><div class="info">2025-06-12 16:19:20</div><tr><td>EX-99.1</td><td><a href="/Archives/test.htm">release</a></td></tr><tr><td>EX-99.2</td><a href="https://evil.invalid/x">x</a></tr>';
  const result=indexDetails(html);assert.deepEqual(result.exhibitUrls,['https://www.sec.gov/Archives/test.htm']);assert.equal(result.secAcceptedLocal,'2025-06-12 16:19:20');assert.equal(result.secAcceptedTimezone,'America/New_York');
});
test('discovery text is plain text and windows are bounded', () => {
  assert.equal(textOf('<script>guidance fake</script><p>Revenue&nbsp;$12 &amp; growth</p>'),'Revenue $12 & growth');
  const rows=windows('guidance '.repeat(100));assert.equal(rows.length,12);assert.ok(rows.every(r=>r.text.length<=810));
});
