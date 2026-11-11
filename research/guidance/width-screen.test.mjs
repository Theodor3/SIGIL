import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareGuidance } from './compare.mjs';
import { hash } from './collect.mjs';
import { screenWidthCandidates, auditWidths } from './width-screen.mjs';
const base={issuer:'FIXTURE',fiscalStart:'2025-01-01',fiscalEnd:'2025-12-31',metric:'annual_sales',currency:'USD',basis:'reported',unit:'growth_percent',scope:'consolidated',low:3,high:5};
const row=(quarter,range)=>({ticker:'FIXTURE',quarter,targetPeriod:'FY2025',metric:'annual_sales',unit:'growth_percent',status:'numeric_annual_guidance_found',range,eligibleForReturns:false,timingVerified:false,latestPriorVerified:false});

test('width movement is independent of raised/cut range direction',()=>{
  const narrowed=compareGuidance(base,{...base,low:4.5,high:5.5});
  assert.equal(narrowed.classification,'raised');assert.equal(narrowed.widthClassification,'narrowed');
  assert.equal(narrowed.widthChange,-1);assert.equal(narrowed.widthChangeUnit,'percentage_points');
  const widened=compareGuidance(base,{...base,low:1,high:4});
  assert.equal(widened.classification,'cut');assert.equal(widened.widthClassification,'widened');
  assert.equal(widened.eligibleForReturns,false);
  assert.equal(compareGuidance(base,{...base,low:4,high:6}).widthClassification,'unchanged');
});
test('derived overflow cannot produce infinite width evidence',()=>{
  assert.equal(compareGuidance({...base,low:-1e308,high:1e308},{...base,low:-1e308,high:1e308}).classification,'noncomparable');
});
test('candidate groups never cross issuer, fiscal target, metric or unit',()=>{
  for(const changed of [{ticker:'OTHER'},{targetPeriod:'FY2026'},{metric:'EPS'},{unit:'USD_billion'}])
    assert.equal(screenWidthCandidates([row('2025Q1',[3,5]),{...row('2025Q2',[4,5]),...changed}]).length,0);
});
test('chronological adjacent supplied rows retain all width directions and never eligibility',()=>{
  const pairs=screenWidthCandidates([row('2025Q3',[2,5]),row('2025Q1',[3,5]),row('2025Q2',[4,5])]);
  assert.deepEqual(pairs.map(p=>p.widthClassification),['narrowed','widened']);
  assert.ok(pairs.every(p=>p.eligibleForReturns===false && p.blockers.includes('latest_prior_unverified')));
  assert.equal(pairs[0].priorQuarter,'2025Q1');
});
test('duplicate slots, claimed verification, malformed bounds and overflow fail closed',()=>{
  assert.throws(()=>screenWidthCandidates([row('2025Q1',[3,5]),row('2025Q1',[3,5])]),/Duplicate/);
  for(const change of [{eligibleForReturns:true},{timingVerified:true},{latestPriorVerified:true}])
    assert.throws(()=>screenWidthCandidates([{...row('2025Q1',[3,5]),...change}]),/verification/);
  for(const range of [[3,5,6],[6,3],[NaN,4],['3',4]])
    assert.throws(()=>screenWidthCandidates([row('2025Q1',range)]),/Malformed/);
  assert.throws(()=>screenWidthCandidates([row('2025Q1',[-1e308,1e308]),row('2025Q2',[-1e308,1e308])]),/overflow/);
});
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'sigil-width-'));await mkdir(join(root,'raw'));
  const config='{"synthetic":true}';await writeFile(join(root,'experiment.json'),config);
  const entries=[],receipts=[],slots=[];
  for(const [i,q] of ['2025Q1','2025Q2'].entries()){
    const text=`Annual sales fixture record ${i}`;const sha=hash(text);const url=`https://www.sec.gov/Archives/fixture${i}.htm`;
    const receipt={url,status:200,error:null,sha256:sha,rawFile:`raw/${sha}.bin`};
    await writeFile(join(root,receipt.rawFile),text);receipts.push(receipt);
    slots.push({ticker:'FIXTURE',quarter:q,documents:[{url,receipt}]});
    entries.push({...row(q,i?[4,5]:[3,5]),sourceUrl:url,rawSha256:sha,normalizedTextSha256:sha,
      passageStart:0,passageEnd:text.length,supportingPassage:text});
  }
  const audit=JSON.stringify({configSha256:hash(config),receipts,slots});await writeFile(join(root,'audit.json'),audit);
  const content={sourceAuditSha256:hash(audit),entries};const contentFile=join(root,'content.json');
  await writeFile(contentFile,JSON.stringify(content));return {root,contentFile,content,receipts};
}
test('offline audit binds retained bytes, normalized excerpts and source slot',async()=>{
  const f=await fixture();try{const r=await auditWidths(f.root,f.contentFile);
    assert.equal(r.retainedReceiptsVerified,2);assert.equal(r.summary.narrowed,1);assert.equal(r.summary.eligibleForReturns,0);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('tampered raw bytes block the entire audit',async()=>{
  const f=await fixture();try{await writeFile(join(f.root,f.receipts[0].rawFile),'tampered');
    await assert.rejects(()=>auditWidths(f.root,f.contentFile),/hash mismatch/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('wrong source binding or excerpt and altered audit fingerprint block',async()=>{
  for(const kind of ['source','excerpt','audit']){const f=await fixture();try{
    if(kind==='source')f.content.entries[0].sourceUrl='https://www.sec.gov/Archives/different.htm';
    if(kind==='excerpt')f.content.entries[0].supportingPassage='invented';
    if(kind==='audit')f.content.sourceAuditSha256='0'.repeat(64);
    await writeFile(f.contentFile,JSON.stringify(f.content));
    await assert.rejects(()=>auditWidths(f.root,f.contentFile),/mismatch/);
  }finally{await rm(f.root,{recursive:true,force:true});}}
});
test('receipt paths cannot escape the retained run',async()=>{
  const f=await fixture();try{const audit=JSON.parse(await readFile(join(f.root,'audit.json'),'utf8'));
    audit.receipts[0].rawFile='../outside.bin';const bytes=JSON.stringify(audit);await writeFile(join(f.root,'audit.json'),bytes);
    f.content.sourceAuditSha256=hash(bytes);await writeFile(f.contentFile,JSON.stringify(f.content));
    await assert.rejects(()=>auditWidths(f.root,f.contentFile),/receipt path/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('equal decimal widths remain unchanged after a midpoint shift in both paths',()=>{
  const a={...base,low:23.3,high:23.4},b={...base,low:23.5,high:23.6};
  const result=compareGuidance(a,b);
  assert.equal(result.priorWidth,.1);assert.equal(result.currentWidth,.1);
  assert.equal(result.widthChange,0);assert.equal(result.widthClassification,'unchanged');
  const pair=screenWidthCandidates([row('2025Q1',[23.3,23.4]),row('2025Q2',[23.5,23.6])])[0];
  assert.equal(pair.widthChange,0);assert.equal(pair.widthClassification,'unchanged');
  assert.equal(pair.midpointChange,.2);
});
test('decimal arithmetic supports scientific notation, negatives, and small genuine changes',()=>{
  const scientific=compareGuidance({...base,low:1e-7,high:2e-7},{...base,low:2e-7,high:3e-7});
  assert.equal(scientific.widthClassification,'unchanged');assert.equal(scientific.widthChange,0);
  const negative=compareGuidance({...base,low:-.3,high:-.1},{...base,low:-.2,high:0});
  assert.equal(negative.widthClassification,'unchanged');assert.equal(negative.widthChange,0);
  const narrow=compareGuidance({...base,low:0,high:1e-10},{...base,low:0,high:9e-11});
  assert.equal(narrow.widthClassification,'narrowed');assert.equal(narrow.widthChange,-1e-11);
});
