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
