import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectRegistry } from './export-experiments.mjs';
const fixture = () => JSON.parse(readFileSync(new URL('../../.swarm/experiments.json', import.meta.url), 'utf8'));
test('publication excludes private paths, missions and dispatch permissions', () => {
  const input = fixture();
  input.experiments[0].missionIds = ['private-mission'];
  input.experiments[0].privateNote = 'not-for-publication';
  const out = projectRegistry(input, '2026-10-04');
  const raw = JSON.stringify(out);
  for (const key of ['evidenceReport', 'evidenceManifest', 'runtimeDispatchEnabled', 'missionIds', 'paperTrial', 'not-for-publication', 'C:/Users']) assert.ok(!raw.includes(key));
  assert.equal(out.publicationMode, 'reviewed_snapshot');
  assert.equal(out.experiments[0].predictiveResultsAvailable, false);
});
test('content fingerprint changes when public evidence changes', () => {
  const input = fixture();
  const before = projectRegistry(input, '2026-10-04');
  input.experiments[0].findings[0].summary += ' Corrected';
  assert.notEqual(before.contentSha256, projectRegistry(input, '2026-10-04').contentSha256);
});
test('reject malformed counts, booleans, duplicate IDs and unsafe URLs', () => {
  for (const change of [x => x.sourceSamples = true, x => x.originalPublicationTimesVerified = 'false',
    x => x.publicSources = [{title:'unsafe', url:'javascript:alert(1)'}],
    x => x.publicSources = [{title:'unsafe', url:'https://secret@www.stb.gov/'}]]) {
    const input = fixture(); change(input.experiments[0]);
    assert.throws(() => projectRegistry(input, '2026-10-04'));
  }
  const duplicate = fixture(); duplicate.experiments.push(duplicate.experiments[0]);
  assert.throws(() => projectRegistry(duplicate, '2026-10-04'));
});

test('reviewed overnight records retain outcomes and source boundaries', () => {
  const input = fixture();
  const out = projectRegistry(input, '2026-10-29');
  assert.equal(out.experiments.length, 12);
  assert.equal(out.experiments.find(x => x.id === 'CROP-SPATIAL-ALIGNMENT-001').predictiveResultsAvailable, false);
  assert.match(out.experiments.find(x => x.id === 'CPC-CASH-MONTHLY-001').findings[0].summary, /worsened/);
  for (const url of ['https://www.eia.gov.evil.example/', 'http://www.eia.gov/', 'https://user@www.eia.gov/']) {
    const bad = structuredClone(input);
    bad.experiments[1].publicSources = [{title:'invalid', url}];
    assert.throws(() => projectRegistry(bad, '2026-10-29'));
  }
});

test('paper forecast remains frozen, unresolved and explicitly uncalibrated', () => {
  const out = projectRegistry(fixture(), '2026-10-30');
  const card = out.experiments.find(x => x.id === 'DSM-TEMP-PAPER-001');
  assert.equal(card.status, 'awaiting_outcome');
  assert.equal(card.sourceSamples, 1);
  assert.equal(card.predictiveResultsAvailable, false);
  assert.equal(card.originalPublicationTimesVerified, false);
  assert.match(card.findings.find(x => x.id === 'FROZEN').summary, /2026-10-29T21:48:45/);
  assert.match(card.findings.find(x => x.id === 'COMPARISON').summary, /uncalibrated/);
  assert.match(card.findings.find(x => x.id === 'LIMITS').summary, /not a live outcome feed/);
  assert.ok(card.publicSources.every(x => new URL(x.url).hostname === 'api.weather.gov'));
  assert.deepEqual(JSON.parse(readFileSync(new URL('../public/research/experiments.json', import.meta.url), 'utf8')), out);
  const bad = fixture();
  bad.experiments[0].publicSources[0].url = 'https://api.weather.gov.evil.example/';
  assert.throws(() => projectRegistry(bad, '2026-10-29'));
});

test('timestamps retain precision and reject invalid or naive instants', () => {
  const good=fixture(); const before=good.experiments[0].createdAt;
  const out=projectRegistry(good,'2026-10-30');
  assert.equal(out.experiments[0].createdAt,before);
  assert.equal(out.experiments[0].decisionAt,'2026-10-29T21:48:45.429293+00:00');
  for(const stamp of ['2026-02-30','yesterday','2026-10-30T12:00:00','2026-10-30T24:00:00Z']) {
    const bad=fixture();bad.experiments[0].createdAt=stamp;
    assert.throws(()=>projectRegistry(bad,'2026-10-30'));
  }
  assert.throws(()=>projectRegistry(fixture(),'2026-02-30'));
  const bad=fixture();bad.experiments[0].targetAt=bad.experiments[0].decisionAt;
  assert.throws(()=>projectRegistry(bad,'2026-10-30'));
});
test('new tracks are plans not fabricated results',()=>{
 const out=projectRegistry(fixture(),'2026-10-30');
 for(const id of ['DRUG-SUPPLY-DURATION-001','PROCUREMENT-REVENUE-001','LOCATION-DEMAND-LSTM-001']) {
  const x=out.experiments.find(x=>x.id===id);assert.equal(x.sourceSamples,0);assert.equal(x.predictiveResultsAvailable,false);assert.equal(x.originalPublicationTimesVerified,false);
 }
});
