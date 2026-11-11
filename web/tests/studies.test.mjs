import test from 'node:test';
import assert from 'node:assert/strict';
import { selectStudies, studyStatus } from '../src/lib/studies.ts';
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
