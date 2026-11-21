import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createFixture} from './intake-fixture.mjs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ID,ROOT} from './intake-study.mjs';

// Exercise the real intake CLI in disposable filesystem fixtures, not a mocked validator.
function fixture(t) {
  const fixture=createFixture();t.after(()=>fixture.cleanup());
  fs.copyFileSync(path.join(ROOT,'web/scripts/intake-receipt.mjs'),path.join(fixture.root,'web/scripts/intake-receipt.mjs'));
  return fixture;
}
function run(root,...args){return spawnSync(process.execPath,['scripts/intake-study.mjs',...args],{cwd:path.join(root,'web'),encoding:'utf8'});}

test('real candidate check requires and fully validates a saved receipt',t=>{
  const f=fixture(t),original=fs.readFileSync(f.receipt);
  const packageJson=JSON.parse(fs.readFileSync(path.join(f.root,'web/package.json')));
  assert.equal(packageJson.scripts['studies:candidate:check'],'node scripts/intake-study.mjs check');
  assert.equal(run(f.root,'check').status,0);
  for(const [field,value] of Object.entries({accepted:false,manualReviewPending:false,evidenceFilesVerified:0,holdoutLockedAndUnscored:false,published:true,extraPermission:'publish'})){
    const altered={...JSON.parse(original),[field]:value};fs.writeFileSync(f.receipt,JSON.stringify(altered));
    const result=run(f.root,'check');assert.equal(result.status,1,field);assert.match(result.stderr,/stored receipt differs/);
  }
  // Parsed JSON equality intentionally ignores object-key order and receipt whitespace.
  fs.writeFileSync(f.receipt,JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(original)).reverse()),null,4));
  assert.equal(run(f.root,'check').status,0);
  fs.unlinkSync(f.receipt);
  const missing=run(f.root,'check');assert.equal(missing.status,1);assert.match(missing.stderr,/required acceptance receipt missing/);
  assert.equal(fs.existsSync(f.receipt),false,'check must not manufacture a receipt');
});

test('explicit record bootstrap remains possible and never overwrites a receipt',t=>{
  const f=fixture(t);fs.unlinkSync(f.receipt);
  assert.equal(run(f.root,'check','--record').status,0);
  const saved=fs.readFileSync(f.receipt);
  assert.equal(run(f.root,'check').status,0);
  assert.equal(run(f.root,'check','--record').status,1);
  assert.deepEqual(fs.readFileSync(f.receipt),saved);
});

test('standalone receipt CLI uses the same required-receipt path and rejects flags',t=>{
  const f=fixture(t);
  const standalone=(...args)=>spawnSync(process.execPath,['scripts/intake-receipt.mjs',...args],{cwd:path.join(f.root,'web'),encoding:'utf8'});
  assert.equal(standalone().status,0);
  assert.equal(standalone('--record').status,1);
  fs.unlinkSync(f.receipt);
  const result=standalone();assert.equal(result.status,1);assert.match(result.stderr,/required acceptance receipt missing/);
});
