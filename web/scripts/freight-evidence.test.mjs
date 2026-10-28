import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=mkdtempSync(join(tmpdir(),'sigil-freight-evidence-'));
execFileSync(process.execPath,[join(web,'node_modules/typescript/bin/tsc'),join(web,'src/lib/freightEvidence.ts'),'--outDir',output,'--module','ES2022','--target','ES2022','--skipLibCheck','--strict']);
writeFileSync(join(output,'freightEvidence.mjs'),readFileSync(join(output,'freightEvidence.js')));
const {validateFreightEvidence}=await import(pathToFileURL(join(output,'freightEvidence.mjs')));
const packet=JSON.parse(readFileSync(join(web,'public/research/freight-evidence.json'),'utf8'));
test('source-bound workbook facts preserve reporting period and unknown publication',()=>{
 const data=validateFreightEvidence(packet);
 assert.equal(data.periodStart,'2026-10-10');assert.equal(data.periodEnd,'2026-10-16');
 assert.equal(data.sha256,'c46ec378c719c43338277c847b5c4c0f0df347efee29e82b20f5ca365f41eb18');
 assert.equal(data.publicationTimestamp,null);assert.equal(data.systemDwellHours,20.76);
 assert.equal(data.terminals[7].name,'Selkirk, NY');assert.equal(data.terminals[7].cell,'B24');
});
test('bad timing, unsafe source, unsupported prediction or fabricated trend fails closed',()=>{
 for(const changes of [{publicationTimestamp:'2026-10-21T00:00:00Z'},{retrievedAt:'2026-10-27'},
  {periodStart:'2026-02-30'},{sourceUrl:'javascript:alert(1)'},{sourceUrl:'https://www.stb.gov.evil.invalid/file.xlsx'},
  {predictiveResultsAvailable:true},{trendObservations:8},{systemDwellHours:NaN}]) {
   assert.throws(()=>validateFreightEvidence({...packet,...changes}));
 }
});
test('duplicate terminal identity and source cell are rejected',()=>{
 const duplicate=structuredClone(packet);duplicate.terminals[1]=duplicate.terminals[0];
 assert.throws(()=>validateFreightEvidence(duplicate));
});
