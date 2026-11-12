import test from 'node:test';
import assert from 'node:assert/strict';
import { selectStudies, studyStatus, readStudyFilters, updateStudyFilters } from '../src/lib/studies.ts';
const study = (id, extra = {}) => ({id, title:id, ticker:'ABC', status:'in_progress', stage:'feasibility', hypothesis:'Question', createdAt:'2026-10-01', nextAction:'Collect evidence', sourceSamples:0, findings:[], predictiveResultsAvailable:false, ...extra});
test('newly published records appear without a hard-coded list and sort by registration', () => {
  const records = [study('old'), study('new', {createdAt:'2026-11-10'})];
  assert.deepEqual(selectStudies(records, '', 'all', 'registered').map(x=>x.id), ['new','old']);
  assert.equal(records[0].id,'old');
});
test('search covers company, question, ID and next step and combines with exact status', () => {
  const records = [study('one'),study('two',{status:'negative_result', ticker:'XYZ'})];
  assert.equal(selectStudies(records,' xyz ','negative_result','title')[0].id,'two');
  assert.equal(selectStudies(records,'Collect','all','title').length,2);
  assert.equal(selectStudies(records,'Question','negative_result','title').length,1);
  assert.equal(selectStudies(records,'one','negative_result','title').length,0);
});
test('empty and unknown statuses remain honest and deterministic', () => {
  assert.deepEqual(selectStudies([], '', 'all','title'),[]);
  assert.equal(studyStatus('new_state'), 'new state');
  assert.equal(selectStudies([study('z'),study('a')],'','all','registered')[0].id,'a');
  assert.equal(selectStudies([study('new',{status:'new_state'})],'','new_state','title').length,1);
});

test('filters round-trip URL encoding, normalize sort and preserve unknown statuses', () => {
  const params = updateStudyFilters(new URLSearchParams('ref=notes'), {query:'rail & café + rates',status:'new_state',order:'title'});
  assert.deepEqual(readStudyFilters(new URLSearchParams(params.toString())), {query:'rail & café + rates',status:'new_state',order:'title'});
  assert.equal(params.get('ref'),'notes');
  assert.deepEqual(readStudyFilters(new URLSearchParams('sort=invalid&status=')), {query:'',status:'all',order:'registered'});
});

test('filter edits remove defaults and duplicate keys without mutating prior URL params', () => {
  const before = new URLSearchParams('q=old&q=duplicate&status=negative_result&sort=title&ref=notes');
  const after = updateStudyFilters(before, {query:'new'});
  assert.deepEqual(after.getAll('q'), ['new']);
  assert.equal(before.get('q'), 'old');
  assert.equal(after.get('status'), 'negative_result');
  assert.equal(updateStudyFilters(after, {query:'',status:'all',order:'registered'}).toString(), 'ref=notes');
});

test('prototype property names never escape status labels as objects or functions', () => {
  for (const value of ['__proto__', 'constructor', 'toString']) {
    assert.equal(studyStatus(value), value.replace(/_/g, ' '));
    assert.equal(typeof studyStatus(value), 'string');
  }
});
