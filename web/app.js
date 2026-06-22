'use strict';

const PERSONA_NAME = {
  variant1: 'GTM Enablement',
  variant2: 'Customer Education',
  variant3: 'AI Adoption',
};
const PERSONA_ORDER = ['variant1', 'variant2', 'variant3'];

// Jobs deleted this session. A focus-triggered reload can race ahead of the sheet's
// read-after-write lag and resurrect a just-deleted card; filter those out until reload.
const deletedIds = new Set();

// ---- tiny DOM helpers --------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c != null) n.append(c);
  return n;
}
const fmt = (n) => (n == null || n === '' || Number.isNaN(Number(n)) ? '--' : Number(n).toFixed(1));

async function api(path, opts) {
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch (_e) { /* non-json */ }
  return data;
}

let toastTimer = null;
function toast(lines) {
  const t = $('#toast');
  t.innerHTML = '';
  for (const line of [].concat(lines)) t.append(el('span', { class: 'toast-line', text: line }));
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => { t.hidden = true; }, 250);
  }, 5000);
}

// ---- view switching ----------------------------------------------------------
function showView(name) {
  $('#view-inbox').hidden = name !== 'inbox';
  $('#view-discover').hidden = name !== 'discover';
  $('#view-setup').hidden = name !== 'setup';
  $('.capture').hidden = name !== 'inbox';
  $('#tab-inbox').classList.toggle('is-active', name === 'inbox');
  $('#tab-discover').classList.toggle('is-active', name === 'discover');
  $('#tab-setup').classList.toggle('is-active', name === 'setup');
}

// ---- INBOX -------------------------------------------------------------------
function scoreRow(persona, score, reason, isRec) {
  return el('div', { class: 'score' + (isRec ? ' is-rec' : '') }, [
    el('div', { class: 'score-top' }, [
      el('div', { class: 'score-label' }, [
        el('span', { text: PERSONA_NAME[persona] || persona }),
        isRec ? el('span', { class: 'rec-tag', text: 'recommended' }) : null,
      ]),
      el('div', { class: 'score-val' + (score == null || score === '' ? ' na' : ''), text: fmt(score) }),
    ]),
    reason ? el('p', { class: 'score-reason', text: String(reason) }) : null,
  ]);
}

function renderJobCard(job) {
  const card = el('div', { class: 'card', 'data-id': job.job_id });
  const rec = job.recommended_persona;

  card.append(el('div', { class: 'card-head' }, [
    el('div', {}, [
      el('h3', { class: 'card-company', text: job.company || 'Unknown company' }),
      el('p', { class: 'card-title', text: job.title || '' }),
    ]),
  ]));

  card.append(el('div', { class: 'card-links' }, [
    job.source ? el('span', { class: 'chip', text: job.source }) : null,
    job.url ? el('a', { class: 'posting-link', href: job.url, target: '_blank', rel: 'noopener', text: 'View posting ↗' }) : null,
  ]));

  card.append(el('div', { class: 'scores' }, PERSONA_ORDER.map((p) =>
    scoreRow(p, job[`${p}_score`], job[`${p}_reason`], rec === p),
  )));

  if (job.status === 'prepped') {
    renderPrepPanel(job, card, job.selected_persona || rec || 'variant1');
    return card;
  }

  // status === 'scored' (or anything pre-selection): pick a persona or reject.
  card.append(renderPickPanel(job, card));
  return card;
}

function renderPickPanel(job, card) {
  const pick = el('div', { class: 'pick' });
  const rec = job.recommended_persona;

  // All three scores zero/blank means the capture had no real JD (cookie banner, careers
  // shell). Surface the paste-and-rescore affordance so it can be fixed without re-capturing.
  if (PERSONA_ORDER.every((p) => !Number(job[`${p}_score`]))) pick.append(pasteJdBlock(job));

  const choices = el('div', { class: 'pick-choices' }, PERSONA_ORDER.map((p) => {
    const b = el('button', {
      class: 'pick-btn' + (rec === p ? ' is-rec' : ''),
      type: 'button',
      text: PERSONA_NAME[p],
    });
    b.addEventListener('click', () => selectPersona(job, card, p));
    return b;
  }));
  pick.append(el('p', { class: 'pick-label', text: 'Apply with' }), choices);

  const rejectBtn = el('button', { class: 'btn-delete', type: 'button', text: 'Reject' });
  rejectBtn.addEventListener('click', () => rejectJob(job, card, rejectBtn));
  pick.append(el('div', { class: 'pick-foot' }, [rejectBtn]));

  return pick;
}

