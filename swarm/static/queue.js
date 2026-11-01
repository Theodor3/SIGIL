"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const selected = [];
  let snapshot = null;
  let busy = false;
  let refreshing = false;
  let refreshAgain = false;
  let revision = 0;
  let refreshError = false;
  let lastSessionActive = false;
  let lastSession = {};
  let timer = null;
  const activeStates = new Set(["running", "active", "waiting_review", "waiting_for_review", "waiting", "paused", "checking", "scheduled", "waiting_cadence"]);

  function text(id, value) { $(id).textContent = String(value ?? "—"); }
  function notice(id, message) { text(id, message); $(id).hidden = !message; }
  function currentMode() { return document.querySelector('input[name="session-mode"]:checked').value; }
  function isActive(session = {}) {
    if (typeof session.enabled === "boolean") return session.enabled;
    if (typeof session.active === "boolean") return session.active;
    return activeStates.has(String(session.status || session.state || session.phase || "").toLowerCase());
  }
  function stateLabel(session = {}) { return session.status || session.state || session.phase || "off"; }
  function explain(value) {
    if (typeof value === "string") return value;
    return value?.message || value?.reason || value?.code || "";
  }
  function date(value) {
    if (!value) return "No active window";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
  }
  function money(value) {
    return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(4)}` : "Unknown";
  }
  function missions() { return Array.isArray(snapshot?.inventory?.missions) ? snapshot.inventory.missions : []; }
  function eligible(mission) { return mission.eligible === true && mission.mode === currentMode(); }
  function fieldError(message) { notice("page-error", message); }
  function uncertain(message) { const error = new Error(message); error.outcomeUncertain = true; return error; }

  async function request(path, body) {
    const options = {method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store"};
    if (body !== undefined) { options.headers = {"Content-Type": "application/json"}; options.body = JSON.stringify(body); }
    let response;
    try { response = await fetch(path, options); }
    catch (_) { throw body === undefined ? new Error("The local service could not be reached.") : uncertain("Request outcome could not be confirmed. Refresh status before repeating the action."); }
    let result;
    try { result = await response.json(); } catch (_) { throw body === undefined ? new Error(`Local service returned HTTP ${response.status}.`) : uncertain(`Request outcome could not be confirmed (HTTP ${response.status}). Refresh status before repeating the action.`); }
    if (!response.ok) {
      const message = typeof result.detail === "string" ? result.detail : `Local service returned HTTP ${response.status}.`;
      throw body !== undefined && response.status >= 500 ? uncertain(`${message} Refresh status before repeating the action.`) : new Error(message);
    }
    return result;
  }

  function renderSelection() {
    const session = snapshot?.session || lastSession;
    const active = snapshot ? isActive(session) : lastSessionActive;
    const ordered = active && Array.isArray(session.mission_ids) ? session.mission_ids : selected;
    const list = $("selection-order");
    list.replaceChildren();
    text("selection-label", active ? "Session’s frozen order" : "Selected order");
    if (!ordered.length) { const item = document.createElement("li"); item.textContent = "No missions selected"; list.append(item); }
    for (const id of ordered) {
      const item = document.createElement("li");
      const mission = missions().find((entry) => entry.id === id);
      item.textContent = `${mission?.title || id} · ${id}`;
      list.append(item);
    }
    const paidReady = currentMode() !== "live" || $("paid-confirmed").checked;
    $("start-session").disabled = busy || !snapshot || active || !selected.length || !paidReady;
    $("stop-session").disabled = busy || !lastSessionActive;
    $("prepare-mission").disabled = busy || !snapshot;
    for (const input of document.querySelectorAll('input[name="session-mode"]')) input.disabled = busy || active;
    $("session-minutes").disabled = busy || active;
    $("cadence-minutes").disabled = busy || active;
  }

  function renderMissions() {
    const list = $("mission-list");
    const entries = missions();
    const active = isActive(snapshot?.session);
    for (let index = selected.length - 1; index >= 0; index--) {
      const candidate = entries.find((entry) => entry.id === selected[index]);
      if (!candidate || !eligible(candidate)) selected.splice(index, 1);
    }
    const focusedId = list.contains(document.activeElement) ? document.activeElement.value : null;
    list.replaceChildren();
    text("ready-count", `${entries.filter((entry) => entry.eligible === true).length} eligible`);
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No prepared ready missions. Add one focused task using Prepare only, then explicitly select it here.";
      list.append(empty);
    }
    for (const mission of entries) {
      const label = document.createElement("label");
      const allowed = eligible(mission);
      label.className = `mission-choice${allowed ? "" : " unavailable"}`;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = String(mission.id);
      input.checked = selected.includes(mission.id);
      input.disabled = busy || active || !allowed;
      input.addEventListener("change", () => {
        if (input.checked) {
          if (selected.length >= 3) { input.checked = false; fieldError("Select at most three missions for this finite session."); return; }
          selected.push(mission.id);
        } else { const index = selected.indexOf(mission.id); if (index >= 0) selected.splice(index, 1); }
        notice("page-error", "");
        renderSelection();
      });
      const content = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = mission.title || mission.id;
      const detail = document.createElement("small");
      detail.textContent = `${mission.id} · ${mission.mode === "live" ? "API providers" : "Local model"}${!allowed ? ` · ${mission.mode !== currentMode() ? "Choose this provider to select" : mission.reason || "Not eligible"}` : ""}`;
      content.append(title, detail);
      label.append(input, content);
      list.append(label);
      if (focusedId === String(mission.id) && !input.disabled) input.focus({preventScroll: true});
    }
    const reasons = (snapshot?.inventory?.reasons || []).map(explain).filter(Boolean);
    notice("queue-reasons", reasons.join(" "));
    renderSelection();
  }

  function renderBoard() {
    const board = snapshot?.inventory?.board || {};
    const counts = $("board-counts");
    counts.replaceChildren();
    for (const [status, count] of Object.entries(board.counts || {})) {
      const badge = document.createElement("span"); badge.className = "board-count"; badge.textContent = `${count} ${status}`; counts.append(badge);
    }
    const ready = Number(board.ready_count ?? board.counts?.ready ?? 0);
    text("board-note", board.error ? explain(board.error) : `${ready} board task${ready === 1 ? " is" : "s are"} ready. Board tasks and prepared runtime missions are shown separately; blocked evidence is not turned into work automatically.`);
    const blocked = $("blocked-list");
    blocked.replaceChildren();
    for (const task of (Array.isArray(board.blocked) ? board.blocked : [])) {
      const item = document.createElement("li"); const title = document.createElement("strong"); const reason = document.createElement("small");
      title.textContent = `${task.id || "Task"} · ${task.title || "Blocked"}`;
      reason.textContent = task.reason || "No executable assignment is ready; inspect the canonical board evidence before preparing new work.";
      item.append(title, reason); blocked.append(item);
    }
  }

  function render() {
    const session = snapshot?.session || {};
    const active = isActive(session);
    lastSessionActive = active;
    lastSession = session;
    const phase = stateLabel(session);
    if (active && ["local", "live"].includes(session.mode)) {
      for (const input of document.querySelectorAll('input[name="session-mode"]')) input.checked = input.value === session.mode;
      if (Number.isInteger(session.duration_minutes)) $("session-minutes").value = String(session.duration_minutes);
      if (Number.isInteger(session.cadence_minutes)) $("cadence-minutes").value = String(session.cadence_minutes);
    }
    $("paid-confirmation-row").hidden = active || currentMode() !== "live";
    text("session-heading", active ? "Bounded session is enabled" : "No session running");
    text("session-badge", String(phase).replaceAll("_", " "));
    $("session-badge").classList.toggle("active", active);
    text("session-reason", explain(session.reason) || session.last_error || session.message || (active ? "Only explicitly selected work may dispatch within this session’s bounds." : "Prepare and select ready work to start. Refreshing never dispatches a mission."));
    text("session-deadline", date(session.deadline || session.deadline_at || session.stop_at || session.expires_at));
    text("session-provider", session.mode === "live" ? "API providers" : session.mode === "local" ? "Local model" : "No selected session");
    text("session-owned", session.owned_active_id || session.owned_mission_id || session.current_mission_id || session.active_mission_id || "None");
    const ids = session.mission_ids || session.selected_ids || [];
    const dispatched = Array.isArray(session.pending_ids) ? ids.length - session.pending_ids.length : Number(session.dispatched_count || 0);
    text("session-progress", ids.length ? `${Math.max(0, dispatched)} / ${ids.length}` : "No selected session");
    const budget = snapshot?.budget || {};
    text("budget-remaining", money(budget.allowance?.remaining_usd ?? budget.remaining_pilot_usd));
    text("budget-note", budget.uncertain ? "Billing is uncertain; paid dispatch remains blocked. This page cannot settle costs." : `Controller estimate only. Reserved: ${money(budget.reserved_usd ?? budget.allowance?.reserved_usd)}. Existing budget limits stay unchanged.`);
    renderMissions();
    renderBoard();
  }

  async function refresh(force = false) {
    if (refreshing) { if (force === true) refreshAgain = true; return; }
    refreshing = true;
    const readRevision = revision;
    try {
      const result = await request("/api/queue");
      if (readRevision !== revision) return;
      snapshot = result;
      render();
      text("freshness", `Updated ${new Date().toLocaleTimeString()}`);
      if (refreshError) { notice("page-error", ""); refreshError = false; }
    } catch (error) {
      if (readRevision !== revision) return;
      text("freshness", "Refresh failed — displayed state may be stale");
      fieldError(error.message);
      refreshError = true;
      snapshot = null;
      renderSelection();
    } finally { refreshing = false; if (refreshAgain) { refreshAgain = false; refresh(); } }
  }

  async function action(path, body, message) {
    if (busy) return;
    busy = true; revision++; snapshot = null; renderSelection(); refreshError = false; notice("page-error", ""); notice("action-result", ""); text("freshness", "Updating after action…");
    try {
      const result = await request(path, body);
      revision++; snapshot = null;
      if (path.endsWith("/start") || path.endsWith("/stop")) {
        const confirmed = result.session || result;
        if (typeof confirmed.enabled === "boolean") { lastSession = confirmed; lastSessionActive = confirmed.enabled; }
      }
      notice("action-result", typeof message === "function" ? message(result) : message);
      await refresh(true);
    } catch (error) {
      revision++; snapshot = null;
      if (error.outcomeUncertain) {
        if (path.endsWith("/start")) { lastSessionActive = true; lastSession = {enabled:true, state:"outcome_unknown", mode:body.mode, mission_ids:body.mission_ids}; }
      }
      fieldError(error.message);
    }
    finally { busy = false; if (snapshot) render(); else renderSelection(); }
  }

  $("session-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selected.length || selected.length > 3) { fieldError("Select one to three eligible missions in the order you want."); return; }
    const duration = Number($("session-minutes").value), cadence = Number($("cadence-minutes").value);
    if (![duration, cadence].every((value) => Number.isInteger(value) && value >= 1 && value <= 60)) { fieldError("Session limit and interval must each be a whole number from 1 to 60 minutes."); return; }
    if (currentMode() === "live" && !$("paid-confirmed").checked) { fieldError("Explicitly select API spending before starting an API session."); return; }
    await action("/api/queue/start", {mission_ids: [...selected], mode: currentMode(), duration_minutes: duration, cadence_minutes: cadence, paid_confirmed: $("paid-confirmed").checked}, "Finite session requested. Follow its recorded status and review gate above.");
  });
  $("prepare-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const prompt = $("prepare-prompt").value.trim();
    if (!prompt) { fieldError("Write a focused assignment and its acceptance criteria."); return; }
    const mode = $("prepare-mode").value;
    await action("/api/queue/prepare", {prompt, mode, local_role: $("prepare-role").value, max_revisions: 0, requires_tests: $("requires-tests").checked, max_cost_usd: mode === "live" ? Number($("mission-cap").value) : 0.5}, (result) => `Prepared ${result.mission?.id || "mission"} only. Select its exact ID to include it in a finite session.`);
  });
  $("stop-session").addEventListener("click", () => action("/api/queue/stop", {}, "Stop requested for this session. Already-sent calls may finish; unrelated work is left alone."));
  $("refresh").addEventListener("click", refresh);
  $("paid-confirmed").addEventListener("change", renderSelection);
  for (const input of document.querySelectorAll('input[name="session-mode"]')) input.addEventListener("change", () => {
    selected.splice(0); $("paid-confirmed").checked = false;
    $("paid-confirmation-row").hidden = currentMode() !== "live";
    text("mode-note", currentMode() === "live" ? "API calls use the existing shared allowance and recorded reservations. No local-to-paid fallback is enabled." : "Local inference uses no model API fee. No paid fallback.");
    renderMissions();
  });
  $("prepare-mode").addEventListener("change", () => {
    $("mission-cap-row").hidden = $("prepare-mode").value !== "live";
    $("prepare-role").disabled = $("prepare-mode").value !== "local";
  });
  document.addEventListener("visibilitychange", () => {
    if (timer) { clearInterval(timer); timer = null; }
    if (!document.hidden) { refresh(); timer = setInterval(refresh, 3000); }
  });
  refresh();
  timer = setInterval(refresh, 3000);
})();
