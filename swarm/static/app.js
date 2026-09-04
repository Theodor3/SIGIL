/* SIGIL local swarm. User and model text is always rendered as text, never HTML. */
"use strict";

const $ = (id) => document.getElementById(id);
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
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
const statuses = { ready: "Ready", running: "Working", stopping: "Stopping", stopped: "Stopped", needs_review: "Needs review", blocked: "Blocked", completed: "Complete", done: "Complete", queued: "Queued", assigned: "Assigned", pending: "Pending", idle: "Standing by", working: "Working", failed: "Failed", review: "In review" };
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
  return Boolean(state?.backend?.live_available && state?.providers?.gemini?.configured && state?.providers?.openai?.configured);
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
  meter.setAttribute("aria-valuetext", `${money(used)} spent and ${money(reserved)} reserved of ${money(limit)}`);
  $("budget-detail").textContent = `${money(budget.remaining_today_usd)} available · ${money(reserved)} reserved`;
  $("pilot-budget").textContent = `${money(budget.pilot_usd)} / ${money(budget.pilot_limit_usd || 7)}`;
  $("mobile-budget").textContent = `${money(used)} / ${money(limit)} today`;
}

function renderProviders() {
  const providers = state?.providers || {};
  const configured = Object.values(providers).filter((provider) => provider.configured).length;
  $("connection-summary").textContent = configured === 2 ? "Both keys configured" : configured === 1 ? "One key configured" : "Add keys to use API research";
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
  if (!liveAvailable() && $("live-mode-input").checked) document.querySelector('input[name="mission-mode"][value="demo"]').checked = true;
  renderModeNote();
}

