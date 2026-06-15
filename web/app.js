'use strict';

const PERSONA_NAME = { variant1: 'Enablement & L&D', variant2: 'Customer Education' };

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
function scoreBox(label, value, isRec) {
  return el('div', { class: 'score' + (isRec ? ' is-rec' : '') }, [
    el('div', { class: 'score-label' }, [
      el('span', { text: label }),
      isRec ? el('span', { class: 'check', text: '✓' }) : null,
    ]),
    el('div', { class: 'score-val' + (value == null || value === '' ? ' na' : ''), text: fmt(value) }),
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
    job.status === 'applied' ? el('span', { class: 'applied-badge', text: 'Applied' }) : null,
  ]));

  card.append(el('div', { class: 'card-links' }, [
    job.source ? el('span', { class: 'chip', text: job.source }) : null,
    job.url ? el('a', { class: 'posting-link', href: job.url, target: '_blank', rel: 'noopener', text: 'View posting ↗' }) : null,
  ]));

  card.append(el('div', { class: 'scores' }, [
    scoreBox(PERSONA_NAME.variant1, job.variant1_score, rec === 'variant1'),
    scoreBox(PERSONA_NAME.variant2, job.variant2_score, rec === 'variant2'),
  ]));

  if (job.status === 'applied') {
    const appliedActions = el('div', { class: 'card-actions' });
    const folderBtn = el('button', { class: 'btn-ghost', type: 'button', text: 'Open folder' });
    folderBtn.addEventListener('click', () => openFolder(job, folderBtn));
    appliedActions.append(folderBtn);
    card.append(appliedActions);
    return card;
  }

  // Already prepped (full-JD rescore done): render the saved apply panel directly so it
  // persists across reloads without re-prepping.
  if (job.status === 'prepped') {
    renderPrepPanel(job, card, job.recommended_persona || 'variant1');
    return card;
  }

  const actions = el('div', { class: 'card-actions' });
  const prepBtn = el('button', { class: 'btn-primary', type: 'button', text: 'Prep to apply' });
  prepBtn.addEventListener('click', () => prepToApply(job, card, prepBtn));
  actions.append(prepBtn);

  const delBtn = el('button', { class: 'btn-delete', type: 'button', text: 'Delete' });
  delBtn.addEventListener('click', () => deleteJob(job, card, delBtn));
  actions.append(delBtn);

  card.append(actions);

  return card;
}

async function deleteJob(job, card, btn) {
  const label = job.company || job.title || 'this job';
  if (!window.confirm(`Delete ${label} from the inbox? This can't be undone.`)) return;
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  const data = await api(`/api/inbox/${encodeURIComponent(job.job_id)}`, { method: 'DELETE' });
  if (data.ok) {
    deletedIds.add(job.job_id);
    card.remove();
    toast(`Deleted: ${label}`);
    $('#inbox-empty').hidden = $('#inbox-list').children.length > 0 || $('#applied-list').children.length > 0;
  } else {
    btn.disabled = false;
    btn.textContent = 'Delete';
    toast(data.error || 'Could not delete.');
  }
}

async function prepToApply(job, card, btn, persona) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Preparing…';
  try {
    const opts = persona
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona }) }
      : { method: 'POST' };
    const data = await api(`/api/apply/${encodeURIComponent(job.job_id)}`, opts);

    if (data.needs_bookmarklet || data.result === 'needs_bookmarklet') {
      btn.disabled = false;
      btn.textContent = 'Prep to apply';
      showBookmarkletNote(card);
      return;
    }
    if (!data.ok) {
      btn.disabled = false;
      btn.textContent = 'Prep to apply';
      toast(data.error || 'Could not prep this one.');
      return;
    }
    renderPrepPanel(job, card, data.recommended_persona || persona || job.recommended_persona);
  } catch (_e) {
    btn.disabled = false;
    btn.textContent = 'Prep to apply';
    toast('Network error preparing this job.');
  }
}

