export type ScoreStatus = "saved" | "no_run" | "legacy_unavailable" | "invalid_snapshot" | "serialization_unavailable" | "ticker_unavailable";

export function scoreStatusLabel(status?: ScoreStatus): string {
  switch (status) {
    case "saved": return "Historical saved pipeline score";
    case "ticker_unavailable": return "Ticker was not saved in this run";
    case "no_run": return "No completed pipeline run";
    case "legacy_unavailable": return "Saved score unavailable for this older run";
    case "invalid_snapshot": return "Saved score unavailable: invalid snapshot";
    case "serialization_unavailable": return "Saved score unavailable: snapshot could not be stored";
    default: return "Saved score status unavailable";
  }
}

// Display only: preserve zero and negative values, never replace missing data with zero.
export function formatSavedScore(value: number | null | undefined, digits = 2, suffix = ""): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(digits)}${suffix}`
    : "Unavailable";
}
