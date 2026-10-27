import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
// Compile the pure display helper with the project's existing compiler; no server or broker.
const source = readFileSync(new URL('../src/lib/dashboardProvenance.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const { dashboardProvenance } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const snapshot = (last_run) => ({portfolio:{is_demo:false},pipeline:{run_id:'fixture-run',last_run,status:'completed'}});

test('demo values cannot be represented as a broker account', () => {
 const label=dashboardProvenance({portfolio:{is_demo:true}});
 assert.match(label.account,/synthetic demo balances/); assert.match(label.pipeline,/No completed/);
});
test('missing provenance remains unverified rather than defaulting to paper', () => {
 assert.match(dashboardProvenance({}).account,/unverified/);
});
test('broker flag describes paper account without implying freshness', () => {
 assert.match(dashboardProvenance(snapshot('2024-08-15T10:59:32Z')).account,/broker-backed paper/);
 assert.match(dashboardProvenance(snapshot('2024-08-15T10:59:32Z')).account,/does not verify/);
});
test('old completed data keeps its actual source date after page refresh', () => {
 const label=dashboardProvenance(snapshot('2024-08-15T10:59:32Z'));
 assert.match(label.pipeline,/2024-08-15T10:59:32.000Z/);
 assert.match(label.caveat,/does not refresh the underlying research/);
});
test('timezone offset is normalized; naive datetime is explicitly ambiguous', () => {
 assert.match(dashboardProvenance(snapshot('2024-11-19T06:59:42-05:00')).pipeline,/2024-11-19T11:59:42.000Z/);
 assert.match(dashboardProvenance(snapshot('2024-11-19T06:59:42')).pipeline,/timezone unspecified/);
});
test('missing run or malformed timestamp never claims a current snapshot', () => {
 assert.match(dashboardProvenance({pipeline:{last_run:'2024-01-01T00:00:00Z'}}).pipeline,/No completed/);
 assert.match(dashboardProvenance(snapshot('garbage')).pipeline,/timestamp unavailable/);
});
test('display classification does not mutate payloads', () => {
 const data=snapshot('2024-08-15T10:59:32Z');const before=structuredClone(data);
 dashboardProvenance(data);assert.deepEqual(data,before);
});

test('age uses pipeline time, and future or ambiguous dates cannot imply freshness', () => {
 const now=Date.parse('2024-08-17T10:59:32Z');
 assert.match(dashboardProvenance(snapshot('2024-08-15T10:59:32Z'),now).pipeline,/Run age: 48 hours/);
 assert.match(dashboardProvenance(snapshot('2024-08-18T10:59:32Z'),now).pipeline,/in the future/);
 assert.match(dashboardProvenance(snapshot('2024-08-15T10:59:32'),now).pipeline,/Age unavailable/);
});
