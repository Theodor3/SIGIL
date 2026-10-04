/* Registry text is untrusted: render only with textContent. No dispatch actions. */
"use strict";
(() => {
  const list = document.getElementById("experiments-list");
  const status = document.getElementById("experiments-status");
  const refresh = document.getElementById("experiments-refresh");
  const node = (tag, cls, text) => {
    const el = document.createElement(tag);
    el.className = cls;
    el.textContent = text;
    return el;
  };
  function card(item) {
    const article = node("article", "experiment-card", "");
    article.append(node("p", "eyebrow", `${item.id} · ${item.ticker} · ${item.stage}`));
    article.append(node("h2", "experiment-title", item.title));
    article.append(node("p", "experiment-hypothesis", item.hypothesis));
    article.append(node("p", "experiment-meta", `Hypothesis ${item.hypothesisVersion} · Registered ${item.createdAt} · ${item.sourceSamples} source samples`));
    const checks = node("div", "experiment-checks", "");
    checks.append(node("span", "", item.originalPublicationTimesVerified ? "Publication timing verified" : "Publication timing unresolved"));
    checks.append(node("span", "", item.predictiveResultsAvailable ? "Predictive results recorded; review required" : "Predictive value untested"));
    checks.append(node("span", "", "Read-only notebook · No experiment dispatch"));
    article.append(checks, node("h3", "", "What we know so far"));
    const findings = node("ul", "experiment-findings", "");
    for (const finding of item.findings) {
      const row = node("li", "", "");
      row.append(node("span", "experiment-finding-label", `${finding.id} · ${finding.status.replaceAll("_", " ")}`), node("p", "", finding.summary));
      findings.append(row);
    }
    if (!item.findings.length) findings.append(node("li", "", "No findings recorded yet."));
    article.append(findings);
    const next = node("div", "experiment-next", "");
    next.append(node("h3", "", "Next useful step"), node("p", "", item.nextAction));
    article.append(next);
    return article;
  }
  let loading = false;
  async function activate() {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    status.textContent = "Loading saved experiments…";
    list.replaceChildren();
    try {
      const response = await fetch("/api/experiments", {cache: "no-store", signal: AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error("Unavailable");
      const data = await response.json();
      if (!Array.isArray(data.experiments)) throw new Error("Invalid registry");
      const cards = data.experiments.map(card);
      list.replaceChildren(...cards);
      status.textContent = cards.length ? "Saved research records. Findings are not proof of a profitable strategy." : "No experiments registered yet.";
    } catch {
      status.textContent = "The experiment notebook couldn’t be loaded. Try refreshing; saved records have not been changed.";
    } finally {
      loading = false;
      refresh.disabled = false;
    }
  }
  refresh.addEventListener("click", activate);
  window.sigilExperiments = {activate};
})();
