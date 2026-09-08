/* SIGIL local swarm. User and model text is always rendered as text, never HTML. */
"use strict";

const $ = (id) => document.getElementById(id);
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
const estimatedMoney = (value) => {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) return "—";
  const amount = Number(value);
  if (amount > 0 && amount < 0.0001) return "<$0.0001";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: amount > 0 && amount < 0.01 ? 4 : 2 }).format(amount);
};
const roleDescriptions = {
  coordinator: "Frames the mission, connects the specialists, and brings the evidence together.",
  "research-events": "Investigates corporate events, timing, and overlooked market hypotheses.",
  "research-frontier": "Explores unconventional signals and turns curiosity into testable ideas.",
  data: "Checks source quality, availability timing, and whether the data can support a claim.",
  quant: "Designs evaluation rules and looks for leakage, weak baselines, and misleading metrics.",
  engineering: "Proposes reproducible experiments and implementation steps for independent review.",
  review: "Challenges the evidence independently and identifies what would disprove a result.",
  "product-ops": "Keeps priorities, decisions, and useful outcomes connected to the product.",
};
const fallbackNames = { coordinator: "GPT coordinator", "research-events": "Events researcher", "research-frontier": "Frontier researcher", data: "Data specialist", quant: "Quant analyst", engineering: "Engineer", review: "Independent reviewer", "product-ops": "Product & operations", user: "You", system: "Workspace", all: "The team" };
const avatarColors = { "research-events": ["#ede6d4", "#9b8150"], "research-frontier": ["#e9e3f1", "#9784a7"], data: ["#e2ebf0", "#78949f"], quant: ["#e8edda", "#8b995f"], engineering: ["#ede7df", "#9d8976"], review: ["#f0e2dd", "#b28d7c"], "product-ops": ["#e3ebe5", "#7a9984"], user: ["#f1ebdc", "#9b8654"] };
const statuses = { ready: "Ready", running: "Working", stopping: "Stopping", stopped: "Stopped", needs_review: "Needs review", blocked: "Blocked", completed: "Research complete", done: "Research complete", queued: "Queued", assigned: "Assigned", pending: "Pending", idle: "Standing by", working: "Working", failed: "Failed", review: "In review", offline: "Needs connection", unverified: "First call unverified" };
const samplePrompt = "Design a careful first experiment for a novel trading signal. Have the team exchange evidence, identify data timing risks, and agree on a reproducible evaluation plan. Do not claim that a signal is profitable.";
const startupConnectionError = "The local workspace isn’t responding yet. Keep the server running; this page will reconnect automatically.";
let state = null;
let detail = null;
let selectedMissionId = null;
let selectedArtifact = null;
let currentView = "workspace";
let initialized = false;
let polling = false;
let pollTimer = null;
let selectedDetailSignature = "";
let toastTimer = null;
let lastError = "";
let busy = false;
let companyActionIntent = "mission";
let missionActionIntent = "none";
const signatures = new Map();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

function agent(id) {
  return state?.agents?.find((item) => item.id === id);
}

function agentName(id) {
  return agent(id)?.name || fallbackNames[id] || id || "Workspace";
}

function avatar(id, extraClass = "") {
  const item = agent(id);
  const initials = id === "coordinator" ? "✳" : item?.initials || (id === "user" ? "Y" : (fallbackNames[id] || id || "S").slice(0, 2).toUpperCase());
  const node = element("span", `agent-avatar ${id === "coordinator" ? "coordinator" : ""} ${extraClass}`, initials);
  const colors = avatarColors[id];
  if (colors) {
    node.style.setProperty("--avatar-bg", colors[0]);
    node.style.setProperty("--avatar-ink", colors[1]);
  }
  node.setAttribute("aria-hidden", "true");
  return node;
}

function statusPill(status) {
  const safeStatus = Object.hasOwn(statuses, status) ? status : "ready";
  return element("span", `status-pill ${safeStatus}`, statuses[status] || "Unknown status");
}

function formatDate(value, timeOnly = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, timeOnly ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDateOnly(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function readable(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function providerName(value) {
  return String(value || "").toLowerCase() === "openai" ? "OpenAI" : String(value || "").toLowerCase() === "gemini" ? "Gemini" : readable(value) || "Provider";
}

function updateGroup(id, signature, nodes) {
  if (signatures.get(id) === signature) return;
  signatures.set(id, signature);
  const root = $(id);
  const focused = root.contains(document.activeElement) ? document.activeElement?.dataset?.focuskey : null;
  root.replaceChildren(...nodes);
  if (focused) {
    const match = [...root.querySelectorAll("[data-focuskey]")].find((node) => node.dataset.focuskey === focused);
    match?.focus({ preventScroll: true });
  }
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...options, signal: controller.signal, headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The local workspace took too long to respond. Check its status before retrying; your request may have been received.");
    throw error;
  } finally { clearTimeout(timeout); }
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    let message = typeof payload?.detail === "string" ? payload.detail : `The workspace returned an error (${response.status}). Please try again.`;
    if (Array.isArray(payload?.detail)) message = "Please check the form and try again. One or more values were not accepted.";
    throw new Error(message);
  }
  return payload;
}

function post(path, body = {}) {
  return api(path, { method: "POST", body: JSON.stringify(body) });
}

function showError(error, targetId = "global-error") {
  const message = error instanceof Error ? error.message : String(error);
  lastError = message;
  if (targetId === "global-error") $("error-text").textContent = message;
  else $(targetId).textContent = message;
  $(targetId).hidden = false;
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 4000);
}

function currentMission() {
  return detail?.mission?.id === selectedMissionId ? detail.mission : state?.missions?.find((mission) => mission.id === selectedMissionId) || null;
}

function isRunning(mission = currentMission()) {
  return mission && ["running", "stopping"].includes(mission.status);
}

function liveAvailable() {
  if (typeof state?.runtime?.can_start_live === "boolean") return state.runtime.can_start_live;
  return Boolean(state?.backend?.live_available && state?.providers?.gemini?.configured && state?.providers?.openai?.configured);
}

function firstRuntimeIssue() {
  return state?.runtime?.blockers?.[0] || null;
}

function intentForRuntimeAction(action, code = "") {
  const value = `${action || ""} ${code || ""}`.toLowerCase();
  if (/connect|credential|provider|api.?key|missing.?key/.test(value)) return "connections";
  if (/restart|studio|source/.test(value)) return "studio";
  if (/call|cost|budget|uncertain|reconcil|pilot/.test(value)) return "calls";
  if (/review|evidence|attention/.test(value)) return "review";
  if (/running|active|open.?mission/.test(value)) return "active";
  if (/start|mission|ready/.test(value)) return "mission";
  return "status";
}