// Inline "paste the JD and re-score" affordance for cards whose capture had no real description.
function pasteJdBlock(job) {
  const wrap = el('div', { class: 'paste-jd' });
  const note = el('p', { class: 'paste-jd-note', text: 'No job description was captured. Paste it to score the personas.' });
  const openBtn = el('button', { class: 'btn-ghost', type: 'button', text: 'Paste job description' });
  openBtn.addEventListener('click', () => {
    const ta = el('textarea', { class: 'paste-jd-input', placeholder: 'Paste the full job description here…' });
    const save = el('button', { class: 'btn-primary', type: 'button', text: 'Score it' });
    const cancel = el('button', { class: 'btn-ghost', type: 'button', text: 'Cancel' });
    const hint = el('span', { class: 'paste-jd-hint' });
    const editor = el('div', { class: 'paste-jd-editor' }, [ta, el('div', { class: 'paste-jd-actions' }, [save, cancel, hint])]);
    wrap.replaceChild(editor, openBtn);
    ta.focus();
    cancel.addEventListener('click', () => wrap.replaceChild(openBtn, editor));
    save.addEventListener('click', () => pasteJd(job, ta, save, hint));
  });
  wrap.append(note, openBtn);
  return wrap;
}

async function pasteJd(job, ta, btn, hint) {
  const text = (ta.value || '').trim();
  if (text.length < 300) { hint.textContent = 'That looks too short - paste the full description.'; ta.focus(); return; }
  hint.textContent = '';
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-dark"></span>Scoring…';
  const data = await api(`/api/score/${encodeURIComponent(job.job_id)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text }),
  });
  if (data.ok) {
    toast(`Scored: ${job.company || job.title || 'job'}`);
    loadInbox();
  } else {
    btn.disabled = false;
    btn.textContent = 'Score it';
    hint.textContent = data.error || 'Could not score.';
  }
}

async function rejectJob(job, card, btn) {
  const label = job.company || job.title || 'this job';
  if (!window.confirm(`Reject ${label}? It leaves the inbox.`)) return;
  btn.disabled = true;
  btn.textContent = 'Rejecting…';
  const data = await api(`/api/reject/${encodeURIComponent(job.job_id)}`, { method: 'POST' });
  if (data.ok) {
    deletedIds.add(job.job_id);
    toast(`Rejected: ${label}`);
    loadInbox();
  } else {
    btn.disabled = false;
    btn.textContent = 'Reject';
    toast(data.error || 'Could not reject.');
  }
}

async function selectPersona(job, card, persona) {
  const pick = card.querySelector('.pick');
  pick.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  const chosen = pick.querySelector(`.pick-btn:nth-of-type(${PERSONA_ORDER.indexOf(persona) + 1})`);
  if (chosen) chosen.innerHTML = '<span class="spinner spinner-dark"></span>' + PERSONA_NAME[persona];
  try {
    const data = await api(`/api/select/${encodeURIComponent(job.job_id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona }),
    });
    if (!data.ok) {
      pick.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      if (chosen) chosen.textContent = PERSONA_NAME[persona];
      toast(data.error || 'Could not select this persona.');
      return;
    }
    if (data.resume_url) window.open(data.resume_url, '_blank', 'noopener');
    if (data.cover_letter_url) window.open(data.cover_letter_url, '_blank', 'noopener');
    job.selected_persona = data.persona || persona;
    job.status = 'prepped';
    pick.remove();
    renderPrepPanel(job, card, job.selected_persona);
  } catch (_e) {
    pick.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    if (chosen) chosen.textContent = PERSONA_NAME[persona];
    toast('Network error selecting this persona.');
  }
}

