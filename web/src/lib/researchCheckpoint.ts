export const evidenceStates = ["qualified", "negative", "inconclusive", "pending"] as const;
export type EvidenceState = typeof evidenceStates[number];
type EvidenceSource = { title: string; url: string; sha256: string; representation: string };
export type EvidenceItem = {
  id: string; title: string; ticker: string; recordedAt: string; period: string;
  status: EvidenceState; finding: string; limitation: string; nextStep: string;
  unit: string; comparisonMeaning: string; metrics: { label: string; value: number }[];
  source: EvidenceSource; supportingSources?: EvidenceSource[]; artifactSha256: string;
  outcomeDueAt?: string;
};
type Checkpoint = { schemaVersion: number; reviewedOn: string; coverage: string; evidenceCheckedAt: string; manifestSha256: string; items: EvidenceItem[] };
const hosts = new Set(["www.sec.gov", "stock.walmart.com", "investor.servicenow.com", "data.ny.gov", "www.microsoft.com", "s206.q4cdn.com"]);
const clean = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 3000
  && !/(?:file:|localhost|127\.0\.0\.1|(?:^|\s)[A-Za-z]:[\\/])/i.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const day = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const instant = (v: unknown): v is string => typeof v === "string" && day(v.slice(0, 10))
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)
  && +v.slice(11,13) < 24 && +v.slice(14,16) < 60 && +v.slice(17,19) < 60 && Number.isFinite(Date.parse(v));
export function checkpoint(raw: unknown): Checkpoint {
  const data = raw as Checkpoint;
  if (!data || data.schemaVersion !== 1 || data.coverage !== "curated_local_checkpoint_not_live_swarm"
    || !day(data.reviewedOn) || !instant(data.evidenceCheckedAt) || !hash(data.manifestSha256)
    || !Array.isArray(data.items) || !data.items.length
    || new Set(data.items.map(i => i?.id)).size !== data.items.length) throw new Error("Invalid research checkpoint");
  for (const item of data.items) {
    if (!item || ![item.id, item.title, item.ticker, item.recordedAt, item.period, item.finding, item.limitation,
      item.nextStep, item.unit, item.comparisonMeaning].every(clean)
      || !/^[A-Za-z0-9-]+$/.test(item.id) || !evidenceStates.includes(item.status)
      || !(day(item.recordedAt) || instant(item.recordedAt))
      || (item.status === "pending" && !instant(item.outcomeDueAt))
      || !hash(item.artifactSha256) || !Array.isArray(item.metrics) || item.metrics.length < 2 || item.metrics.length > 8
      || !item.metrics.every(m => m && clean(m.label) && typeof m.value === "number" && Number.isFinite(m.value))
      || new Set(item.metrics.map(m => m.label)).size !== item.metrics.length
      || !item.source || !clean(item.source.title) || !clean(item.source.representation) || !hash(item.source.sha256)) throw new Error("Invalid research evidence");
    if (item.supportingSources !== undefined && (!Array.isArray(item.supportingSources) || item.supportingSources.length > 7)) throw new Error("Invalid supporting sources");
    for (const source of [item.source, ...(item.supportingSources ?? [])]) {
      if (!source || !clean(source.title) || !clean(source.representation) || !hash(source.sha256)) throw new Error("Missing source provenance");
      const url = new URL(source.url);
      if (url.protocol !== "https:" || url.username || url.password || url.port || !hosts.has(url.hostname)) throw new Error("Invalid research source");
    }
  }
  return data;
}
export function checkpointAgeNotice(data: Checkpoint, now = Date.now()): string {
  if (!Number.isFinite(now)) return "Local clock is unavailable; freshness is unverified.";
  const age = now - Date.parse(data.evidenceCheckedAt);
  if (age < 0) return "Evidence-check time is in the future; freshness is unverified.";
  if (age > 7 * 86400000) return "Evidence was checked more than seven days ago. Newer studies and outcomes may be missing; historical figures are not automatically invalidated.";
  return "Evidence checked as of the time above. New studies and resolved outcomes are not added automatically.";
}
export function pendingReviewNeeded(item: EvidenceItem, now = Date.now()) {
  return item.status === "pending" && !!item.outcomeDueAt && now > Date.parse(item.outcomeDueAt);
}
export function visibleEvidence(items: EvidenceItem[], state: EvidenceState | "all") {
  return items.filter(item => state === "all" || item.status === state)
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
}
export function chartScale(values: number[]) {
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const span = max - min || 1;
  return (value: number) => 210 + (value - min) / span * 320;
}