function missionAtAttention() {
  return (state?.missions || []).find((mission) => mission.status === "needs_review") || (state?.missions || []).find((mission) => mission.status === "blocked") || null;
}

function renderBudget() {
  const budget = state?.budget || {};
  const limit = Number(budget.daily_limit_usd) || 1;
  const used = Number(budget.today_usd) || 0;
  const reserved = Number(budget.reserved_usd) || 0;
  const usedPercent = Math.max(0, Math.min(100, (used / limit) * 100));
  const reservedPercent = Math.max(0, Math.min(100 - usedPercent, (reserved / limit) * 100));
  $("budget-total").textContent = money(limit);
  $("budget-spent").textContent = money(used);
  $("budget-used-bar").style.width = `${usedPercent}%`;
  $("budget-reserved-bar").style.width = `${reservedPercent}%`;
  const meter = document.querySelector(".budget-meter");
  meter.setAttribute("aria-valuenow", String(Math.round(usedPercent + reservedPercent)));
  meter.setAttribute("aria-valuetext", `Estimated ${money(used)} spent and ${money(reserved)} reserved of ${money(limit)}`);
  $("budget-detail").textContent = `${money(budget.remaining_today_usd)} available · ${money(reserved)} reserved`;
  $("pilot-budget").textContent = `${money(budget.pilot_usd)} / ${money(budget.pilot_limit_usd || 7)}`;
  const expiration = formatDateOnly(budget.expires_on);
  $("pilot-expiration").textContent = expiration ? `Pilot estimate / limit · closes ${expiration}` : "Pilot estimate / limit";
  const budgetConcern = budget.expired ? "The pilot window has closed. API research is paused." : budget.uncertain ? "A provider call has an uncertain final cost. Review the call ledger before more API research." : "";
  $("budget-alert").textContent = budgetConcern;
  $("budget-alert").hidden = !budgetConcern;
  $("mobile-budget").textContent = `Est. ${money(used)} / ${money(limit)} today`;
  for (const provider of ["gemini", "openai"]) {
    $(`${provider}-spent-today`).textContent = estimatedMoney(budget.by_provider?.[provider]?.today_usd);
    $(`${provider}-spent-pilot`).textContent = estimatedMoney(budget.by_provider?.[provider]?.pilot_usd);
  }
}

function renderProviders() {
  const providers = state?.providers || {};
  const configured = Object.values(providers).filter((provider) => provider.configured).length;
  const verified = Object.values(providers).filter((provider) => provider.verified).length;
  $("connection-summary").textContent = configured === 2 ? verified === 2 ? "Both providers verified" : "Both keys ready for a first call" : configured === 1 ? "One provider needs a key" : "Add keys to use API research";
  $("mobile-connection-status").textContent = configured === 2 ? verified === 2 ? "Providers verified" : "Keys ready · first call verifies" : configured === 1 ? "One key needed" : "Connect keys";
  $("connection-indicator").classList.toggle("connected", configured === 2);
  for (const id of ["gemini", "openai"]) {
    const provider = providers[id] || {};
    const label = $(`${id}-connection-status`);
    label.textContent = provider.verified ? "Access verified" : provider.configured ? "Configured · unverified" : "Not connected";
    label.className = `pill ${provider.verified ? "verified" : "neutral"}`;
    $(`${id}-model`).textContent = provider.model ? `Configured model: ${provider.model}` : "Model has not been configured.";
    document.querySelector(`[data-provider="${id}"]`).hidden = !provider.configured;
    $(`${id}-key`).placeholder = provider.configured ? "Enter a key only to replace it" : "Paste key for this session";
  }
  $("live-mode-input").disabled = !liveAvailable();
  $("mission-connect").hidden = liveAvailable();
  $("mission-connect").textContent = configured < 2 ? "Connect providers" : "Review what needs attention";
  $("mission-connect").dataset.intent = configured < 2 ? "connections" : "company";
  if (!liveAvailable() && $("live-mode-input").checked) document.querySelector('input[name="mission-mode"][value="demo"]').checked = true;
  renderModeNote();
}

function renderCompanyStatus() {
  const runtime = state?.runtime || {};
  const issue = runtime.blockers?.[0] || null;
  const warning = runtime.warnings?.[0] || null;
  const attention = Number(runtime.attention_count || 0);
  const reviewCount = Number(runtime.review_count || 0);
  const running = (state?.missions || []).some((mission) => isRunning(mission));
  const configured = ["gemini", "openai"].filter((id) => state?.providers?.[id]?.configured).length;
  const rawStatus = String(runtime.status || "").toLowerCase();
  let tone = "attention";
  if (running || rawStatus === "running" || rawStatus === "working") tone = "running";
  else if (rawStatus === "ready" || (!issue && liveAvailable())) tone = "ready";
  else if (/offline|connect|credential/.test(rawStatus) || configured < 2) tone = "offline";
  else if (/block|pause|expired|budget|pilot|restart/.test(rawStatus)) tone = "blocked";
  const title = runtime.label || (running ? "Your company is working" : liveAvailable() ? "Your company is ready" : configured < 2 ? "Reconnect to start API research" : "Your company needs attention");
  let description = issue?.message || warning?.message || "The team is ready for a focused research mission. A first provider call may verify access before work continues.";
  if (running && !issue) description = "The coordinator is supervising the active mission and will surface evidence or a decision when it needs you.";
  $("company-status-title").textContent = title;
  $("company-status-detail").textContent = description;
  const statusCard = $("company-status");
  statusCard.className = `company-status ${tone}`;
  $("company-status-kicker").textContent = attention ? `COMPANY STATUS · ${attention} NEED${attention === 1 ? "" : "S"} ATTENTION` : "COMPANY STATUS";
  const cadence = Number(runtime.cadence_minutes || 60);
  $("company-cadence").textContent = runtime.scheduler_enabled === false ? "Supervised runs are paused" : `Supervised every ${cadence === 60 ? "hour" : `${cadence} minutes`}`;
  $("company-last-run").textContent = runtime.last_mission_at ? `Last mission ${formatDate(runtime.last_mission_at)}` : "No mission activity yet";
  $("company-key-policy").textContent = runtime.credentials_persist ? "Provider keys available" : "Keys reset with the local server";

  if (issue) companyActionIntent = intentForRuntimeAction(issue.action, issue.code);
  else if (reviewCount || attention) companyActionIntent = "review";
  else if (running) companyActionIntent = "active";
  else companyActionIntent = liveAvailable() ? "mission" : configured < 2 ? "connections" : "status";
  const labels = { connections: "Reconnect keys", studio: "Review Studio", review: "Open review", calls: "Review calls", active: "Open active mission", mission: "Start a mission", status: "Open status" };
  const action = $("company-action");
  action.textContent = labels[companyActionIntent] || "Open status";
  action.hidden = false;
  $("mobile-company-status").textContent = attention ? `${title} · ${attention} waiting` : title;
}