function renderPrepPanel(job, card, persona) {
  card.querySelectorAll('.pick, .prep').forEach((n) => n.remove());

  const prep = el('div', { class: 'prep' });
  prep.append(el('p', { class: 'prep-rec', html: `Applying as <strong>${PERSONA_NAME[persona] || persona}</strong>` }));

  // Re-open the selected persona's docs (in case the tabs were closed).
  prep.append(el('p', { class: 'prep-docs' }, [
    el('span', { class: 'prep-docs-label', text: 'Reopen: ' }),
    el('a', { class: 'doc-link', href: `/api/resume/${job.job_id}`, target: '_blank', rel: 'noopener', text: 'Resume ↗' }),
    el('span', { class: 'doc-sep', text: ' · ' }),
    el('a', { class: 'doc-link', href: `/api/cover-letter/${job.job_id}`, target: '_blank', rel: 'noopener', text: 'Cover letter ↗' }),
  ]));

  prep.append(el('div', { class: 'prep-actions' }, [
    (() => {
      const b = el('button', { class: 'btn-primary', type: 'button', text: 'Mark applied' });
      b.addEventListener('click', () => markApplied(job, card, b));
      return b;
    })(),
    (() => {
      const b = el('button', { class: 'btn-ghost', type: 'button', text: 'Help with questions' });
      b.addEventListener('click', () => helpWithQuestions(job, b));
      return b;
    })(),
    (() => {
      const b = el('button', { class: 'btn-ghost', type: 'button', text: 'Open folder' });
      b.addEventListener('click', () => openFolder(job, b));
      return b;
    })(),
    (() => {
      const b = el('button', { class: 'btn-delete', type: 'button', text: 'Did not apply' });
      b.addEventListener('click', () => didNotApply(job, card, b));
      return b;
    })(),
  ]));

  card.append(prep);
}

async function helpWithQuestions(job, btn) {
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Starting…';
  const data = await api(`/api/help-questions/${encodeURIComponent(job.job_id)}`, { method: 'POST' });
  btn.disabled = false;
  btn.textContent = prev;
  if (data.ok) toast('Opened a Claude terminal to help with the application questions.');
  else toast(data.error || 'Could not start the helper.');
}

