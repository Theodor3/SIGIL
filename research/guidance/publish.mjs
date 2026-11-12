import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { hash, textOf } from './collect.mjs';

// Offline publication: verify every saved receipt before producing a small UI snapshot.
const [runArg, manifestArg, outputArg, contentArg] = process.argv.slice(2);
if (!runArg || !manifestArg || !outputArg) throw new Error('Usage: publish.mjs RUN SOURCE_MANIFEST OUTPUT [CONTENT_AUDIT]');
const run = resolve(runArg);
const auditBytes = await readFile(resolve(run, 'audit.json'));
const audit = JSON.parse(auditBytes);
const configBytes = await readFile(resolve(run, 'experiment.json'));
if (hash(configBytes) !== audit.configSha256) throw new Error('Configuration fingerprint mismatch');
const config = JSON.parse(configBytes);
const manifest = JSON.parse(await readFile(resolve(manifestArg), 'utf8'));
const content = contentArg ? JSON.parse(await readFile(resolve(contentArg), 'utf8')) : null;
for (const receipt of audit.receipts) {
  if (!receipt.rawFile) continue; // Failed network attempts remain visible.
  const path = resolve(run, receipt.rawFile), rel = relative(run, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Receipt path escapes run');
  if (hash(await readFile(path)) !== receipt.sha256) throw new Error(`Receipt mismatch: ${receipt.url}`);
}
const expected = new Set(config.sample.issuers.flatMap(i => config.sample.quarters.map(q => `${i.ticker}:${q}`)));
if (audit.slots.length !== expected.size) throw new Error('Wrong number of slots');
const seen = new Set();
for (const slot of audit.slots) {
  const key = `${slot.ticker}:${slot.quarter}`;
  if (!expected.has(key) || seen.has(key)) throw new Error('Invalid or duplicate slot');
  seen.add(key);
}
const cleanReceipt = ({ rawFile, ...r }) => r;
if (content) {
  if (content.sourceAuditSha256 !== hash(auditBytes) || content.entries?.length !== 30) throw new Error('Content review has wrong source audit');
  const reviewed = new Set();
  for (const entry of content.entries) {
    const key = `${entry.ticker}:${entry.quarter}`;
    if (reviewed.has(key)) throw new Error('Duplicate content review');
    reviewed.add(key);
    const slot = audit.slots.find(s => s.ticker === entry.ticker && s.quarter === entry.quarter);
    const doc = slot?.documents.find(d => d.url === entry.sourceUrl && d.receipt?.sha256 === entry.rawSha256);
    if (!doc || entry.eligibleForReturns !== false || entry.latestPriorVerified !== false || entry.timingVerified !== false) throw new Error('Unsupported content claim');
    const text = textOf(await readFile(resolve(run, doc.receipt.rawFile), 'utf8'));
    if (hash(text) !== entry.normalizedTextSha256 || text.slice(entry.passageStart,entry.passageEnd) !== entry.supportingPassage) throw new Error('Content excerpt mismatch');
  }
}
const slots = audit.slots.map(slot => {
  const source = manifest.events.find(e => e.ticker === slot.ticker && e.calendarQuarter === slot.quarter);
  const dateMatches = !!source && slot.selected?.filingDate === source.releaseDate;
  return {...slot,
    sourceDiscovery: source ?? null,
    scheduledReleaseDateCrosscheck: dateMatches ? 'matches_independent_source_manifest' : 'unresolved',
    guidanceReview: 'pending', timingVerified: false, eligibleForReturns: false,
    contentFinding: content?.entries.find(e => e.ticker === slot.ticker && e.quarter === slot.quarter) ? cleanReceipt(content.entries.find(e => e.ticker === slot.ticker && e.quarter === slot.quarter)) : null,
    indexReceipt: slot.indexReceipt ? cleanReceipt(slot.indexReceipt) : null,
    documents: slot.documents.map(doc => ({...doc,
      receipt: doc.receipt ? cleanReceipt(doc.receipt) : undefined,
      keywordWindows: (doc.keywordWindows ?? []).slice(0,2).map(w => ({...w,text:w.text.slice(0,250)})) })),
  };
});
const publication = { ...audit, receipts: audit.receipts.map(cleanReceipt), slots,
  publishedAt: new Date().toISOString(), publicationMode:'research_feasibility_snapshot',
  summary: { slots:slots.length, slotsWithExhibits:slots.filter(s=>s.documents.some(d=>d.status==='retrieved_unverified')).length,
    retrievedExhibits:slots.flatMap(s=>s.documents).filter(d=>d.status==='retrieved_unverified').length,
    sourceDatesMatched:slots.filter(s=>s.scheduledReleaseDateCrosscheck==='matches_independent_source_manifest').length,
    verifiedGuidancePairs:0, verifiedAvailabilityTimes:0, eligibleForReturns:0 },
  contentAudit:content ? {...content,entries:content.entries.map(cleanReceipt)} : null,
  limitations:['Fixed convenience sample; not a representative investment universe.', 'Current-hosted historical documents, not a verified point-in-time archive.',
    'SEC acceptance is not proof of first public dissemination.', 'Keyword excerpts are discovery aids; exact guidance pairs and latest prior updates require review.',
    'No prices, returns, predictive results, or trading signals in this publication.'] };
publication.contentSha256 = hash(JSON.stringify(publication));
await writeFile(resolve(outputArg), JSON.stringify(publication,null,2)+'\n');
console.log(JSON.stringify(publication.summary));
