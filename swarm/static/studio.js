/* Read-only inspection of the pinned project and mission-owned studio records. */
"use strict";

window.sigilStudio = (() => {
  let snapshot = null;
  let loadingSnapshot = false;
  let selectedPath = null;
  let filePage = null;
  let fileRequest = 0;
  let searchRequest = 0;
  let searchResults = null;
  let searchQuery = "";
  let activePane = "files";
  let inspectRecord = null;
  let inspectKind = null;
  let draftFormat = "diff";
  const localSignatures = new Map();

  const missionDetail = () => detail?.mission?.id === selectedMissionId ? detail : null;
  const briefCommit = (value) => value ? String(value).slice(0, 10) : "unavailable";
  const prettyValue = (value) => typeof value === "string" ? value : value === undefined || value === null ? "No detailed output was supplied." : JSON.stringify(value, null, 2);

  function studioError(error) {
    $("studio-error").textContent = error instanceof Error ? error.message : String(error);
    $("studio-error").hidden = false;
  }

  function renderSnapshot() {
    if (!snapshot) return;
    $("studio-branch").textContent = snapshot.branch || "Project snapshot";
    $("studio-commit").textContent = `Commit ${briefCommit(snapshot.commit)}`;
    $("studio-commit").title = String(snapshot.commit || "");
    $("studio-file-count").textContent = `${snapshot.file_count ?? (snapshot.files || []).length} files`;
    const capabilities = snapshot.capabilities || {};
    const labels = [["read", "Read files"], ["search", "Search source"], ["draft", "Draft edits"], ["syntax", "Syntax checks"]];
    const chips = labels.filter(([key]) => capabilities[key]).map(([, label]) => element("span", "pill neutral", label));
    chips.push(element("span", `pill ${capabilities.execution ? "live" : "neutral"}`, capabilities.execution ? "Isolated execution available" : "Execution unavailable"));
    $("studio-capabilities").replaceChildren(...chips);
    $("studio-execution-note").textContent = `${snapshot.execution_note || "Draft edits remain separate from the pinned project."} The file browser is read-only.`;
    $("studio-query").disabled = !capabilities.search;
    $("studio-search-submit").disabled = !capabilities.search;
    renderMissionRecords();
  }

  function resetFileViewer() {
    selectedPath = null;
    filePage = null;
    fileRequest += 1;
    $("studio-file-path").textContent = "Choose a file to inspect";
    $("studio-file-lines").textContent = "";
    $("studio-file-hash").textContent = "No file selected";
    $("studio-file-content").setAttribute("aria-busy", "false");
    $("studio-file-prev").disabled = true;
    $("studio-file-next").disabled = true;
    const empty = element("div", "studio-code-empty");
    const text = element("p", "", "The source stays pinned.");
    text.append(element("span", "", "Select a file or search for a function, signal, or idea."));
    empty.append(icon("code"), text);
    $("studio-file-content").replaceChildren(empty);
  }

  async function loadSnapshot(force = false) {
    if (loadingSnapshot || (snapshot && !force)) return;
    loadingSnapshot = true;
    $("studio-refresh").disabled = true;
    $("studio-refresh").textContent = "Loading snapshot…";
    $("studio-error").hidden = true;
    try {
      const next = await api("/api/studio");
      if (snapshot?.commit && next.commit !== snapshot.commit) {
        resetFileViewer();
        searchResults = null;
        searchQuery = "";
        searchRequest += 1;
        $("studio-query").value = "";
        $("studio-search-submit").textContent = "Search";
        toast("The available project snapshot changed. Choose a file to inspect the new version.");
      }
      snapshot = next;
      renderSnapshot();
      renderFileList();
    } catch (error) {
      studioError(new Error(`The project snapshot could not be loaded. ${error.message}`));
      if (!snapshot) {
        $("studio-branch").textContent = "Snapshot unavailable";
        $("studio-file-list").replaceChildren(element("p", "subtle-empty", "Use Refresh snapshot to try again."));
      }
    } finally {
      loadingSnapshot = false;
      $("studio-refresh").disabled = false;
      $("studio-refresh").textContent = "Refresh snapshot";
    }
  }

  function renderFileList() {
    if (!snapshot) return;
    const hasSearch = searchResults !== null;
    const filter = $("studio-file-filter").value.trim().toLowerCase();
    const rows = hasSearch ? searchResults.matches || [] : (snapshot.files || []).filter((file) => String(file.path).toLowerCase().includes(filter));
    const signature = JSON.stringify([hasSearch, rows, selectedPath, filter]);
    $("studio-file-list-heading").textContent = hasSearch ? "Search results" : "Project files";
    $("studio-clear-search").hidden = !hasSearch;
    $("studio-file-filter").hidden = hasSearch;
    $("studio-search-note").hidden = !hasSearch;
    if (hasSearch) $("studio-search-note").textContent = `${rows.length} matches for “${searchQuery}”${searchResults.truncated ? " · Results limited; narrow your search." : ""}`;
    if (localSignatures.get("files") === signature) return;
    localSignatures.set("files", signature);
    const nodes = rows.map((row, index) => {
      const button = element("button", `studio-file-item ${row.path === selectedPath ? "selected" : ""} ${hasSearch ? "search-match" : ""}`);
      button.type = "button";
      button.dataset.focuskey = `studio-file-${row.path}-${hasSearch ? row.line : index}`;
      button.title = String(row.path);
      if (row.path === selectedPath) button.setAttribute("aria-current", "true");
      button.append(icon("file"));
      const content = element("span", "studio-file-item-content");
      content.append(element("strong", "", row.path));
      if (hasSearch) {
        content.append(element("small", "", `Line ${row.line}`), element("span", "search-match-text", row.text));
      } else {
        const size = Number(row.size);
        if (Number.isFinite(size)) content.append(element("small", "", size < 1024 ? `${size} bytes` : `${(size / 1024).toFixed(1)} KB`));
      }
      button.append(content);
      button.disabled = snapshot.capabilities?.read === false;
      button.addEventListener("click", () => openFile(String(row.path), hasSearch ? Math.max(1, Number(row.line) - 4) : 1, hasSearch ? Number(row.line) : null));
      return button;
    });
    if (!nodes.length) nodes.push(element("p", "subtle-empty", hasSearch ? "No matches in the pinned source." : filter ? "No file paths match this filter." : "No files are exposed by this snapshot."));
    updateGroup("studio-file-list", signature, nodes);
  }

  async function openFile(path, start = 1, highlight = null) {
    const requestId = ++fileRequest;
    selectedPath = path;
    filePage = null;
    renderFileList();
    $("studio-file-path").textContent = path;
    $("studio-file-lines").textContent = "Loading…";
    $("studio-file-prev").disabled = true;
    $("studio-file-next").disabled = true;
    $("studio-file-content").setAttribute("aria-busy", "true");
    $("studio-file-content").replaceChildren(element("p", "loading-placeholder", "Reading the pinned file…"));
    $("studio-file-hash").textContent = "Reading snapshot";
    $("studio-error").hidden = true;
    try {
      const query = new URLSearchParams({ path, start: String(Math.max(1, start)) });
      const page = await api(`/api/studio/file?${query}`);
      if (requestId !== fileRequest) return;
      filePage = page;
      $("studio-file-path").textContent = page.path;
      $("studio-file-lines").textContent = Number(page.total_lines) ? `${page.start}–${page.end} of ${page.total_lines} lines` : "Empty file";
      $("studio-file-hash").textContent = `Commit ${briefCommit(page.commit)} · SHA ${briefCommit(page.sha256)}`;
      $("studio-file-hash").title = `Commit: ${page.commit || "unavailable"}\nSHA-256: ${page.sha256 || "unavailable"}`;
      const lines = String(page.text || "").split("\n");
      if (lines.at(-1) === "") lines.pop();
      const nodes = lines.map((text, index) => {
        const number = Number(page.start) + index;
        const line = element("div", `studio-code-line ${number === highlight ? "highlighted" : ""}`);
        const gutter = element("span", "studio-line-number", number);
        gutter.setAttribute("aria-hidden", "true");
        line.append(gutter, element("code", "", text || " "));
        return line;
      });
      $("studio-file-content").replaceChildren(...(nodes.length ? nodes : [element("p", "loading-placeholder", "This file is empty.")]));
      $("studio-file-content").scrollTop = 0;
      $("studio-file-content").scrollLeft = 0;
      $("studio-file-prev").disabled = Number(page.start) <= 1;
      $("studio-file-next").disabled = Number(page.end) >= Number(page.total_lines);
      if (page.commit && snapshot?.commit && page.commit !== snapshot.commit) studioError("The file response belongs to a different snapshot than the file list. Refresh the snapshot before comparing these files.");
    } catch (error) {
      if (requestId !== fileRequest) return;
      $("studio-file-content").replaceChildren(element("p", "loading-placeholder", "This file could not be read. Select it again to retry."));
      $("studio-file-lines").textContent = "Unavailable";
      $("studio-file-hash").textContent = "File unavailable";
      studioError(error);
    } finally {
      if (requestId === fileRequest) $("studio-file-content").setAttribute("aria-busy", "false");
    }
  }

  async function searchProject(event) {
    event.preventDefault();
    const queryText = $("studio-query").value.trim();
    if (!queryText || !snapshot?.capabilities?.search) return;
    const requestId = ++searchRequest;
    $("studio-search-submit").disabled = true;
    $("studio-search-submit").textContent = "Searching…";
    $("studio-error").hidden = true;
    try {
      const result = await api(`/api/studio/search?${new URLSearchParams({ q: queryText })}`);
      if (requestId !== searchRequest) return;
      searchResults = result;
      searchQuery = queryText;
      renderFileList();
    } catch (error) { if (requestId === searchRequest) studioError(error); }
    finally {
      if (requestId === searchRequest) {
        $("studio-search-submit").disabled = !snapshot?.capabilities?.search;
        $("studio-search-submit").textContent = "Search";
      }
    }
  }

  function selectPane(pane, focusTab = false) {
    if (!["files", "drafts", "activity"].includes(pane)) return;
    activePane = pane;
    for (const name of ["files", "drafts", "activity"]) {
      const selected = name === pane;
      const tab = $(`studio-tab-${name}`);
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $(`studio-pane-${name}`).hidden = !selected;
    }
    if (focusTab) $(`studio-tab-${pane}`).focus();
  }

  function renderMissionSelect() {
    const missions = state?.missions || [];
    const signature = JSON.stringify(missions.map(({ id, title, mode }) => [id, title, mode]));
    if (localSignatures.get("mission-select") !== signature) {
      const options = missions.map((mission) => {
        const option = element("option", "", `${mission.mode === "demo" ? "Sample · " : ""}${mission.title}`);
        option.value = mission.id;
        return option;
      });
      if (!options.length) { const option = element("option", "", "No mission selected"); option.value = ""; options.push(option); }
      $("studio-mission-select").replaceChildren(...options);
      localSignatures.set("mission-select", signature);
    }
    if ($("studio-mission-select").value !== (selectedMissionId || "")) $("studio-mission-select").value = selectedMissionId || "";
    $("studio-mission-select").disabled = !missions.length || busy;
  }

  function renderMissionRecords() {
    const current = missionDetail();
    renderMissionSelect();
    const drafts = Array.isArray(current?.drafts) ? current.drafts : [];
    const tools = Array.isArray(current?.tool_results) ? current.tool_results : [];
    const commit = current?.studio?.commit;
    let note = selectedMissionId ? current?.mission?.mode === "demo" ? "Sample mission · Any example work is scripted." : "Drafts and results from the selected mission." : "Choose a mission to inspect its drafts and tool results.";
    if (commit) note += ` Mission snapshot: ${briefCommit(commit)}.`;
    if (commit && snapshot?.commit && commit !== snapshot.commit) note += " The file browser shows a different, currently available snapshot.";
    $("studio-mission-note").textContent = note;
    $("studio-draft-count").textContent = String(drafts.length);
    $("studio-tool-count").textContent = String(tools.length);
    const draftSignature = JSON.stringify([selectedMissionId, drafts]);
    if (localSignatures.get("drafts") !== draftSignature) {
      const nodes = [...drafts].reverse().map((draft) => {
        const button = element("button", "studio-draft-card");
        button.type = "button";
        button.dataset.focuskey = `draft-${draft.id}`;
        button.addEventListener("click", () => openRecord(draft, "draft"));
        const top = element("div", "studio-record-top");
        top.append(icon("code"), element("span", "pill sample", "Draft · unapplied"));
        const footer = element("div", "studio-record-footer");
        footer.append(element("span", "", `${agentName(draft.author)} · ${formatDate(draft.created_at)}`), element("span", "", "Inspect draft →"));
        button.append(top, element("h3", "", draft.path), element("p", "", `Proposed edit against original SHA ${briefCommit(draft.before_sha256)}. Review the diff and proposed contents.`), footer);
        return button;
      });
      if (!nodes.length) nodes.push(emptyCard("No proposed edits yet.", selectedMissionId ? "When the team drafts a change, the original file and proposed edit stay separate for review." : "Choose a mission above to inspect its draft changes."));
      updateGroup("studio-draft-list", draftSignature, nodes);
      localSignatures.set("drafts", draftSignature);
    }
    const toolSignature = JSON.stringify([selectedMissionId, tools]);
    if (localSignatures.get("tools") !== toolSignature) {
      const nodes = [...tools].reverse().map((tool) => {
        const button = element("button", "studio-tool-row");
        button.type = "button";
        button.dataset.focuskey = `tool-${tool.id}`;
        button.addEventListener("click", () => openRecord(tool, "tool"));
        const status = String(tool.status || "recorded");
        const isSuccess = ["ok", "success", "succeeded", "completed", "passed"].includes(status);
        const statusLabel = element("span", `pill ${isSuccess ? "live" : ["failed", "error", "blocked"].includes(status) ? "sample" : "neutral"}`, status.replaceAll("_", " "));
        const content = element("div", "studio-tool-content");
        content.append(element("h3", "", String(tool.tool || "Tool result").replaceAll("_", " ")), element("p", "", tool.summary || "Open this record to inspect the tool’s output."), element("small", "", `${agentName(tool.agent_id)}${tool.created_at ? ` · ${formatDate(tool.created_at)}` : ""}`));
        button.append(icon(isSuccess ? "check" : "file"), content, statusLabel, icon("arrow"));
        return button;
      });
      if (!nodes.length) nodes.push(emptyCard("The work will leave a trail.", selectedMissionId ? "File reads, searches, draft edits, and checks appear here when the team uses its tools." : "Choose a mission above to inspect its recorded tool results."));
      updateGroup("studio-tool-list", toolSignature, nodes);
      localSignatures.set("tools", toolSignature);
    }
  }

  function recordText() {
    if (!inspectRecord) return "";
    if (inspectKind === "tool" && inspectRecord.tool === "web_search" && typeof inspectRecord.result?.text === "string") {
      const result = inspectRecord.result;
      const sources = validSearchSources(result).map((source) => `${source.title || source.url}: ${source.url}`).join("\n");
      return `${result.query ? `Query: ${result.query}\n\n` : ""}${result.text}${sources ? `\n\nSources\n${sources}` : ""}`;
    }
    return inspectKind === "draft" ? String(inspectRecord[draftFormat] || (draftFormat === "diff" ? "No diff was supplied for this draft." : "")) : prettyValue(inspectRecord.result);
  }

  function safeSearchUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }

  function validSearchSources(result) {
    const sources = [];
    const seen = new Set();
    for (const source of [...(Array.isArray(result.sources) ? result.sources : []), ...(Array.isArray(result.annotations) ? result.annotations.filter((item) => item.type === "url_citation") : [])]) {
      const url = safeSearchUrl(source.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ url, title: source.title });
    }
    return sources;
  }

  function renderSearchResult(result) {
    const text = String(result.text || "");
    const nodes = [];
    if (result.query) nodes.push(document.createTextNode(`Query: ${result.query}\n\n`));
    const citations = (Array.isArray(result.annotations) ? result.annotations : []).filter((item) => item.type === "url_citation" && Number.isInteger(item.start_index) && Number.isInteger(item.end_index) && item.start_index >= 0 && item.end_index > item.start_index && item.end_index <= text.length && safeSearchUrl(item.url)).sort((a, b) => a.start_index - b.start_index || a.end_index - b.end_index);
    let cursor = 0;
    for (const citation of citations) {
      if (citation.start_index < cursor) continue;
      nodes.push(document.createTextNode(text.slice(cursor, citation.start_index)));
      const link = element("a", "studio-inline-citation", text.slice(citation.start_index, citation.end_index));
      link.href = safeSearchUrl(citation.url);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = citation.title || new URL(link.href).hostname;
      nodes.push(link);
      cursor = citation.end_index;
    }
    nodes.push(document.createTextNode(text.slice(cursor)));
    $("studio-inspect-body").replaceChildren(...nodes);
    const sources = validSearchSources(result).map((source) => {
      const item = element("li");
      const link = element("a", "", source.title || new URL(source.url).hostname);
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      item.append(link);
      return item;
    });
    $("studio-inspect-source-list").replaceChildren(...sources);
    $("studio-inspect-sources").hidden = !sources.length;
  }

  function renderRecordBody() {
    $("studio-inspect-sources").hidden = true;
    $("studio-inspect-source-list").replaceChildren();
    const isSearch = inspectKind === "tool" && inspectRecord.tool === "web_search" && typeof inspectRecord.result?.text === "string";
    $("studio-inspect-body").classList.toggle("search-result", isSearch);
    if (isSearch) renderSearchResult(inspectRecord.result);
    else if (inspectKind === "draft" && draftFormat === "diff") {
      const lines = recordText().split("\n").map((text) => element("span", text.startsWith("+") && !text.startsWith("+++") ? "diff-added" : text.startsWith("-") && !text.startsWith("---") ? "diff-removed" : text.startsWith("@@") ? "diff-context" : "", text || " "));
      $("studio-inspect-body").replaceChildren(...lines);
    } else $("studio-inspect-body").textContent = recordText();
    $("studio-inspect-body").scrollTop = 0;
    $("studio-inspect-body").scrollLeft = 0;
    for (const button of document.querySelectorAll("[data-draft-format]")) {
      const selected = button.dataset.draftFormat === draftFormat;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
  }

  function openRecord(record, kind) {
    inspectRecord = record;
    inspectKind = kind;
    draftFormat = "diff";
    $("studio-inspect-label").textContent = `${missionDetail()?.mission?.mode === "demo" ? "SAMPLE · " : ""}${kind === "draft" ? "DRAFT EDIT · NOT APPLIED" : "RECORDED TOOL RESULT"}`;
    $("studio-inspect-title").textContent = kind === "draft" ? record.path : String(record.tool || "Tool result").replaceAll("_", " ");
    const metadata = [element("span", "", agentName(kind === "draft" ? record.author : record.agent_id)), element("span", "pill neutral", kind === "draft" ? "Draft · unapplied" : String(record.status || "recorded").replaceAll("_", " "))];
    if (record.created_at) metadata.push(element("time", "", formatDate(record.created_at)));
    if (kind === "draft") metadata.push(element("span", "", `Original SHA ${briefCommit(record.before_sha256)}`));
    $("studio-inspect-meta").replaceChildren(...metadata);
    $("studio-draft-switch").hidden = kind !== "draft";
    $("studio-inspect-note").textContent = kind === "draft" ? "Downloading this proposal does not apply it to the project." : "A successful tool result is limited to the operation shown here.";
    renderRecordBody();
    $("studio-inspect-dialog").showModal();
  }

  function downloadRecord() {
    if (!inspectRecord) return;
    const base = String(inspectKind === "draft" ? inspectRecord.path : inspectRecord.tool || "studio-record").replace(/[^a-z0-9._-]+/gi, "-").slice(-100);
    const suffix = inspectKind === "draft" ? draftFormat === "diff" ? ".draft.patch" : ".proposed.txt" : ".result.txt";
    const text = inspectKind === "draft" ? recordText() : `${inspectRecord.tool || "Tool result"}\nStatus: ${inspectRecord.status || "recorded"}\nAgent: ${agentName(inspectRecord.agent_id)}\n${inspectRecord.summary || ""}\n\n${recordText()}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = element("a");
    link.href = url;
    link.download = `${base}${suffix}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $("studio-refresh").addEventListener("click", () => loadSnapshot(true));
  $("studio-file-filter").addEventListener("input", renderFileList);
  $("studio-search-form").addEventListener("submit", searchProject);
  $("studio-clear-search").addEventListener("click", () => {
    searchRequest += 1;
    searchResults = null;
    searchQuery = "";
    $("studio-query").value = "";
    $("studio-search-submit").textContent = "Search";
    $("studio-search-submit").disabled = !snapshot?.capabilities?.search;
    renderFileList();
    $("studio-file-filter").focus();
  });
  $("studio-file-prev").addEventListener("click", () => {
    if (filePage) openFile(filePage.path, Math.max(1, Number(filePage.start) - (Number(filePage.end) - Number(filePage.start) + 1)));
  });
  $("studio-file-next").addEventListener("click", () => { if (filePage) openFile(filePage.path, Number(filePage.end) + 1); });
  $("studio-mission-select").addEventListener("change", (event) => { if (event.target.value) chooseMission(event.target.value, "studio"); });
  document.querySelectorAll("[data-studio-pane]").forEach((button) => {
    button.addEventListener("click", () => selectPane(button.dataset.studioPane));
    button.addEventListener("keydown", (event) => {
      const panes = ["files", "drafts", "activity"];
      let next;
      if (event.key === "ArrowRight") next = (panes.indexOf(activePane) + 1) % panes.length;
      else if (event.key === "ArrowLeft") next = (panes.indexOf(activePane) + panes.length - 1) % panes.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = panes.length - 1;
      else return;
      event.preventDefault();
      selectPane(panes[next], true);
    });
  });
  document.querySelectorAll("[data-draft-format]").forEach((button) => button.addEventListener("click", () => { draftFormat = button.dataset.draftFormat; renderRecordBody(); }));
  $("studio-copy-record").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(recordText()); toast("Studio record copied."); }
    catch { toast("Clipboard access is unavailable. Select the record text to copy it."); }
  });
  $("studio-download-record").addEventListener("click", downloadRecord);

  return {
    activate() { renderMissionRecords(); loadSnapshot(); },
    render() { renderMissionRecords(); },
  };
})();
