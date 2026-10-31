import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const strings = ['id', 'title', 'type', 'ticker', 'stage', 'status', 'hypothesisVersion', 'hypothesis', 'createdAt', 'nextAction'];
const bools = ['originalPublicationTimesVerified', 'predictiveResultsAvailable'];
const fail = () => { throw new Error('Invalid experiment publication input'); };
const text = (x) => typeof x === 'string' && x.length > 0 && x.length <= 12000 ? x : fail();
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function validInstant(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && validDate(value.slice(0,10)) && +value.slice(11,13) < 24 && +value.slice(14,16) < 60 && +value.slice(17,19) < 60 && Number.isFinite(Date.parse(value));
}
export function projectRegistry(data, reviewedOn) {
  if (!validDate(reviewedOn) || data.schemaVersion !== 1 || !Array.isArray(data.experiments)) fail();
  const ids = new Set();
  const experiments = data.experiments.map(item => {
    const out = Object.fromEntries(strings.map(key => [key, text(item[key])]));
    if (!validDate(out.createdAt) && !validInstant(out.createdAt)) fail();
    for (const key of ['decisionAt', 'targetAt']) {
      if (item[key] !== undefined && item[key] !== null) {
        if (!validInstant(item[key])) fail();
        out[key] = item[key];
      }
    }
    if (out.decisionAt && out.targetAt && Date.parse(out.targetAt) <= Date.parse(out.decisionAt)) fail();
    if (ids.has(out.id)) fail();
    ids.add(out.id);
    for (const key of bools) { if (typeof item[key] !== 'boolean') fail(); out[key] = item[key]; }
    if (!Number.isSafeInteger(item.sourceSamples) || item.sourceSamples < 0) fail();
    out.sourceSamples = item.sourceSamples;
    if (!Array.isArray(item.findings)) fail();
    out.findings = item.findings.map(f => Object.fromEntries(['id', 'status', 'summary'].map(k => [k, text(f[k])])));
    out.publicSources = (item.publicSources ?? []).map(s => {
      const url = new URL(text(s.url));
      if (url.protocol !== 'https:' || url.username || url.password || !["www.stb.gov", "stb.gov", "www.csx.com", "csx.com", "www.cpc.ncep.noaa.gov", "www.ers.usda.gov", "noaa-gfs-bdp-pds.s3.amazonaws.com", "www.ncei.noaa.gov", "www.eia.gov", "www.bls.gov", "calmainefoods.gcs-web.com", "data.cms.gov", "opendata.usac.org", "croplandcros.scinet.usda.gov", "www.nass.usda.gov", "api.weather.gov", "api.fda.gov", "api.usaspending.gov", "www.fda.gov", "open.fda.gov", "www.ncbi.nlm.nih.gov", "www.usaspending.gov", "www.sec.gov", "investor.starbucks.com", "docs.advanresearch.com"].includes(url.hostname)) fail();
      const source = {title: text(s.title), url: url.href};
      if (s.sha256 !== undefined) {
        if (!/^[a-f0-9]{64}$/.test(s.sha256)) fail();
        source.sha256 = s.sha256;
      }
      return source;
    });
    return out;
  });
  const canonical = JSON.stringify(experiments);
  return {schemaVersion: 1, publicationMode: 'reviewed_snapshot', reviewedOn,
    contentSha256: createHash('sha256').update(canonical).digest('hex'), experiments};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reviewedOn = process.argv[2];
  if (!reviewedOn) throw new Error('Supply the date this public projection was reviewed (YYYY-MM-DD). This does not deploy.');
  const input = JSON.parse(readFileSync(new URL('../../.swarm/experiments.json', import.meta.url), 'utf8'));
  const output = projectRegistry(input, reviewedOn);
  const target = fileURLToPath(new URL('../public/research/experiments.json', import.meta.url));
  writeFileSync(target, JSON.stringify(output, null, 2) + '\n');
  console.log(`Prepared ${output.experiments.length} reviewed experiment snapshot(s). Inspect the diff before deployment.`);
}