function renderModeNote() {
  const live = $("live-mode-input").checked;
  $("mission-mode-note").textContent = live ? "Real provider calls count toward the $1 daily and $7 pilot limits. Research, draft edits, and available studio checks; no trading or automatic merging." : "Sample mode shows the workflow with clearly labeled example responses. It does not research your prompt or call a model.";
}

function selectAgent(id) {
  switchView("workspace");
  if (!selectedMissionId) {
    openMissionDialog();
    toast("Start a mission first; then you can message any specialist.");
    return;
  }
  $("recipient-select").value = id;
  $("message-input").focus();
}

function renderAgents() {
  const agents = state?.agents || [];
  const signature = JSON.stringify(agents);
  if (signatures.get("team-preview") === signature) return;
  const previewNodes = [];
  const directoryNodes = [];
  for (const item of agents) {
    const row = element("button", "agent-row");
    row.type = "button";
    row.dataset.focuskey = `preview-${item.id}`;
    row.setAttribute("aria-label", `Message ${item.name}`);
    row.addEventListener("click", () => selectAgent(item.id));
    const name = element("div", "agent-row-name", item.name);
    const provider = providerName(item.provider);
    name.append(element("div", "agent-row-role", `${provider} · ${statuses[item.status] || "Standing by"}`));
    const indicator = element("span", `agent-indicator ${["running", "working", "blocked", "offline", "unverified"].includes(item.status) ? item.status : ""}`);
    indicator.title = statuses[item.status] || "Standing by";
    row.append(avatar(item.id), name, indicator);
    previewNodes.push(row);
    const card = element("button", `team-card ${item.id === "coordinator" ? "coordinator" : ""}`);
    card.type = "button";
    card.dataset.focuskey = `team-${item.id}`;
    card.addEventListener("click", () => selectAgent(item.id));
    const top = element("div", "team-card-top");
    top.append(avatar(item.id), element("span", "pill neutral", item.id === "coordinator" ? "COORDINATOR" : "SPECIALIST"));
    const footer = element("div", "team-card-footer");
    footer.append(element("span", "", `${provider} · ${statuses[item.status] || "Standing by"}`), icon("arrow"));
    card.append(top, element("h3", "", item.name), element("p", "", roleDescriptions[item.id] || item.role), footer);
    directoryNodes.push(card);
  }
  updateGroup("team-preview", signature, previewNodes);
  updateGroup("team-directory", signature, directoryNodes);
  const optionSignature = JSON.stringify(agents.map(({ id, name }) => [id, name]));
  if (signatures.get("recipient-select") !== optionSignature) {
    const value = $("recipient-select").value;
    const options = agents.map((item) => { const option = element("option", "", item.name); option.value = item.id; return option; });
    $("recipient-select").replaceChildren(...options);
    $("recipient-select").value = agents.some((item) => item.id === value) ? value : "coordinator";
    signatures.set("recipient-select", optionSignature);
  }
}

function emptyCard(title, description, actionLabel, action) {
  const node = element("div", "empty-card");
  node.append(icon("stack"), element("h3", "", title), element("p", "", description));
  if (actionLabel) {
    const button = element("button", "button secondary", actionLabel);
    button.type = "button";
    button.addEventListener("click", action);
    node.append(button);
  }
  return node;
}

function renderMissions() {
  const missions = [...(state?.missions || [])].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  $("nav-mission-count").textContent = String(missions.length);
  const signature = JSON.stringify(missions);
  if (signatures.get("missions-list") === signature) return;
  const nodes = missions.map((mission) => {
    const button = element("button", "mission-list-item");
    button.type = "button";
    button.dataset.focuskey = `mission-${mission.id}`;
    button.addEventListener("click", () => chooseMission(mission.id));
    const graphic = element("span", "mission-list-icon");
    graphic.append(icon("stack"));
    const content = element("div", "mission-list-content");
    content.append(element("h3", "", mission.title || "Untitled mission"), element("p", "", `${formatDate(mission.updated_at)} · Round ${mission.round || 0} of ${mission.max_rounds || 5} · ${mission.mode === "demo" ? "No API spending" : `${estimatedMoney(mission.spent_usd)} estimated model cost`}`));
    const meta = element("div", "mission-list-meta");
    meta.append(element("span", `pill ${mission.mode === "demo" ? "sample" : "live"}`, mission.mode === "demo" ? "Sample" : "API"), statusPill(mission.status), icon("arrow"));
    button.append(graphic, content, meta);
    return button;
  });
  if (!nodes.length) nodes.push(emptyCard("Your first mission is still unwritten.", "Start with a question, or take a free guided tour of the workflow.", "Try a sample mission", () => startSample()));
  updateGroup("missions-list", signature, nodes);
}

