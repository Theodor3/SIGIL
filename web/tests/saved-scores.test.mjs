import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/savedScores.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { formatSavedScore, scoreStatusLabel } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('missing scores and confidence never become zero', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(formatSavedScore(value), 'Unavailable');
    assert.equal(formatSavedScore(value, 0, '%'), 'Unavailable');
  }
});
test('saved values retain zero, negative scores, and explicit confidence units', () => {
  assert.equal(formatSavedScore(0), '0.00');
  assert.equal(formatSavedScore(-0.1234), '-12.34');
  assert.equal(formatSavedScore(0.75, 0, '%'), '75%');
});
test('statuses distinguish no run, unavailable history, invalid and unsaved snapshots', () => {
  const statuses = ['saved', 'no_run', 'legacy_unavailable', 'invalid_snapshot', 'serialization_unavailable', 'ticker_unavailable', undefined];
  assert.equal(new Set(statuses.map(scoreStatusLabel)).size, statuses.length);
  assert.match(scoreStatusLabel('saved'), /Historical saved pipeline/);
  assert.match(scoreStatusLabel('legacy_unavailable'), /older run/);
  assert.match(scoreStatusLabel('serialization_unavailable'), /could not be stored/);
});
test('research does not manufacture signal contributions or hide empty snapshots', () => {
  const research = readFileSync(new URL('../src/pages/Research.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(research, /ContributionBar|Weighted Total|top_drivers\.map|s\.contribution \*|s\.weight \*/);
  assert.match(research, /not additive attribution/);
  assert.match(research, /key=\{point\.run_id\}/);
  assert.doesNotMatch(research, /No signal data for this ticker/);
});
