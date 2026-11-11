export type Study = {
  id: string; title: string; ticker: string; status: string; stage: string;
  hypothesis: string; createdAt: string; nextAction: string;
  sourceSamples: number; findings: {id: string; status: string; summary: string}[];
  predictiveResultsAvailable: boolean;
};

// Unknown states remain visible instead of being mistaken for success or failure.
export function studyStatus(status: string): string {
  const labels: Record<string, string> = {
    ready: "Ready for the next research step", in_progress: "Research in progress",
    resolved_single_case: "One case resolved", negative_result: "Negative finding",
    limited_weather_result: "Limited weather result", mixed_exploratory_result: "Mixed exploratory result",
    descriptive_result: "Descriptive finding", timing_blocked: "Blocked: publication timing",
    unconfirmed_lead: "Unconfirmed lead", blocked_duration_labels: "Blocked: missing duration labels",
    blocked_entity_and_revenue_labels: "Blocked: company and revenue labels",
    blocked_missing_labels: "Blocked: missing outcome labels",
  };
  return Object.prototype.hasOwnProperty.call(labels, status) ? labels[status] : status.replace(/_/g, " ");
}

export function selectStudies<T extends Study>(studies: T[], query: string, status: string, order: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return studies.filter(study => (status === "all" || study.status === status)
    && [study.id, study.title, study.ticker, study.hypothesis, study.nextAction, studyStatus(study.status)]
      .some(value => value.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => order === "title" ? a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
      : Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
}

export type StudyFilters = { query: string; status: string; order: "registered" | "title" };

export function readStudyFilters(params: URLSearchParams): StudyFilters {
  return {
    query: params.get("q") ?? "",
    status: params.get("status") || "all",
    order: params.get("sort") === "title" ? "title" : "registered",
  };
}

// Keep unrelated URL fields, and never mutate React Router's current params.
export function updateStudyFilters(params: URLSearchParams, changes: Partial<StudyFilters>): URLSearchParams {
  const next = new URLSearchParams(params);
  const fields = [["query", "q", ""], ["status", "status", "all"], ["order", "sort", "registered"]] as const;
  for (const [field, key, defaultValue] of fields) {
    const value = changes[field];
    if (value === undefined) continue;
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
  }
  return next;
}