function renderMissionHeader() {
  const mission = currentMission();
  const hasMission = Boolean(mission);
  const roundLimit = hasMission && Number(mission.round || 0) >= Number(mission.max_rounds || 5);
  $("conversation-heading").textContent = mission?.title || "Give good ideas a place to grow.";
  $("mission-eyebrow").textContent = hasMission ? "THE SHARED CONVERSATION" : "YOUR NEXT QUESTION STARTS HERE";
  $("mission-mode").textContent = mission?.mode === "live" ? "API research" : "Sample mode";
  $("mission-mode").className = `pill ${mission?.mode === "live" ? "live" : "sample"}`;
  $("sample-banner").hidden = mission?.mode === "live";
  $("mission-toolbar").hidden = !hasMission;
  const canCompose = hasMission && !busy && !roundLimit;
  $("message-input").disabled = !canCompose;
  $("recipient-select").disabled = !canCompose;
  $("send-message").disabled = !canCompose || !$("message-input").value.trim();
  $("message-input").placeholder = !hasMission ? "Start a mission to talk with your team…" : roundLimit ? "This mission reached its round limit. Start a focused follow-up to continue." : "Ask a question, challenge a finding, or steer the next step…";
  $("composer-note").textContent = roundLimit ? "This research cycle is closed. Start a focused follow-up to keep the next question narrow and auditable." : mission?.mode === "demo" ? "Sample replies are scripted. Your messages are saved, but no model reads them." : hasMission ? "Messages are shared with the selected role. Only relevant context is passed to other workers." : "Your team works in a separate research workspace.";
  if (mission) {
    $("mission-status").textContent = statuses[mission.status] || "Unknown status";
    $("mission-status").className = `status-pill ${Object.hasOwn(statuses, mission.status) ? mission.status : "ready"}`;
    $("mission-round").textContent = `Round ${mission.round || 0} of ${mission.max_rounds || 5}`;
    $("mission-cost").textContent = `Est. ${estimatedMoney(mission.spent_usd)}`;
    $("stop-mission").hidden = !isRunning(mission);
    $("stop-mission").disabled = busy || mission.status === "stopping";
    $("resume-mission").hidden = isRunning(mission) || ["completed", "needs_review", "blocked"].includes(mission.status) || roundLimit;
    $("resume-mission").disabled = busy || (mission.mode === "live" && !liveAvailable());
    $("export-mission").href = `/api/missions/${encodeURIComponent(mission.id)}/export`;
    $("export-mission").setAttribute("download", "");
  }
  $("mission-summary").hidden = !mission?.summary;
  $("mission-summary-text").textContent = mission?.summary || "";
  renderMissionGuidance(mission, roundLimit);
}

function renderMissionGuidance(mission, roundLimit = false) {
  const panel = $("mission-guidance");
  if (!mission) {
    panel.hidden = true;
    missionActionIntent = "none";
    return;
  }
  const action = String(mission.required_action || "").toLowerCase();
  const combined = `${action} ${mission.status_reason || ""}`.toLowerCase();
  let label = "NEXT STEP";
  const rawReason = String(mission.status_reason || "");
  let text = rawReason.length > 280 ? `${rawReason.slice(0, 277)}…` : rawReason;
  let button = "";
  missionActionIntent = "none";

  if (roundLimit || /new.?mission|follow.?up/.test(combined)) {
    label = "RESEARCH CYCLE COMPLETE";
    text = mission.status_reason || "This mission reached its round limit. Carry the strongest unresolved question into a focused follow-up.";
    button = "Start focused follow-up";
    missionActionIntent = "followup";
  } else if (mission.status === "needs_review") {
    label = "YOUR REVIEW IS NEEDED";
    text = text || "The team has finished this research pass. Review the evidence before deciding what to test next.";
    button = "Review evidence";
    missionActionIntent = "evidence";
  } else if (mission.status === "completed") {
    label = "RESEARCH COMPLETE";
    text = text || "The team completed this research pass. Review its evidence before using it to choose another experiment.";
    button = "Review evidence";
    missionActionIntent = "evidence";
  } else if (mission.status === "blocked") {
    label = "MISSION BLOCKED";
    text = text || "The team cannot safely continue until this issue is resolved.";
    if (/connect|credential|provider|api.?key/.test(combined)) {
      button = "Reconnect keys";
      missionActionIntent = "connections";
    } else if (/call|cost|budget|uncertain|reconcil|pilot/.test(combined)) {
      button = "Review API calls";
      missionActionIntent = "calls";
    } else if (mission.retryable && (mission.mode !== "live" || liveAvailable())) {
      button = "Retry mission";
      missionActionIntent = "retry";
    } else {
      button = "Review evidence";
      missionActionIntent = "evidence";
    }
  } else if (mission.mode === "live" && !liveAvailable() && !isRunning(mission) && mission.status !== "completed") {
    label = "API RESEARCH PAUSED";
    text = firstRuntimeIssue()?.message || "Resolve the company status before continuing this API mission.";
    button = intentForRuntimeAction(firstRuntimeIssue()?.action, firstRuntimeIssue()?.code) === "connections" ? "Reconnect keys" : "Open company status";
    missionActionIntent = button === "Reconnect keys" ? "connections" : "company";
  }

  panel.hidden = missionActionIntent === "none";
  $("mission-guidance-label").textContent = label;
  $("mission-guidance-text").textContent = text;
  $("mission-action").textContent = button;
  $("mission-action").disabled = busy;
}

function renderMessages() {
  const mission = currentMission();
  if (!mission) return;
  const messages = detail?.mission?.id === selectedMissionId ? detail.messages || [] : [];
  const signature = JSON.stringify([mission.id, messages, mission.status]);
  if (signatures.get("message-feed") === signature) return;
  const feed = $("message-feed");
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 100;
  const previousTop = feed.scrollTop;
  const switching = feed.dataset.mission !== mission.id;
  feed.dataset.mission = mission.id;
  const nodes = messages.map((message) => {
    const node = element("article", `message ${message.sender === "user" ? "user" : ""}`);
    node.dataset.messageId = message.id;
    const header = element("div", "message-header");
    const author = element("div", "message-author", agentName(message.sender));
    if (message.recipient) author.append(element("span", "message-routing", `→ ${agentName(message.recipient)}`));
    if (message.kind && !["message", "user_message", "response"].includes(message.kind)) author.append(element("span", "message-kind", String(message.kind).replaceAll("_", " ")));
    if (message.mode === "demo" || mission.mode === "demo") author.append(element("span", "message-sample-label", "SAMPLE"));
    const date = element("time", "message-time", formatDate(message.created_at, true));
    if (message.created_at) date.dateTime = message.created_at;
    header.append(avatar(message.sender), author, date);
    node.append(header, element("div", "message-text", message.text));
    return node;
  });
  if (!nodes.length && !isRunning(mission)) nodes.push(element("p", "feed-empty", "The mission is ready. Start the run to see your team’s conversation."));
  if (isRunning(mission)) {
    const pending = element("div", "message-pending");
    pending.setAttribute("role", "status");
    const dots = element("div", "in-progress-row");
    for (let i = 0; i < 3; i += 1) dots.append(element("span", "typing-dot"));
    pending.append(dots, element("span", "", mission.status === "stopping" ? "Finishing the current step and stopping…" : mission.mode === "demo" ? "Walking through the sample…" : "The team is working…"));
    nodes.push(pending);
  }
  updateGroup("message-feed", signature, nodes);
  if (switching || atBottom) feed.scrollTop = feed.scrollHeight;
  else feed.scrollTop = previousTop;
}

function artifactVerification(value) {
  if (!value) return "Unverified";
  if (typeof value === "string") return value.replaceAll("_", " ");
  return "Review required";
}

