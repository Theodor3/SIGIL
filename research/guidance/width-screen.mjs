// Offline screen of existing coordinator-reviewed numeric labels. No retrieval,
// performance calculation, latest-prior inference, or eligibility promotion.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hash, textOf } from './collect.mjs';
import { rangeMetrics } from './compare.mjs';

export function screenWidthCandidates(entries) {
  const groups = new Map(), seen = new Set();
  for (const e of entries) {
    const id = `${e.ticker}:${e.quarter}`;
    if (seen.has(id)) throw new Error('Duplicate reviewed slot');
    seen.add(id);
    if (e.eligibleForReturns !== false || e.timingVerified !== false || e.latestPriorVerified !== false)
      throw new Error('Unsupported historical-verification flag');
    if (e.status !== 'numeric_annual_guidance_found') continue;
    if (!['ticker','targetPeriod','metric','unit'].every(k=>typeof e[k]==='string' && e[k].trim())
      || !/^\d{4}Q[1-4]$/.test(e.quarter) || !Array.isArray(e.range) || e.range.length!==2
      || !e.range.every(Number.isFinite) || e.range[0]>e.range[1]) throw new Error('Malformed annual observation');
    const key=JSON.stringify([e.ticker,e.targetPeriod,e.metric,e.unit]);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(e);
  }
  const pairs=[];
  for (const rows of groups.values()) {
    rows.sort((a,b)=>a.quarter.localeCompare(b.quarter));
    for(let i=1;i<rows.length;i++) {
      const a=rows[i-1],b=rows[i];
      const metrics=rangeMetrics(...a.range,...b.range);
      pairs.push({ticker:a.ticker,targetPeriod:a.targetPeriod,metric:a.metric,unit:a.unit,
        priorQuarter:a.quarter,currentQuarter:b.quarter,priorRange:a.range,currentRange:b.range,
        ...metrics,widthChangeUnit:['growth_percent','percent_constant_currency'].includes(a.unit)?'percentage_points':a.unit,
        priorSource:{url:a.sourceUrl,rawSha256:a.rawSha256,passageStart:a.passageStart,passageEnd:a.passageEnd},
        currentSource:{url:b.sourceUrl,rawSha256:b.rawSha256,passageStart:b.passageStart,passageEnd:b.passageEnd},
        scope:'adjacent reviewed rows in frozen sample, NOT verified latest-prior event pair',
        blockers:['first_public_times_unverified','latest_prior_unverified','basis_and_scope_require_pair_review',
          'numeric_labels_require_independent_semantic_review'],eligibleForReturns:false});
    }
  }
  return pairs.sort((a,b)=>a.ticker.localeCompare(b.ticker)||a.currentQuarter.localeCompare(b.currentQuarter));
}

export async function auditWidths(runDirectory, contentFile) {
  const run=resolve(runDirectory), auditBytes=await readFile(resolve(run,'audit.json'));
  const audit=JSON.parse(auditBytes), contentBytes=await readFile(contentFile),content=JSON.parse(contentBytes);
  if(hash(await readFile(resolve(run,'experiment.json')))!==audit.configSha256
    || content.sourceAuditSha256!==hash(auditBytes)) throw new Error('Audit/configuration binding mismatch');
  const raw=new Map();
  for(const receipt of audit.receipts) {
    if(!receipt.rawFile) continue;
    if(!/^[a-f0-9]{64}$/.test(receipt.sha256) || receipt.rawFile!==`raw/${receipt.sha256}.bin`)
      throw new Error('Invalid content-addressed receipt path');
    const bytes=await readFile(resolve(run,receipt.rawFile));
    if(hash(bytes)!==receipt.sha256) throw new Error('Retained receipt hash mismatch');
    raw.set(receipt.rawFile,bytes);
  }
  if(content.entries.length!==audit.slots.length) throw new Error('Reviewed slot count mismatch');
  for(const e of content.entries) {
    const slots=audit.slots.filter(s=>s.ticker===e.ticker && s.quarter===e.quarter);
    if(slots.length!==1) throw new Error('Review not bound to one source slot');
    const doc=slots[0].documents.find(d=>d.url===e.sourceUrl && d.receipt?.sha256===e.rawSha256);
    const receipt=doc?.receipt;
    if(!receipt || receipt.status!==200 || receipt.error || receipt.rawFile!==`raw/${e.rawSha256}.bin`
      || receipt.url!==e.sourceUrl || !raw.has(receipt.rawFile)
      || !audit.receipts.some(r=>r.url===receipt.url && r.sha256===receipt.sha256 && r.status===200 && !r.error))
      throw new Error('Review source receipt mismatch');
    const text=textOf(raw.get(receipt.rawFile).toString('utf8'));
    if(hash(text)!==e.normalizedTextSha256 || !Number.isInteger(e.passageStart) || !Number.isInteger(e.passageEnd)
      || e.passageStart<0 || e.passageEnd<=e.passageStart || e.passageEnd>text.length
      || text.slice(e.passageStart,e.passageEnd)!==e.supportingPassage) throw new Error('Review excerpt mismatch');
  }
  const pairs=screenWidthCandidates(content.entries);
  return {schemaVersion:1,stage:'offline_numeric_width_screen',sourceAuditSha256:hash(auditBytes),
    contentAuditSha256:hash(contentBytes),retainedReceiptsVerified:raw.size,reviewedSlots:content.entries.length,
    numericAnnualObservations:content.entries.filter(e=>e.status==='numeric_annual_guidance_found').length,
    pairs,summary:{candidatePairs:pairs.length,narrowed:pairs.filter(p=>p.widthClassification==='narrowed').length,
      widened:pairs.filter(p=>p.widthClassification==='widened').length,unchanged:pairs.filter(p=>p.widthClassification==='unchanged').length,
      eligibleForReturns:0},limitations:['Hashes prove retained-byte identity, not factual correctness or public availability.',
      'Frozen convenience sample, first-exhibit targeted review; no exhaustive intervening-update coverage.',
      'Supplied numeric labels and same-period grouping are candidates, not independently verified comparable events.',
      'No returns, price downloads, model requests, execution or portfolio changes.']};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [run,content,output]=process.argv.slice(2);
  if(!run||!content||!output) throw new Error('Usage: width-screen.mjs EXISTING_RUN CONTENT_AUDIT NEW_OUTPUT');
  const result=await auditWidths(run,content);
  await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result.summary));
}
