import test from 'node:test';
import assert from 'node:assert/strict';
import {auditPrices,sha256,saveImmutable} from './audit-prices.mjs';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function input(symbol, prices=[100,110]) {
  const bytes=Buffer.from(JSON.stringify({chart:{error:null,result:[{meta:{symbol},timestamp:[Date.parse('2020-01-02')/1000,Date.parse('2020-01-22')/1000],indicators:{adjclose:[{adjclose:prices}]}}]}}));
  return {receipt:{symbol,retrievedAt:'2026-10-27T12:00:00Z',sha256:sha256(bytes)},bytes};
}
test('matched outcomes are traceable but never original forecasts',()=>{
  const r=auditPrices([input('SPY'),input('EFA',[100,120])]);
  assert.equal(r.outcomes.length,1); assert.ok(Math.abs(r.outcomes[0].stockReturn-.2)<1e-12);
  assert.equal(r.outcomes[0].pointInTimeForecastEligible,false); assert.equal(r.originalForecasts,0);
  assert.equal(r.excluded.EFA.missingExactExit,1);
});
test('reject tampered bytes and duplicate symbols',()=>{
  const i=input('SPY');assert.throws(()=>auditPrices([{...i,bytes:Buffer.from('{}')}]),/hash mismatch/);
  assert.throws(()=>auditPrices([i,i]),/duplicate symbol/);
});
test('missing adjusted prices are counted rather than replaced',()=>{
  const r=auditPrices([input('SPY'),input('EFA',[100,null])]);
  assert.equal(r.sources[1].missingPrices,1);assert.equal(r.outcomes.length,0);
});
test('exclude retrieval-day partial session; reject naive receipt time',()=>{
  const i=input('SPY');i.receipt.retrievedAt='2020-01-22T12:00:00Z';
  const r=auditPrices([i]);assert.equal(r.sources[0].incompleteDateExcluded,1);assert.equal(r.sources[0].observations,1);
  i.receipt.retrievedAt='2026-10-27T12:00:00';assert.throws(()=>auditPrices([i]),/Zoned/);
});
test('derived return overflow cannot silently serialize as null',()=>{
  assert.throws(()=>auditPrices([input('SPY'),input('EFA',[Number.MIN_VALUE,Number.MAX_VALUE])]),/Nonfinite/);
});
test('content-addressed save verifies existing bytes and never overwrites',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sigil-alpha-audit-'));const r=auditPrices([input('SPY')]);
  const saved=saveImmutable(r,dir);assert.equal(sha256(readFileSync(saved.file)),saved.sha256);
  assert.deepEqual(saveImmutable(r,dir),saved);
  writeFileSync(saved.file,'tampered');assert.throws(()=>saveImmutable(r,dir),/modified/);
});