function showBookmarkletNote(card) {
  let note = card.querySelector('.bm-note');
  if (note) return;
  note = el('p', { class: 'note is-warn bm-note', html:
    'This site needs the bookmarklet to grab the description. ' +
    '<a href="/bookmarklet/install" target="_blank" rel="noopener">Install it</a>, open the posting, and click it.' });
  card.append(note);
}

function renderPrepPanel(job, card, persona) {
  card.querySelectorAll('.card-actions, .prep, .bm-note').forEach((n) => n.remove());
  const id = encodeURIComponent(job.job_id);
  const other = persona === 'variant1' ? 'variant2' : 'variant1';

  const prep = el('div', { class: 'prep' });
  prep.append(el('p', { class: 'prep-rec', html: `Recommended persona: <strong>${PERSONA_NAME[persona] || persona}</strong>` }));

  prep.append(el('div', { class: 'prep-actions' }, [
    el('a', { class: 'btn-ghost', href: `/api/resume/${id}`, target: '_blank', rel: 'noopener', text: 'Open resume' }),
    el('a', { class: 'btn-ghost', href: `/api/cover-letter/${id}`, target: '_blank', rel: 'noopener', text: 'Open cover letter' }),
    (() => {
      const b = el('button', { class: 'btn-ghost', type: 'button', text: 'Open folder' });
      b.addEventListener('click', () => openFolder(job, b));
      return b;
    })(),
    (() => {
      const b = el('button', { class: 'btn-primary', type: 'button', text: 'Mark applied' });
      b.addEventListener('click', () => markApplied(job, card, b));
      return b;
    })(),
  ]));

  prep.append(el('p', { class: 'swap-hint', text: 'Swap suggestions for this ATS live in the resume tab’s sidebar.' }));

  const toggle = el('div', { class: 'persona-toggle' }, [el('span', { text: 'Wrong fit?' })]);
  const swap = el('button', { type: 'button', text: `Use ${PERSONA_NAME[other]}` });
  swap.addEventListener('click', () => {
    prep.remove();
    const actions = el('div', { class: 'card-actions' });
    const b = el('button', { class: 'btn-primary', type: 'button', text: 'Prep to apply' });
    actions.append(b);
    card.append(actions);
    prepToApply(job, card, b, other);
  });
  toggle.append(swap);

  const delBtn = el('button', { class: 'btn-delete', type: 'button', text: 'Delete' });
  delBtn.addEventListener('click', () => deleteJob(job, card, delBtn));
  toggle.append(delBtn);

  prep.append(toggle);

  card.append(prep);
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
    const lines = [`Marked applied: ${job.company || job.title || 'job'}`];
    if (data.archived) lines.push('JD + notes saved to your archive folder.');
    toast(lines);
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
  const active = jobs.filter((j) => j.status !== 'applied');
  const applied = jobs.filter((j) => j.status === 'applied');

  const list = $('#inbox-list');
  list.innerHTML = '';
  active.forEach((j) => list.append(renderJobCard(j)));
  $('#inbox-empty').hidden = active.length > 0 || applied.length > 0;

  const appliedList = $('#applied-list');
  appliedList.innerHTML = '';
  applied.forEach((j) => appliedList.append(renderJobCard(j)));
  $('#applied-wrap').hidden = applied.length === 0;
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

// ---- SCAN --------------------------------------------------------------------
async function onScan() {
  const btn = $('#scan-btn');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Scanning…';
  try {
    const data = await api('/api/scan-inbox', { method: 'POST' });
    const updated = data.updated || [];
    const lines = [`Scanned ${data.scanned ?? 0}, updated ${updated.length}`];
    updated.slice(0, 4).forEach((u) => lines.push(`${u.company}: ${u.from} → ${u.to}`));
    if (updated.length > 4) lines.push(`+${updated.length - 4} more`);
    const review = (data.needs_review || []).length;
    if (review) lines.push(`${review} need review`);
    toast(lines);
    loadInbox();
  } catch (_e) {
    toast('Scan failed.');
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
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
  $('#scan-btn').addEventListener('click', onScan);
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
