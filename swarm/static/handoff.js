"use strict";
(() => {
  const host = document.getElementById('handoff-content');
  const status = document.getElementById('handoff-status');
  const refresh = document.getElementById('handoff-refresh');
  const el = (tag, text, cls = '') => {
    const node = document.createElement(tag); node.textContent = text; node.className = cls; return node;
  };
  const evidence = (card, refs) => {
    if (!refs?.length) return;
    const list = el('ul', '', 'experiment-findings');
    for (const ref of refs) list.append(el('li', ref));
    card.append(el('h4', 'Evidence / preview references'), list);
  };
  let loading = false;
  let dirty = false;
  function decision(item) {
    const card = el('article', '', 'experiment-card');
    card.append(el('p', item.status === 'open' ? 'YOUR DECISION' : 'ANSWER SAVED', 'eyebrow'), el('h3', item.question));
    for (const [label, value] of [['Recommended', item.recommendation], ['Blocks', item.blocks], ['Can continue', item.can_continue]]) {
      card.append(el('h4', label), el('p', value));
    }
    evidence(card, item.evidence);
    if (item.status !== 'open') { card.append(el('p', `Your answer: ${item.answer}`)); return card; }
    const form = document.createElement('form');
    const label = el('label', 'Your answer');
    const input = document.createElement('textarea');
    input.id = `answer-${item.id}`; label.htmlFor = input.id;
    input.className = 'field-input'; input.required = true; input.maxLength = 2000;
    input.addEventListener('input', () => { dirty = true; });
    const options = el('div', '', 'handoff-options');
    for (const option of item.options) {
      const button = el('button', option, 'button secondary'); button.type = 'button';
      button.onclick = () => { input.value = option; dirty = true; input.focus(); }; options.append(button);
    }
    const save = el('button', 'Save answer', 'button primary'); save.type = 'submit';
    const message = el('p', 'Saving an answer does not launch or publish anything.'); message.setAttribute('role', 'status');
    form.append(label, options, input, save, message);
    form.onsubmit = async event => {
      event.preventDefault(); save.disabled = true;
      try {
        const response = await fetch(`/api/handoff/decisions/${encodeURIComponent(item.id)}/answer`, {
          method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({answer: input.value}),
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error();
        const saved = await response.json();
        card.replaceWith(decision(saved));
        dirty = [...host.querySelectorAll('textarea')].some(field => field.value.trim());
      } catch { message.textContent = 'Could not confirm the save. Your text is retained. Refresh to check before retrying.'; }
      finally { save.disabled = false; }
    };
    card.append(form); return card;
  }
  async function activate() {
    if (loading || dirty) return;
    loading = true; refresh.disabled = true; status.textContent = 'Loading your handoff…';
    try {
      const response = await fetch('/api/handoff', {cache:'no-store', signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error();
      const data = await response.json();
      host.replaceChildren();
      const open = data.decisions.filter(d => d.status === 'open');
      const summary = el('div', '', 'experiment-checks');
      summary.append(el('span', `${open.length} decisions for you`), el('span', data.active_mission_id ? 'Mission running' : 'No mission running'), el('span', `$${data.recorded_estimate_usd.toFixed(4)} recorded estimate · 24h`));
      if (data.unresolved_calls) summary.append(el('span', `${data.unresolved_calls} calls with unresolved cost`));
      host.append(summary, el('h2', 'Needs Theodore'));
      if (!open.length) host.append(el('p', 'Nothing needs your decision. Routine investigation can continue.'));
      for (const item of open) host.append(decision(item));
      host.append(el('h2', 'Reviewed progress'));
      if (!data.progress.length) host.append(el('p', 'No coordinator progress notes recorded in the last 24 hours.'));
      for (const item of data.progress) {
        const card = el('article', '', 'experiment-card');
        card.append(el('h3', item.title), el('p', item.summary), el('p', new Date(item.created_at).toLocaleString(), 'experiment-meta'));
        evidence(card, item.evidence); host.append(card);
      }
      host.append(el('h2', 'Mission activity · last 24 hours'), el('p', 'Mission completion is not proof of a validated finding. Failures below are for coordinator triage.'));
      if (!data.missions.length) host.append(el('p', 'No mission activity in this window.'));
      for (const item of data.missions) {
        const card = el('article', '', 'experiment-card');
        card.append(el('p', `${item.mode} · ${item.status}`, 'eyebrow'), el('h3', item.title), el('p', item.summary || 'No summary yet.'), el('p', item.id, 'experiment-meta')); host.append(card);
      }
      const history = el('details', ''); history.append(el('summary', 'Answered decisions'));
      for (const item of data.decisions.filter(d => d.status !== 'open')) history.append(decision(item));
      host.append(history); status.textContent = `${data.note} Updated ${new Date(data.generated_at).toLocaleString()}.`;
    } catch { status.textContent = 'The handoff could not be loaded. Retry with Refresh; saved records are unchanged.'; }
    finally { loading = false; refresh.disabled = false; }
  }
  refresh.onclick = () => {
    if (dirty) { status.textContent = 'Save your draft answers before refreshing.'; return; }
    activate();
  };
  window.sigilHandoff = {activate};
})();
