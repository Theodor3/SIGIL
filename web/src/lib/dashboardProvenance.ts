interface ProvenanceInput {
  portfolio?: { is_demo?: boolean };
  pipeline?: { run_id?: string | null; last_run?: string | null; status?: string };
}

/** Display metadata only. Does not determine trading eligibility or alter data. */
export function dashboardProvenance(data: ProvenanceInput, now = Date.now()) {
  const demo = data.portfolio?.is_demo;
  const account = demo === true
    ? "Account source: synthetic demo balances. These are not broker account values."
    : demo === false
      ? "Account source: broker-backed paper account. This does not verify market-data freshness."
      : "Account source: unverified. Demo or broker provenance was not supplied.";
  const run = data.pipeline;
  if (!run?.run_id || !run.last_run) return {
    account,
    pipeline: "No completed pipeline snapshot. Regime values may be fallback defaults.",
    caveat: "Source: /api/dashboard-data. A connected dashboard does not establish current market observations.",
  };
  const raw = run.last_run;
  const parsed = Date.parse(raw);
  // Backend may serialize naive datetimes: never silently interpret those as local or UTC.
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
  const timestamp = !Number.isFinite(parsed)
    ? "timestamp unavailable"
    : hasZone ? new Date(parsed).toISOString() : raw + " (timezone unspecified)";
  const age = !hasZone || !Number.isFinite(parsed) || !Number.isFinite(now)
    ? "Age unavailable."
    : parsed > now
      ? "Timestamp is in the future; check source time."
      : "Run age: " + Math.floor((now - parsed) / 3_600_000) + " hours.";
  return {
    account,
    pipeline: "Latest completed run started: " + timestamp + ". Run: " + run.run_id + ". " + age,
    caveat: "Source: /api/dashboard-data. Pipeline time is not each source's observation time; refreshing this page does not refresh the underlying research.",
  };
}