function artifactProvenance(value) {
  if (value === "source_linked") return "Source linked";
  if (value === "invalid") return "Evidence link rejected";
  return "No Studio claim links";
}

function renderEvidence() {
  const artifacts = detail?.mission?.id === selectedMissionId ? detail.artifacts || [] : [];
  const signature = JSON.stringify([selectedMissionId, artifacts]);
  $("artifact-count").textContent = String(artifacts.length);
  $("evidence-subtitle").textContent = currentMission() ? `Artifacts from “${currentMission().title}”. Inspect the claims, their status, and their sources.` : "Choose a mission to inspect its findings and sources.";
  if (signatures.get("artifact-preview") === signature) return;
  const previewNodes = artifacts.slice(-4).reverse().map((artifact) => {
    const button = element("button", "artifact-preview-item");
    button.type = "button";
    button.dataset.focuskey = `preview-artifact-${artifact.id}`;
    button.addEventListener("click", () => openArtifact(artifact));
    const content = element("div");
    content.append(element("strong", "", artifact.title), element("small", "", artifactVerification(artifact.verification)));
    button.append(icon("file"), content);
    return button;
  });
  if (!previewNodes.length) {
    const empty = element("div", "compact-empty");
    const text = element("p", "", "Findings will land here.");
    text.append(element("span", "", "Sources, decisions, and work worth keeping."));
    empty.append(icon("file"), text);
    previewNodes.push(empty);
  }
  const evidenceNodes = [...artifacts].reverse().map((artifact) => {
    const button = element("button", "evidence-card");
    button.type = "button";
    button.dataset.focuskey = `artifact-${artifact.id}`;
    button.addEventListener("click", () => openArtifact(artifact));
    const top = element("div", "evidence-card-top");
    top.append(icon("file"), element("span", "pill neutral", artifactVerification(artifact.verification)), element("span", "pill neutral", artifactProvenance(artifact.provenance_status)));
    const body = String(artifact.body || "");
    button.append(top, element("h3", "", artifact.title), element("p", "", body.length > 180 ? `${body.slice(0, 180)}…` : body), element("small", "", `${agentName(artifact.author)} · ${formatDate(artifact.created_at)} · ${(artifact.studio_claims || []).length} linked claims · ${(artifact.sources || []).length} web sources`));
    return button;
  });
  if (!evidenceNodes.length) evidenceNodes.push(emptyCard("A place for the proof.", selectedMissionId ? "The team hasn’t published an artifact for this mission yet." : "Choose a mission to see its artifacts and sources.", "Back to workspace", () => switchView("workspace")));
  updateGroup("artifact-preview", signature, previewNodes);
  updateGroup("evidence-list", signature, evidenceNodes);
}

function renderTasks() {
  const tasks = detail?.mission?.id === selectedMissionId ? detail.tasks || [] : [];
  const signature = JSON.stringify([selectedMissionId, tasks]);
  $("task-count").textContent = String(tasks.length);
  if (signatures.get("task-preview") === signature) return;
  const nodes = tasks.slice(-6).map((task) => {
    const node = element("div", `task-item ${["completed", "done"].includes(task.status) ? "completed" : ""}`);
    const content = element("div");
    content.append(element("strong", "", task.title), element("small", "", `${agentName(task.agent_id)} · ${statuses[task.status] || task.status}`));
    node.append(element("span", "task-check", ["completed", "done"].includes(task.status) ? "✓" : ""), content);
    return node;
  });
  if (!nodes.length) nodes.push(element("p", "subtle-empty", "No tasks assigned yet."));
  updateGroup("task-preview", signature, nodes);
}

function callStatusPill(status) {
  const value = String(status || "unknown").toLowerCase();
  const safe = ["completed", "failed", "running", "reserved", "pending", "cancelled", "uncertain"].includes(value) ? value : "unknown";
  return element("span", `call-status ${safe}`, readable(value));
}

function callErrorText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value?.message === "string") return value.message;
  return "The provider returned an error. Open the company status before retrying.";
}

function renderCallLedger() {
  const calls = detail?.mission?.id === selectedMissionId ? detail.calls || [] : [];
  const budget = state?.budget || {};
  const signature = JSON.stringify([selectedMissionId, calls, budget.uncertain, budget.expired, budget.expires_on]);
  const total = calls.reduce((sum, call) => sum + (Number(call.cost_usd) || 0), 0);
  const reserved = calls.reduce((sum, call) => ["reserved", "uncertain"].includes(call.status) ? sum + (Number(call.reservation_usd) || 0) : sum, 0);
  $("call-ledger-note").textContent = calls.length ? `${calls.length} provider call${calls.length === 1 ? "" : "s"} · ${estimatedMoney(total)} estimated${reserved ? ` · ${estimatedMoney(reserved)} reserved` : ""}` : currentMission() ? "No model calls in this mission." : "Choose a mission to inspect its model calls.";
  $("open-call-ledger").disabled = !currentMission();

  const previewNodes = [...calls].slice(-3).reverse().map((call) => {
    const row = element("div", "call-preview-item");
    const content = element("div", "call-preview-copy");
    content.append(element("strong", "", `${providerName(call.provider)} · ${agentName(call.agent_id)}`), element("small", "", call.model || "Model not reported"));
    const meta = element("div", "call-preview-meta");
    meta.append(callStatusPill(call.status), element("span", "call-cost", estimatedMoney(call.cost_usd)));
    row.append(content, meta);
    return row;
  });
  if (!previewNodes.length) previewNodes.push(element("p", "subtle-empty", "Costs and call outcomes will appear here."));
  updateGroup("call-preview", signature, previewNodes);

  const ledgerNodes = [...calls].reverse().map((call) => {
    const card = element("article", "call-ledger-row");
    const head = element("div", "call-ledger-row-head");
    const title = element("div");
    title.append(element("strong", "", `${providerName(call.provider)} · ${agentName(call.agent_id)}`), element("small", "", formatDate(call.created_at) || "Time not reported"));
    head.append(title, callStatusPill(call.status));
    const facts = element("dl", "call-facts");
    const entries = [
      ["Requested model", call.model || "Not reported"],
      ["Returned model", call.returned_model || "Not reported"],
      ["Estimated cost", estimatedMoney(call.cost_usd)],
      [["reserved", "uncertain"].includes(call.status) ? "Held reservation" : "Initial reservation", estimatedMoney(call.reservation_usd)],
    ];
    for (const [term, value] of entries) {
      facts.append(element("dt", "", term), element("dd", "", value));
    }
    if (call.usage && typeof call.usage === "object") {
      const inputTokens = Number(call.usage.input_tokens ?? call.usage.prompt_tokens);
      const outputTokens = Number(call.usage.output_tokens ?? call.usage.completion_tokens);
      if (Number.isFinite(inputTokens) || Number.isFinite(outputTokens)) {
        facts.append(element("dt", "", "Reported usage"), element("dd", "", `${Number.isFinite(inputTokens) ? inputTokens.toLocaleString() : "—"} in · ${Number.isFinite(outputTokens) ? outputTokens.toLocaleString() : "—"} out`));
      }
    }
    card.append(head, facts);
    const callError = callErrorText(call.error);
    if (callError) card.append(element("p", "call-error", callError));
    return card;
  });
  if (!ledgerNodes.length) ledgerNodes.push(emptyCard("No API calls for this mission.", "Sample missions never call a provider. Live calls will show their model, status, reservation, estimated cost, and any error here."));
  updateGroup("call-ledger-list", signature, ledgerNodes);
  $("call-ledger-total").textContent = `Estimated total: ${estimatedMoney(total)}${reserved ? ` · ${estimatedMoney(reserved)} reserved` : ""}`;
  const expiration = formatDateOnly(budget.expires_on);
  $("call-ledger-description").textContent = expiration ? `Provider amounts are estimates. The $7 pilot window closes ${expiration} (${budget.timezone || "America/New_York"}).` : "Provider amounts are estimates and may change when usage is reconciled.";
  const warning = budget.expired ? "The pilot window has closed. API research is paused." : budget.uncertain ? "At least one provider call has an uncertain final cost. Review its status before continuing paid work." : "";
  $("call-ledger-warning").textContent = warning;
  $("call-ledger-warning").hidden = !warning;
}

