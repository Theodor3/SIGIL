export type UpdateCategory = "result" | "negative" | "blocked";
export type ResearchUpdate = {
  id: string; experimentId: string; recordedAt: string; originalResultAt: string | null;
  category: UpdateCategory; availability: "published_dossier" | "local_only";
  review: "published_summary" | "independently_reviewed_descriptive";
  summary: string; timingNote: string; sources: { title: string; url: string }[];
};
export type ResearchUpdates = { schemaVersion: 1; publicationMode: "reviewed_snapshot"; coverage: "curated_partial"; registryContentSha256: string; updates: ResearchUpdate[] };
const hosts = new Set(["web.archive.org", "www.fda.gov", "opendata.usac.org", "www.cpc.ncep.noaa.gov", "www.ers.usda.gov", "calmainefoods.gcs-web.com"]);
const privatePath = /(?:^|[\s("'=])[a-z]:[\\/]|file:\/\/|\\\\|\/Users\/|\/home\/|localhost|127\.0\.0\.1/i;
const text = (x: unknown, max: number): x is string => typeof x === "string" && x.length > 0 && x.length <= max && !privatePath.test(x) && !/[\u0000-\u001f]/.test(x);
const onlyKeys=(value:object,keys:string[])=>Object.keys(value).every(key=>keys.includes(key));
function instant(x: unknown): x is string {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(x)) return false;
  const day = x.slice(0, 10);
  return Number.isFinite(Date.parse(x)) && new Date(day).toISOString().slice(0,10) === day && +x.slice(11,13)<24 && +x.slice(14,16)<60 && +x.slice(17,19)<60;
}
function safeSource(x: unknown): x is string {
  if (typeof x !== "string" || x.length > 2048) return false;
  try { const u = new URL(x); return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.search && !u.hash && hosts.has(u.hostname); } catch { return false; }
}
export function validateResearchUpdates(value: unknown, registryHash: string, experimentIds: string[]): ResearchUpdates {
  if (!value || typeof value !== "object") throw new Error("Invalid updates");
  const data = value as ResearchUpdates;
  if (!onlyKeys(data,["schemaVersion","publicationMode","coverage","registryContentSha256","updates"]) || data.schemaVersion !== 1 || data.publicationMode !== "reviewed_snapshot" || data.coverage !== "curated_partial"
      || !/^[a-f0-9]{64}$/.test(data.registryContentSha256) || data.registryContentSha256 !== registryHash
      || !Array.isArray(data.updates) || data.updates.length > 100) throw new Error("Updates do not match the research snapshot");
  const ids = new Set<string>(); const known = new Set(experimentIds);
  const updates = data.updates.map(item => {
    if (!item || typeof item !== "object" || !onlyKeys(item,["id","experimentId","recordedAt","originalResultAt","category","availability","review","summary","timingNote","sources"]) || !text(item.id,100) || !/^[A-Z0-9-]+$/.test(item.id) || ids.has(item.id)
        || !known.has(item.experimentId) || !instant(item.recordedAt)
        || (item.originalResultAt !== null && (!instant(item.originalResultAt) || Date.parse(item.originalResultAt)>Date.parse(item.recordedAt)))
        || !["result","negative","blocked"].includes(item.category)
        || !["published_dossier","local_only"].includes(item.availability)
        || !["published_summary","independently_reviewed_descriptive"].includes(item.review)
        || !text(item.summary,1600) || !text(item.timingNote,1000) || !Array.isArray(item.sources) || item.sources.length>5
        || item.sources.some(source => !source || !onlyKeys(source,["title","url"]) || !text(source.title,180) || !safeSource(source.url))) throw new Error("Invalid update record");
    ids.add(item.id);
    // Explicit public projection: never forward arbitrary artifact paths or fields.
    return {id:item.id,experimentId:item.experimentId,recordedAt:item.recordedAt,originalResultAt:item.originalResultAt,
      category:item.category,availability:item.availability,review:item.review,summary:item.summary,timingNote:item.timingNote,
      sources:item.sources.map(source=>({title:source.title,url:source.url}))};
  });
  return {schemaVersion:1,publicationMode:"reviewed_snapshot",coverage:"curated_partial",registryContentSha256:data.registryContentSha256,updates};
}
export function selectResearchUpdates(updates: ResearchUpdate[], filter: "all" | UpdateCategory | "local"): ResearchUpdate[] {
  return updates.filter(item => filter === "all" || (filter === "local" ? item.availability === "local_only" : item.category === filter))
    .sort((a,b)=>Date.parse(b.recordedAt)-Date.parse(a.recordedAt)||a.id.localeCompare(b.id));
}

