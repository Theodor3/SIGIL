import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function quarter(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date.slice(0, 4)}Q${Math.ceil(Number(date.slice(5, 7)) / 3)}` : null;
}
export function candidates(recent, period) {
  return (recent.form ?? []).flatMap((form, i) => {
    const date = recent.filingDate?.[i];
    const items = String(recent.items?.[i] ?? '').split(',').map(x => x.trim());
    if (form !== '8-K' || !items.includes('2.02') || quarter(date ?? '') !== period) return [];
    const accession = recent.accessionNumber?.[i];
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accession ?? '')) return [];
    return [{ accession, filingDate: date, apiAcceptanceRaw: recent.acceptanceDateTime?.[i] ?? null,
      primaryDocument: recent.primaryDocument?.[i] ?? null }];
  }).sort((a,b) => a.filingDate.localeCompare(b.filingDate) || a.accession.localeCompare(b.accession));
}
export function textOf(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => { const v = Number(n); return v <= 0x10ffff ? String.fromCodePoint(v) : ''; })
    .replace(/\s+/g, ' ').trim();
}
export function indexDetails(html) {
  const accepted = html.match(/>Accepted<\/div>\s*<div[^>]*>([^<]+)</i)?.[1] ?? null;
  const exhibits = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(([, row]) => {
    if (!/EX-99(?:\.\d+)?/i.test(textOf(row))) return [];
    const href = row.match(/href\s*=\s*"([^"]+)"/i)?.[1];
    if (!href) return [];
    const url = new URL(href, 'https://www.sec.gov');
    return url.origin === 'https://www.sec.gov' && url.pathname.startsWith('/Archives/') ? [url.href] : [];
  });
  return { secAcceptedLocal: accepted, secAcceptedTimezone: 'America/New_York', exhibitUrls: [...new Set(exhibits)] };
}
export function windows(text) {
  return [...text.matchAll(/\b(?:guidance|outlook|targets?|expects?)\b/gi)].slice(0, 12)
    .map(m => ({ start: Math.max(0, m.index - 160), text: text.slice(Math.max(0, m.index - 160), m.index + 650) }));
}
export async function collect(destination, { fetchImpl = fetch, spacingMs = 200 } = {}) {
  const configBytes = await readFile(new URL('./experiment-v1.json', import.meta.url));
  const config = JSON.parse(configBytes);
  // Exclusive directory prevents silently replacing any earlier run or failure.
  await mkdir(destination, { recursive: false });
  await mkdir(resolve(destination, 'raw'));
  await writeFile(resolve(destination, 'experiment.json'), configBytes, { flag: 'wx' });
  const audit = { schemaVersion: 1, id: config.id, startedAt: new Date().toISOString(), configSha256: hash(configBytes),
    stage: 'unverified_source_receipts', predictiveResultsAvailable: false, receipts: [], slots: [], errors: [] };
  const cache = new Map();
  async function receipt(url) {
    if (cache.has(url)) return cache.get(url);
    await new Promise(r => setTimeout(r, spacingMs));
    const retrievedAt = new Date().toISOString();
    const record = { url, retrievedAt, status: null, sha256: null, rawFile: null, error: null };
    audit.receipts.push(record);
    try {
      const response = await fetchImpl(url, { headers: { 'User-Agent': 'SIGIL research dashboard (theodoremaiello@gmail.com)' }, signal: AbortSignal.timeout(25000) });
      record.status = response.status;
      const bytes = Buffer.from(await response.arrayBuffer());
      record.sha256 = hash(bytes);
      record.rawFile = `raw/${record.sha256}.bin`;
      await writeFile(resolve(destination, record.rawFile), bytes, { flag: 'wx' }).catch(e => { if(e.code !== 'EEXIST') throw e; });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = { record, text: bytes.toString('utf8') }; cache.set(url, result); return result;
    } catch (e) { record.error = String(e.message); cache.set(url, null); return null; }
  }
  for (const issuer of config.sample.issuers) {
    const submission = await receipt(`https://data.sec.gov/submissions/CIK${String(issuer.cik).padStart(10,'0')}.json`);
    let recent = {}, coverageComplete = !!submission;
    try {
      const data = submission ? JSON.parse(submission.text) : null;
      recent = data?.filings?.recent ?? {};
      if (data && (!Array.isArray(recent.form) || !Array.isArray(recent.filingDate) || !Array.isArray(recent.items) || !Array.isArray(recent.accessionNumber))) throw new Error('Invalid submissions schema');
      // Preserve older submission batches needed for this fixed historical window.
      for (const file of data?.filings?.files ?? []) {
        if (file.filingTo < '2024-07-01' || file.filingFrom > '2025-09-30') continue;
        if (!/^CIK\d{10}-submissions-\d+\.json$/.test(file.name)) { coverageComplete = false; continue; }
        const older = await receipt(`https://data.sec.gov/submissions/${file.name}`);
        if (older) { const rows = JSON.parse(older.text); if (!Array.isArray(rows.form) || !Array.isArray(rows.filingDate) || !Array.isArray(rows.items) || !Array.isArray(rows.accessionNumber)) throw new Error('Invalid older submissions schema'); for (const key of Object.keys(rows)) if(Array.isArray(rows[key])) recent[key] = [...(recent[key] ?? []), ...rows[key]]; }
        else coverageComplete = false;
      }
    } catch(e) { coverageComplete = false; audit.errors.push({ ticker: issuer.ticker, error: String(e.message) }); }
    for (const period of config.sample.quarters) {
      const choices = candidates(recent, period);
      const slot = { ticker: issuer.ticker, quarter: period, candidates: choices, selected: choices[0] ?? null,
        coverageComplete,
        status: !submission ? 'retrieval_failed' : !coverageComplete ? 'incomplete_filing_coverage' : !choices.length ? 'missing_filing' : choices.length > 1 ? 'ambiguous_candidates' : 'candidate_unverified',
        indexReceipt: null, index: null, documents: [], guidanceReview: 'pending', timingVerified: false, eligibleForReturns: false };
      audit.slots.push(slot);
      if (!slot.selected) continue;
      const a = slot.selected.accession;
      const index = await receipt(`https://www.sec.gov/Archives/edgar/data/${issuer.cik}/${a.replaceAll('-','')}/${a}-index.html`);
      if (!index) { slot.status = 'retrieval_failed'; continue; }
      slot.indexReceipt = index.record; slot.index = indexDetails(index.text);
      for (const url of slot.index.exhibitUrls.slice(0, 3)) {
        const doc = await receipt(url);
        if (!doc) { slot.documents.push({ url, status: 'retrieval_failed' }); continue; }
        const text = textOf(doc.text);
        slot.documents.push({ url, status: 'retrieved_unverified', receipt: doc.record, normalizedTextSha256: hash(text),
          keywordWindows: windows(text), extractionNote: 'Keyword windows only; not verified guidance, timing, or a trading signal.' });
      }
      if (!slot.documents.length) slot.status = 'no_exhibit_found';
      else if (slot.documents.every(d => d.status === 'retrieval_failed')) slot.status = 'exhibit_retrieval_failed';
      else if (slot.documents.some(d => d.status === 'retrieval_failed')) slot.status = 'partial_exhibit_retrieval';
    }
    await writeFile(resolve(destination, 'audit.json'), JSON.stringify(audit, null, 2));
    console.log(`${issuer.ticker}: ${audit.slots.filter(s => s.ticker === issuer.ticker && s.documents.some(d => d.status === 'retrieved_unverified')).length}/5 slots have exhibit receipts`);
  }
  audit.completedAt = new Date().toISOString();
  await writeFile(resolve(destination, 'audit.json'), JSON.stringify(audit, null, 2));
  return audit;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Supply a NEW run directory; prior runs cannot be overwritten.');
  await collect(resolve(process.argv[2]));
}
