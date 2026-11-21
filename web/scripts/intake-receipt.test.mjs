import test, {after} from 'node:test';
import {createFixture} from './intake-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ID, loadContext} from './intake-study.mjs';
import {validateReceipt} from './intake-receipt.mjs';

const fixture=createFixture();after(()=>fixture.cleanup());
const ROOT=fixture.root;
const bytes = fs.readFileSync(`${ROOT}/.swarm/candidates/${ID}.json`);
const receipt = JSON.parse(fs.readFileSync(`${ROOT}/.swarm/candidate-checks/${ID}.json`, 'utf8'));

test('synthetic receipt matches freshly checked aggregate evidence offline', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network forbidden'); };
  try { assert.deepEqual(validateReceipt(receipt, bytes, loadContext(ROOT)), receipt); }
  finally { globalThis.fetch = originalFetch; }
});

for (const [field, value] of Object.entries({
  accepted: false, acceptance: 'approved_for_publication', published: true,
  manualReviewPending: false, evidenceFilesVerified: 0,
  holdoutLockedAndUnscored: false, correctedEvidenceOnly: false,
  candidateSha256: '0'.repeat(64), protectedSourceHashesVerified: false,
  reviewedSnapshotWritten: true, sourceAllowlistChanged: true,
  unexpectedPermission: 'publish',
})) {
  test(`rejects altered receipt field: ${field}`, () => {
    assert.throws(() => validateReceipt({...receipt, [field]: value}, bytes, loadContext(ROOT)), /stored receipt differs/);
  });
}

test('missing receipt field rejects', () => {
  const altered = {...receipt}; delete altered.manualReviewPending;
  assert.throws(() => validateReceipt(altered, bytes, loadContext(ROOT)), /stored receipt differs/);
});

test('candidate bytes must match receipt even when only whitespace changes', () => {
  assert.throws(() => validateReceipt(receipt, Buffer.concat([bytes, Buffer.from('\n')]), loadContext(ROOT)), /stored receipt differs/);
});

test('receipt cannot substitute for checking current evidence or duplicate drafts', () => {
  const context = loadContext(ROOT); context.evidence['development-report.json'].holdout.rowsScored = 1;
  assert.throws(() => validateReceipt(receipt, bytes, context), /holdout/);
  assert.throws(() => validateReceipt(receipt, bytes, loadContext(ROOT), [{id: ID}]), /duplicate/);
});

test('equivalent receipt JSON serialization accepts whitespace and reordered keys', () => {
  const reordered = Object.fromEntries(Object.entries(receipt).reverse());
  const parsed = JSON.parse(JSON.stringify(reordered, null, 4));
  assert.deepEqual(validateReceipt(parsed, bytes, loadContext(ROOT)), receipt);
});