function render() {
  renderBudget();
  renderProviders();
  renderCompanyStatus();
  renderAgents();
  renderMissions();
  renderMissionHeader();
  renderMessages();
  renderEvidence();
  renderTasks();
  renderCallLedger();
  window.sigilStudio?.render();
}

async function refresh() {
  if (polling || document.hidden) return;
  polling = true;
  try {
    const nextState = await api("/api/state");
    state = nextState;
    if (!initialized) {
      selectedMissionId = state.active_mission_id || state.missions?.[0]?.id || null;
      initialized = true;
    }
    render();
    if (selectedMissionId) {
      const requestedId = selectedMissionId;
      const nextDetail = await api(`/api/missions/${encodeURIComponent(requestedId)}`);
      if (requestedId === selectedMissionId) {
        const nextSignature = JSON.stringify(nextDetail);
        if (nextSignature !== selectedDetailSignature) {
          detail = nextDetail;
          selectedDetailSignature = nextSignature;
          render();
        }
      }
    }
    $("server-status").textContent = "Workspace connected";
    document.querySelector(".sidebar-footer .presence-dot").style.background = "#b0c584";
    if ($("error-text").textContent === startupConnectionError) $("global-error").hidden = true;
  } catch (error) {
    $("server-status").textContent = "Connection interrupted · retrying";
    document.querySelector(".sidebar-footer .presence-dot").style.background = "#ca9a60";
    if (!initialized) showError(new Error(startupConnectionError));
  } finally {
    polling = false;
  }
}

function schedulePoll(immediate = false) {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = setTimeout(async () => {
    await refresh();
    schedulePoll();
  }, immediate ? 0 : 2000);
}