function renderModeNote() {
  const live = $("live-mode-input").checked;
  $("mission-mode-note").textContent = live ? "Real provider calls count toward the $1 daily and $7 pilot limits. Research and review only; no trading or code execution." : "Sample mode shows the workflow with clearly labeled example responses. It does not research your prompt or call a model.";
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
    name.append(element("div", "agent-row-role", item.id === "coordinator" ? "OpenAI · Connects the team" : `Gemini · ${statuses[item.status] || "Standing by"}`));
    const indicator = element("span", `agent-indicator ${["running", "working", "blocked"].includes(item.status) ? item.status : ""}`);
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
    const provider = String(item.provider).toLowerCase() === "openai" ? "OpenAI" : "Gemini";
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
    content.append(element("h3", "", mission.title || "Untitled mission"), element("p", "", `${formatDate(mission.updated_at)} · Round ${mission.round || 0} of ${mission.max_rounds || 5} · ${mission.mode === "demo" ? "No API spending" : `${money(mission.spent_usd)} in model charges`}`));
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
  $("conversation-heading").textContent = mission?.title || "Give good ideas a place to grow.";
  $("mission-eyebrow").textContent = hasMission ? "THE SHARED CONVERSATION" : "YOUR NEXT QUESTION STARTS HERE";
  $("mission-mode").textContent = mission?.mode === "live" ? "API research" : "Sample mode";
  $("mission-mode").className = `pill ${mission?.mode === "live" ? "live" : "sample"}`;
  $("sample-banner").hidden = mission?.mode === "live";
  $("mission-toolbar").hidden = !hasMission;
  $("message-input").disabled = !hasMission || busy;
  $("recipient-select").disabled = !hasMission || busy;
  $("send-message").disabled = !hasMission || busy || !$("message-input").value.trim();
  $("message-input").placeholder = hasMission ? "Ask a question, challenge a finding, or steer the next step…" : "Start a mission to talk with your team…";
  $("composer-note").textContent = mission?.mode === "demo" ? "Sample replies are scripted. Your messages are saved, but no model reads them." : hasMission ? "Messages are shared with the selected role. Only relevant context is passed to other workers." : "Your team works in a separate research workspace.";
  if (mission) {
    $("mission-status").textContent = statuses[mission.status] || "Unknown status";
    $("mission-status").className = `status-pill ${Object.hasOwn(statuses, mission.status) ? mission.status : "ready"}`;
    $("mission-round").textContent = `Round ${mission.round || 0} of ${mission.max_rounds || 5}`;
    $("stop-mission").hidden = !isRunning(mission);
    $("stop-mission").disabled = busy || mission.status === "stopping";
    $("resume-mission").hidden = isRunning(mission) || mission.status === "completed" || mission.status === "needs_review";
    $("resume-mission").disabled = busy || (mission.mode === "live" && !liveAvailable());
    $("export-mission").href = `/api/missions/${encodeURIComponent(mission.id)}/export`;
    $("export-mission").setAttribute("download", "");
  }
  $("mission-summary").hidden = !mission?.summary;
  $("mission-summary-text").textContent = mission?.summary || "";
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
    top.append(icon("file"), element("span", "pill neutral", artifactVerification(artifact.verification)));
    const body = String(artifact.body || "");
    button.append(top, element("h3", "", artifact.title), element("p", "", body.length > 180 ? `${body.slice(0, 180)}…` : body), element("small", "", `${agentName(artifact.author)} · ${formatDate(artifact.created_at)} · ${(artifact.sources || []).length} sources`));
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

function render() {
  renderBudget();
  renderProviders();
  renderAgents();
  renderMissions();
  renderMissionHeader();
  renderMessages();
  renderEvidence();
  renderTasks();
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
  if (!["workspace", "missions", "evidence", "team"].includes(view)) return;
  currentView = view;
  for (const name of ["workspace", "missions", "evidence", "team"]) $(`view-${name}`).hidden = name !== view;
  for (const button of document.querySelectorAll(".nav-item")) {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  const titles = { workspace: "Swarm workspace", missions: "Mission control", evidence: "Shared evidence", team: "Meet the team" };
  const subtitles = { workspace: "One place to think, collaborate, and turn ideas into evidence.", missions: "The questions, handoffs, and decisions that move the work forward.", evidence: "Keep the claims inspectable and the sources close.", team: "Seven Gemini specialists, connected by one GPT coordinator." };
  $("view-title").replaceChildren(document.createTextNode(titles[view]), element("span", "heading-dot", "."));
  $("view-subtitle").textContent = subtitles[view];
}

async function chooseMission(id) {
  if (busy) return;
  if (selectedMissionId !== id && $("message-input").value.trim()) {
    toast("Your unsent draft stays in the composer. Check the recipient before sending.");
  }
  selectedMissionId = id;
  detail = null;
  selectedDetailSignature = "";
  signatures.delete("message-feed");
  switchView("workspace");
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

function openMissionDialog() {
  $("new-mission-error").hidden = true;
  renderProviders();
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
  $("artifact-dialog-meta").replaceChildren(element("span", "", agentName(artifact.author)), element("span", "pill neutral", artifactVerification(artifact.verification)), element("time", "", formatDate(artifact.created_at)));
  $("artifact-dialog-body").textContent = artifact.body || "No artifact body was supplied.";
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
  const contents = `# ${artifact.title}\n\n${currentMission()?.mode === "demo" ? "SCRIPTED SAMPLE — not a research result.\n\n" : ""}Author: ${agentName(artifact.author)}\nStatus: ${artifactVerification(artifact.verification)}\nCreated: ${artifact.created_at || ""}\n\n${artifact.body || ""}\n\n${sourceText ? `Sources\n${sourceText}\n` : ""}`;
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
$("new-mission").addEventListener("click", openMissionDialog);
$("try-sample").addEventListener("click", startSample);
$("open-connections").addEventListener("click", openConnections);
$("mobile-connections").addEventListener("click", openConnections);
$("mission-connect").addEventListener("click", openConnections);
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
  if (mode === "live" && !liveAvailable()) { showError("Connect both provider keys before starting API research.", "new-mission-error"); return; }
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