async function didNotApply(job, card, btn) {
  const label = job.company || job.title || 'this job';
  if (!window.confirm(`Mark ${label} as not applied? It leaves the inbox.`)) return;
  const note = window.prompt('Optional note (why not):', '') || '';
  btn.disabled = true;
  btn.textContent = 'Saving…';
  const data = await api(`/api/did-not-apply/${encodeURIComponent(job.job_id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason_note: note }),
  });
  if (data.ok) {
    deletedIds.add(job.job_id);
    toast(`Did not apply: ${label}`);
    loadInbox();
  } else {
    btn.disabled = false;
    btn.textContent = 'Did not apply';
    toast(data.error || 'Could not save.');
  }
}

async function openFolder(job, btn) {
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Opening…';
  const data = await api(`/api/open-folder/${encodeURIComponent(job.job_id)}`, { method: 'POST' });
  btn.disabled = false;
  btn.textContent = prev;
  if (!data.ok) toast(data.error || 'Could not open the archive folder.');
}

async function markApplied(job, card, btn) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Saving…';
  const data = await api(`/api/applied/${encodeURIComponent(job.job_id)}`, { method: 'POST' });
  if (data.ok) {
    deletedIds.add(job.job_id);
    toast(`Marked applied: ${job.company || job.title || 'job'}`);
    loadInbox();
  } else {
    btn.disabled = false;
    btn.textContent = 'Mark applied';
    toast(data.error || 'Could not mark applied.');
  }
}

async function loadInbox() {
  const data = await api('/api/inbox');
  const jobs = (data.jobs || []).filter((j) => !deletedIds.has(j.job_id));

  const list = $('#inbox-list');
  list.innerHTML = '';
  jobs.forEach((j) => list.append(renderJobCard(j)));
  $('#inbox-empty').hidden = jobs.length > 0;
}

// ---- CAPTURE -----------------------------------------------------------------
async function onCapture(e) {
  e.preventDefault();
  const input = $('#paste-url');
  const btn = $('#capture-btn');
  const note = $('#capture-note');
  const url = input.value.trim();
  if (!url) return;

  note.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Adding…';
  try {
    const data = await api('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, source: 'mobile' }),
    });
    if (data.error && !data.ok) {
      note.className = 'note is-warn';
      note.textContent = data.error;
      note.hidden = false;
    } else if (data.needs_bookmarklet) {
      note.className = 'note is-warn';
      note.innerHTML = 'Added, but this site needs the bookmarklet to read the description. ' +
        '<a href="/bookmarklet/install" target="_blank" rel="noopener">Install it</a>, then open the posting and click it.';
      note.hidden = false;
      input.value = '';
      loadInbox();
    } else {
      input.value = '';
      note.hidden = true;
      loadInbox();
    }
  } catch (_e) {
    note.className = 'note is-warn';
    note.textContent = 'Could not reach the server.';
    note.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add';
  }
}

// ---- DISCOVER ----------------------------------------------------------------
async function onDiscover(e) {
  e.preventDefault();
  const source = $('#discover-source').value;
  const q = $('#discover-q').value.trim();
  const statusEl = $('#discover-status');
  const list = $('#discover-list');

  statusEl.className = 'note';
  statusEl.textContent = 'Browsing…';
  statusEl.hidden = false;
  list.innerHTML = '';

  const params = new URLSearchParams({ source });
  if (q) params.set('q', q);
  const data = await api(`/api/discover?${params.toString()}`);
  const jobs = data.jobs || [];

  if (data.error) {
    statusEl.className = 'note is-warn';
    statusEl.textContent = 'Source unavailable. Try another.';
    statusEl.hidden = false;
    return;
  }
  if (jobs.length === 0) {
    statusEl.className = 'note';
    statusEl.textContent = 'No results.';
    statusEl.hidden = false;
    return;
  }
  statusEl.hidden = true;
  jobs.forEach((j) => list.append(renderDiscoverRow(j)));
}

function renderDiscoverRow(job) {
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'card-head' }, [
    el('div', {}, [
      el('h3', { class: 'card-company', text: job.company || 'Unknown company' }),
      el('p', { class: 'card-title', text: job.title || '' }),
    ]),
  ]));
  card.append(el('div', { class: 'card-links' }, [
    job.source ? el('span', { class: 'chip', text: job.source }) : null,
    job.url ? el('a', { class: 'posting-link', href: job.url, target: '_blank', rel: 'noopener', text: 'View posting ↗' }) : null,
  ]));
  if (job.jd_snippet) {
    const snip = String(job.jd_snippet);
    card.append(el('p', { class: 'disc-snippet', text: snip.length > 280 ? snip.slice(0, 280) + '…' : snip }));
  }
  if (job.posted_at) card.append(el('p', { class: 'disc-meta', text: `Posted ${job.posted_at}` }));

  const actions = el('div', { class: 'card-actions' });
  const btn = el('button', { class: 'btn-ghost', type: 'button', text: 'Send to Inbox' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Sending…';
    const data = await api('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: job.url, source: 'discover', title: job.title, company: job.company }),
    });
    if (data.ok || data.job_id) {
      btn.textContent = 'Sent ✓';
      loadInbox();
    } else {
      btn.disabled = false;
      btn.textContent = 'Send to Inbox';
      toast(data.error || 'Could not send.');
    }
  });
  actions.append(btn);
  card.append(actions);
  return card;
}

// ---- menu --------------------------------------------------------------------
function setupMenu() {
  const btn = $('#resumes-btn');
  const pop = $('#resumes-menu');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) {
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

// Pull the current bookmarklet href off the install page so the Setup tab's draggable
// link always matches what gen-bookmarklet.mjs last produced (single source of truth).
async function loadSetupBookmarklet() {
  const link = $('#setup-bookmarklet');
  if (!link) return;
  try {
    const res = await fetch('/bookmarklet/install');
    const html = await res.text();
    const m = html.match(/href="(javascript:[^"]*)"/);
    if (m) link.setAttribute('href', m[1].replace(/&amp;/g, '&'));
  } catch (_e) { /* leave the fallback href to the install page */ }
}

// ---- boot --------------------------------------------------------------------
function init() {
  $('#tab-inbox').addEventListener('click', () => showView('inbox'));
  $('#tab-discover').addEventListener('click', () => showView('discover'));
  $('#tab-setup').addEventListener('click', () => showView('setup'));
  $('#capture-form').addEventListener('submit', onCapture);
  $('#discover-form').addEventListener('submit', onDiscover);
  setupMenu();
  loadSetupBookmarklet();

  window.addEventListener('focus', () => {
    // Don't rebuild cards (and blow away an in-progress prep/apply panel) on refocus.
    if (document.querySelector('.prep') || document.querySelector('.spinner')) return;
    loadInbox();
  });
  if (typeof BroadcastChannel === 'function') {
    const bc = new BroadcastChannel('jobbuddy');
    bc.addEventListener('message', (ev) => {
      if (ev.data && ev.data.type === 'jd-captured') loadInbox();
    });
  }

  showView('inbox');
  loadInbox();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
