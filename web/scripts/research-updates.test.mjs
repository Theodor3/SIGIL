import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=mkdtempSync(join(tmpdir(),'sigil-updates-tests-'));
execFileSync(process.execPath,[join(web,'node_modules/typescript/bin/tsc'),join(web,'src/lib/researchUpdates.ts'),'--outDir',out,'--module','ES2022','--target','ES2022','--strict','--skipLibCheck'],{stdio:'pipe'});
writeFileSync(join(out,'researchUpdates.mjs'),readFileSync(join(out,'researchUpdates.js')));
const {validateResearchUpdates,selectResearchUpdates}=await import(pathToFileURL(join(out,'researchUpdates.mjs')));
after(()=>{if(dirname(resolve(out))!==resolve(tmpdir())||!out.includes('sigil-updates-tests-'))throw new Error('Unexpected temp path');rmSync(out,{recursive:true,force:true});});
const registry=JSON.parse(readFileSync(join(web,'public/research/experiments.json'),'utf8'));
const fixture=()=>JSON.parse(readFileSync(join(web,'public/research/updates.json'),'utf8'));
const validate=x=>validateResearchUpdates(x,registry.contentSha256,registry.experiments.map(e=>e.id));
test('curated real entries retain local/public and unrecorded-time distinctions',()=>{
 const d=validate(fixture());assert.equal(d.updates.length,4);assert.equal(d.publicationMode,'reviewed_snapshot');assert.equal(d.coverage,'curated_partial');assert.equal(d.updates.filter(x=>x.availability==='local_only').length,1);assert.ok(d.updates.every(x=>x.originalResultAt===null));assert.match(d.updates.find(x=>x.availability==='local_only').summary,/unknown.*429/);
});
test('feed cannot silently attach to another registry or unknown experiment',()=>{
 const d=fixture();d.registryContentSha256='0'.repeat(64);assert.throws(()=>validate(d));const unknown=fixture();unknown.updates[0].experimentId='MISSING';assert.throws(()=>validate(unknown));
});
test('invalid, duplicate and future-relative result times fail visibly',()=>{
 for(const mutate of [d=>d.updates.push(d.updates[0]),d=>d.updates[0].recordedAt='2026-02-30T00:00:00Z',d=>d.updates[0].recordedAt='2026-11-02',d=>d.updates[0].originalResultAt='2099-01-01T00:00:00Z']){const d=fixture();mutate(d);assert.throws(()=>validate(d));}
});
test('local paths, unsafe source URLs and spoofed hosts cannot enter projected content',()=>{
 for(const url of ['file:///C:/Users/private','https://user@www.fda.gov/','https://www.fda.gov.evil.test/','http://www.fda.gov/','https://127.0.0.1/','https://www.fda.gov/path?access_token=not-real','https://www.fda.gov/path#private-context']){const d=fixture();d.updates[0].sources[0].url=url;assert.throws(()=>validate(d));}
 for(const text of ['See C:/Users/private/note.md','file:///private','Open /home/user/private']){const d=fixture();d.updates[0].summary=text;assert.throws(()=>validate(d));}
 for(const inject of [d=>d.privatePath='not allowed',d=>d.updates[0].privatePath='not allowed',d=>d.updates[0].sources[0].privatePath='not allowed']){const d=fixture();inject(d);assert.throws(()=>validate(d));}
});
test('filters preserve negative/local findings and sort by entry time without mutating input',()=>{
 const d=validate(fixture());const before=JSON.stringify(d.updates);assert.equal(selectResearchUpdates(d.updates,'negative').length,2);assert.equal(selectResearchUpdates(d.updates,'local').length,1);assert.equal(selectResearchUpdates(d.updates,'blocked').length,1);assert.equal(selectResearchUpdates(d.updates,'result').length,1);assert.equal(JSON.stringify(d.updates),before);
 d.updates[0].recordedAt='2026-11-01T00:00:00Z';assert.notEqual(selectResearchUpdates(d.updates,'all')[0].id,d.updates[0].id);
});
test('empty partial feed is valid and malformed review categories fail',()=>{
 const empty=fixture();empty.updates=[];assert.equal(validate(empty).updates.length,0);
 const invalid=fixture();invalid.updates[0].review='validated_alpha';assert.throws(()=>validate(invalid));
});

