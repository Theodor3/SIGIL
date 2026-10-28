export type FreightEvidence = {
  schemaVersion: 1; operator: "CSX"; sourceUrl: string; sha256: string;
  retrievedAt: string; publicationTimestamp: null; periodStart: string; periodEnd: string;
  sheet: string; systemSpeedMph: number; systemDwellHours: number;
  terminals: { name: string; dwellHours: number; cell: string }[];
  trendObservations: 1; predictiveResultsAvailable: false;
};
function date(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
export function validateFreightEvidence(value: unknown): FreightEvidence {
  if (!value || typeof value !== "object") throw new Error("Freight evidence is missing.");
  const d = value as FreightEvidence;
  let sourceValid = false;
  try { const u = new URL(d.sourceUrl); sourceValid = u.origin === "https://www.stb.gov" && !u.username && !u.password && u.pathname.endsWith(".xlsx"); } catch { /* rejected below */ }
  if (d.schemaVersion !== 1 || d.operator !== "CSX" || !sourceValid || !/^[a-f0-9]{64}$/.test(d.sha256)
    || typeof d.retrievedAt !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(d.retrievedAt)
    || !Number.isFinite(Date.parse(d.retrievedAt)) || d.publicationTimestamp !== null
    || !date(d.periodStart) || !date(d.periodEnd) || Date.parse(d.periodEnd) - Date.parse(d.periodStart) !== 6 * 86400000
    || Date.parse(d.periodEnd) >= Date.parse(d.retrievedAt)
    || d.sheet !== "Rail Service (Item Nos. 1-6)" || !positive(d.systemSpeedMph) || !positive(d.systemDwellHours)
    || d.trendObservations !== 1 || d.predictiveResultsAvailable !== false || !Array.isArray(d.terminals) || d.terminals.length !== 10
    || d.terminals.some(t => !t || typeof t.name !== "string" || !t.name.trim() || !positive(t.dwellHours) || !/^B(1[7-9]|2[0-6])$/.test(t.cell))
    || new Set(d.terminals.map(t => t.name.trim().toLowerCase())).size !== 10 || new Set(d.terminals.map(t => t.cell)).size !== 10) {
    throw new Error("Freight source packet failed validation.");
  }
  return d;
}