function switchView(view) {
  if (!["workspace", "missions", "evidence", "team", "studio"].includes(view)) return;
  currentView = view;
  for (const name of ["workspace", "missions", "evidence", "team", "studio"]) $(`view-${name}`).hidden = name !== view;
  for (const button of document.querySelectorAll(".nav-item")) {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  const titles = { workspace: "Swarm workspace", missions: "Mission control", evidence: "Shared evidence", team: "Meet the team", studio: "Development studio" };
  const subtitles = { workspace: "One place to think, collaborate, and turn ideas into evidence.", missions: "The questions, handoffs, and decisions that move the work forward.", evidence: "Keep the claims inspectable and the sources close.", team: "Seven Gemini specialists, connected by one GPT coordinator.", studio: "Pinned source, draft changes, and a clear record of the work." };
  $("view-title").replaceChildren(document.createTextNode(titles[view]), element("span", "heading-dot", "."));
  $("view-subtitle").textContent = subtitles[view];
  if (view === "studio") window.sigilStudio?.activate();
}

async function chooseMission(id, nextView = "workspace") {
  if (busy) return;
  if (selectedMissionId !== id && $("message-input").value.trim()) {
    toast("Your unsent draft stays in the composer. Check the recipient before sending.");
  }
  selectedMissionId = id;
  detail = null;
  selectedDetailSignature = "";
  signatures.delete("message-feed");
  switchView(nextView);
  render();
  try {
    const nextDetail = await api(`/api/missions/${encodeURIComponent(id)}`);
    if (selectedMissionId === id) {
      detail = nextDetail;
      selectedDetailSignature = JSON.stringify(nextDetail);
      render();
    }
  } catch (error) { showError(error); }
}

function openMissionDialog(prefill = "") {
  $("new-mission-error").hidden = true;
  renderProviders();
  if (prefill) $("new-mission-input").value = prefill;
  $("mission-dialog").showModal();
  $("new-mission-input").focus();
}

function openConnections() {
  if ($("mission-dialog").open) $("mission-dialog").close();
  $("connections-error").hidden = true;
  $("connections-success").hidden = true;
  renderProviders();
  $("connections-dialog").showModal();
  (!state?.providers?.gemini?.configured ? $("gemini-key") : $("openai-key")).focus();
}

function openCallLedger() {
  if (!currentMission()) {
    switchView("missions");
    toast("Choose a mission to inspect its API calls.");
    return;
  }
  renderCallLedger();
  $("call-ledger-dialog").showModal();
  $("call-ledger-dialog").querySelector("[data-close]")?.focus();
}

function focusedFollowupPrompt(mission) {
  const unresolved = String(mission?.status_reason || mission?.summary || "the strongest unresolved question").slice(0, 1200);
  return `Focused follow-up to “${mission?.title || "the previous mission"}”:\n\nInvestigate one decision-ready next step from this prior finding: ${unresolved}\n\nState the hypothesis, evidence needed, data-timing risks, falsification test, and a clear stop condition.`;
}

function startFocusedFollowup() {
  const mission = currentMission();
  if (!mission) return;
  openMissionDialog(focusedFollowupPrompt(mission));
  const preferred = mission.mode === "live" && liveAvailable() ? "live" : "demo";
  document.querySelector(`input[name="mission-mode"][value="${preferred}"]`).checked = true;
  renderModeNote();
  if (mission.mode === "live" && !liveAvailable()) {
    showError("The follow-up is ready. Resolve the company status before choosing API research, or run it as a free sample.", "new-mission-error");
  }
}

function reviewAttentionMission() {
  const mission = missionAtAttention();
  if (!mission) {
    switchView("missions");
    return;
  }
  chooseMission(mission.id, mission.status === "needs_review" ? "evidence" : "workspace");
}

function performCompanyAction() {
  if (companyActionIntent === "connections") openConnections();
  else if (companyActionIntent === "studio") switchView("studio");
  else if (companyActionIntent === "review") reviewAttentionMission();
  else if (companyActionIntent === "calls") openCallLedger();
  else if (companyActionIntent === "active") {
    const mission = (state?.missions || []).find((item) => isRunning(item)) || (state?.missions || []).find((item) => item.id === state?.active_mission_id);
    if (mission) chooseMission(mission.id);
    else switchView("missions");
  } else if (companyActionIntent === "mission") openMissionDialog();
  else {
    const issue = firstRuntimeIssue();
    if (issue && intentForRuntimeAction(issue.action, issue.code) === "connections") openConnections();
    else switchView("missions");
  }
}

async function retryCurrentMission() {
  const mission = currentMission();
  if (!mission || busy) return;
  if (mission.mode === "live" && !liveAvailable()) {
    performCompanyAction();
    return;
  }
  busy = true;
  renderMissionHeader();
  try {
    const updated = await post(`/api/missions/${encodeURIComponent(mission.id)}/run`);
    if (detail?.mission?.id === mission.id) detail.mission = updated;
    render();
    await refresh();
  } catch (error) { showError(error); }
  finally { busy = false; renderMissionHeader(); }
}

function performMissionAction() {
  if (missionActionIntent === "followup") startFocusedFollowup();
  else if (missionActionIntent === "evidence") switchView("evidence");
  else if (missionActionIntent === "connections") openConnections();
  else if (missionActionIntent === "calls") openCallLedger();
  else if (missionActionIntent === "retry") retryCurrentMission();
  else if (missionActionIntent === "company") performCompanyAction();
}

async function createAndRun(prompt, mode) {
  const mission = await post("/api/missions", { prompt, mode });
  selectedMissionId = mission.id;
  detail = { mission, messages: [], tasks: [], artifacts: [], calls: [] };
  selectedDetailSignature = "";
  if (state) state.missions = [mission, ...(state.missions || []).filter((item) => item.id !== mission.id)];
  switchView("workspace");
  render();
  try {
    const updated = await post(`/api/missions/${encodeURIComponent(mission.id)}/run`);
    detail.mission = updated;
  } catch (error) {
    const savedError = new Error(`Your mission was saved, but could not start. ${error.message}`);
    savedError.missionCreated = true;
    throw savedError;
  }
  render();
  await refresh();
  return mission;
}

async function startSample() {
  if (busy) return;
  busy = true;
  $("try-sample").disabled = true;
  try {
    await createAndRun(samplePrompt, "demo");
    toast("Sample mission started. All responses are scripted; no API calls are made.");
  } catch (error) { showError(error); }
  finally {
    busy = false;
    const button = $("try-sample");
    if (button) button.disabled = false;
    renderMissionHeader();
  }
}

function openArtifact(artifact) {
  selectedArtifact = artifact;
  $("artifact-dialog-title").textContent = artifact.title || "Untitled artifact";
  $("artifact-dialog-label").textContent = currentMission()?.mode === "demo" ? "SAMPLE ARTIFACT · SCRIPTED" : "SHARED EVIDENCE";
  $("artifact-dialog-meta").replaceChildren(element("span", "", agentName(artifact.author)), element("span", "pill neutral", artifactVerification(artifact.verification)), element("span", "pill neutral", artifactProvenance(artifact.provenance_status)), element("time", "", formatDate(artifact.created_at)));
  $("artifact-dialog-body").textContent = artifact.body || "No artifact body was supplied.";
  const studioClaims = (artifact.studio_claims || []).map((claim) => {
    const item = element("li");
    const evidenceText = (claim.evidence || []).map((evidence) => `${evidence.path || "Unknown file"}:${evidence.start ?? "?"}-${evidence.end ?? "?"} · SHA-256 ${evidence.sha256 || "unavailable"} · commit ${evidence.commit || "unavailable"} · record ${evidence.tool_result_id || "unavailable"}`).join("\n");
    item.textContent = `${claim.field || "Claim"} · ${String(claim.status || "unverified").toUpperCase()}\n${evidenceText}`;
    return item;
  });
  $("artifact-dialog-studio-claims").replaceChildren(...studioClaims);
  $("artifact-studio-claims-section").hidden = !studioClaims.length;
  const sources = [];
  for (const source of artifact.sources || []) {
    let url;
    try { url = new URL(source.url); } catch { continue; }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
    const item = element("li");
    const link = element("a", "", source.title || url.hostname);
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    item.append(link);
    sources.push(item);
  }
  $("artifact-dialog-sources").replaceChildren(...sources);
  $("artifact-sources-section").hidden = !sources.length;
  $("artifact-dialog").showModal();
}

function downloadArtifact() {
  if (!selectedArtifact) return;
  const artifact = selectedArtifact;
  const sourceText = (artifact.sources || []).map((source) => `${source.title || "Source"}: ${source.url || ""}`).join("\n");
  const studioClaimsText = (artifact.studio_claims || []).map((claim) => `- ${claim.field || "Claim"} · ${String(claim.status || "unverified").toUpperCase()}\n${(claim.evidence || []).map((evidence) => `  - ${evidence.path || "Unknown file"}:${evidence.start ?? "?"}-${evidence.end ?? "?"} · SHA-256 ${evidence.sha256 || "unavailable"} · commit ${evidence.commit || "unavailable"} · tool record ${evidence.tool_result_id || "unavailable"}`).join("\n")}`).join("\n");
  const contents = `# ${artifact.title}\n\n${currentMission()?.mode === "demo" ? "SCRIPTED SAMPLE — not a research result.\n\n" : ""}Author: ${agentName(artifact.author)}\nStatus: ${artifactVerification(artifact.verification)}\nStudio provenance: ${artifactProvenance(artifact.provenance_status)}\nCreated: ${artifact.created_at || ""}\n\n${artifact.body || ""}\n\n${studioClaimsText ? `Structured Studio claim bindings\n${studioClaimsText}\n\n` : ""}${sourceText ? `Sources\n${sourceText}\n` : ""}`;
  const url = URL.createObjectURL(new Blob([contents], { type: "text/markdown;charset=utf-8" }));
  const link = element("a");
  link.href = url;
  link.download = `${String(artifact.title || "sigil-artifact").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 70)}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => $(button.dataset.close).close()));
document.querySelectorAll('input[name="mission-mode"]').forEach((input) => input.addEventListener("change", renderModeNote));
$("new-mission").addEventListener("click", () => openMissionDialog());
$("try-sample").addEventListener("click", startSample);
$("open-connections").addEventListener("click", openConnections);
$("mobile-connections").addEventListener("click", openConnections);
$("mission-connect").addEventListener("click", () => {
  if ($("mission-connect").dataset.intent === "company") {
    $("mission-dialog").close();
    performCompanyAction();
  } else openConnections();
});
$("company-action").addEventListener("click", performCompanyAction);
$("mobile-company-action").addEventListener("click", performCompanyAction);
$("mission-action").addEventListener("click", performMissionAction);
$("open-call-ledger").addEventListener("click", openCallLedger);
$("download-artifact").addEventListener("click", downloadArtifact);
$("dismiss-error").addEventListener("click", () => { $("global-error").hidden = true; });
$("copy-error").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(lastError); toast("Error details copied."); }
  catch { toast("Clipboard access is unavailable. Select the error text to copy it."); }
});
$("message-input").addEventListener("input", renderMissionHeader);
$("message-input").addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    if (!$("send-message").disabled) $("message-form").requestSubmit();
  }
});
$("new-mission-input").addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); $("new-mission-form").requestSubmit(); }
});

$("new-mission-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const prompt = $("new-mission-input").value.trim();
  if (!prompt) return;
  const mode = document.querySelector('input[name="mission-mode"]:checked').value;
  if (mode === "live" && !liveAvailable()) { showError(firstRuntimeIssue()?.message || "Resolve the company status before starting API research.", "new-mission-error"); return; }
  busy = true;
  $("create-mission").disabled = true;
  $("new-mission-error").hidden = true;
  try {
    await createAndRun(prompt, mode);
    $("mission-dialog").close();
    $("new-mission-input").value = "";
    $("recipient-select").value = "coordinator";
  } catch (error) {
    if (error.missionCreated) {
      $("mission-dialog").close();
      $("new-mission-input").value = "";
      showError(error);
    } else showError(error, "new-mission-error");
  }
  finally { busy = false; $("create-mission").disabled = false; renderMissionHeader(); }
});

$("message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !selectedMissionId) return;
  const selected = currentMission();
  if (selected && Number(selected.round || 0) >= Number(selected.max_rounds || 5)) {
    startFocusedFollowup();
    return;
  }
  const text = $("message-input").value.trim();
  if (!text) return;
  const id = selectedMissionId;
  const recipient = $("recipient-select").value;
  busy = true;
  renderMissionHeader();
  try {
    const result = await post(`/api/missions/${encodeURIComponent(id)}/messages`, { text, recipient });
    $("message-input").value = "";
    if (result.mission && detail?.mission?.id === id) detail.mission = result.mission;
    if (!["running", "stopping"].includes(result.mission?.status)) {
      try { await post(`/api/missions/${encodeURIComponent(id)}/run`); }
      catch (error) { showError(new Error(`Your message was saved. The next run could not start: ${error.message}`)); }
    } else toast("Message queued for the team.");
    await refresh();
    $("message-feed").scrollTop = $("message-feed").scrollHeight;
  } catch (error) { showError(error); }
  finally { busy = false; renderMissionHeader(); $("message-input").focus({ preventScroll: true }); }
});

$("stop-mission").addEventListener("click", async () => {
  if (busy || !selectedMissionId) return;
  busy = true;
  renderMissionHeader();
  try {
    const mission = await post(`/api/missions/${encodeURIComponent(selectedMissionId)}/stop`);
    if (detail) detail.mission = mission;
    render();
    toast(mission.mode === "demo" ? "Sample stop requested." : "Stop requested. A model call already in progress may still finish and incur a charge.");
    await refresh();
  } catch (error) { showError(error); }
  finally { busy = false; renderMissionHeader(); }
});

$("resume-mission").addEventListener("click", async () => {
  if (busy || !selectedMissionId) return;
  if (currentMission()?.mode === "live" && !liveAvailable()) {
    performCompanyAction();
    return;
  }
  busy = true;
  renderMissionHeader();
  try {
    const mission = await post(`/api/missions/${encodeURIComponent(selectedMissionId)}/run`);
    if (detail) detail.mission = mission;
    render();
    await refresh();
  } catch (error) { showError(error); }
  finally { busy = false; renderMissionHeader(); }
});

$("connections-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {};
  if ($("gemini-key").value.trim()) body.gemini_api_key = $("gemini-key").value.trim();
  if ($("openai-key").value.trim()) body.openai_api_key = $("openai-key").value.trim();
  if (!Object.keys(body).length) { showError("Enter at least one API key to save a connection.", "connections-error"); return; }
  $("save-connections").disabled = true;
  $("connections-error").hidden = true;
  $("connections-success").hidden = true;
  try {
    await post("/api/providers", body);
    $("gemini-key").value = "";
    $("openai-key").value = "";
    await refresh();
    $("connections-success").textContent = "Keys configured for this server session. API access will be verified by the first model call.";
    $("connections-success").hidden = false;
  } catch (error) { showError(error, "connections-error"); }
  finally {
    for (const key of Object.keys(body)) body[key] = "";
    $("save-connections").disabled = false;
  }
});

document.querySelectorAll(".disconnect-button").forEach((button) => button.addEventListener("click", async () => {
  button.disabled = true;
  $("connections-error").hidden = true;
  $("connections-success").hidden = true;
  try {
    await post("/api/providers/disconnect", { provider: button.dataset.provider });
    await refresh();
    toast("Provider key removed from this session.");
  } catch (error) { showError(error, "connections-error"); }
  finally { button.disabled = false; }
}));

$("connections-dialog").addEventListener("close", () => {
  $("gemini-key").value = "";
  $("openai-key").value = "";
});
document.addEventListener("visibilitychange", () => schedulePoll(true));
window.addEventListener("online", () => schedulePoll(true));
window.addEventListener("beforeunload", () => { clearTimeout(pollTimer); });
schedulePoll(true);
