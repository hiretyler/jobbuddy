import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { findRow } from '../sheets.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const PERSONAS_DIR = join(__dirname, '..', '..', 'assets', 'personas');

const VARIANT_FILES = {
  variant1: 'variant1_gtm_enablement.html',
  variant2: 'variant2_customer_education.html',
};

// Captured posting titles arrive as "Role | Company | Source" (e.g.
// "AI Enablement & Adoption Manager | Nimble Gravity | LinkedIn"). The resume's
// job-title-header should show only the role - not the company or JD source.
function roleOnly(title) {
  return String(title || '').split('|')[0].trim();
}

function buildAtsSwapSidebarHtml(jobId) {
  return `
<aside class="applysprint-sidebar" id="applysprint-sidebar">
  <div class="sidebar-header">
    <strong>ATS swap recommendations</strong>
    <button type="button" class="sidebar-close" aria-label="Hide">x</button>
  </div>
  <div class="sidebar-body" id="ats-swap-body">
    <button type="button" class="ats-swap-trigger" id="ats-swap-trigger">Show ATS swap recommendations</button>
  </div>
</aside>

<script>
(function () {
  var sidebar = document.getElementById('applysprint-sidebar');
  if (!sidebar) return;
  var jobId = ${JSON.stringify(String(jobId))};

  sidebar.addEventListener('click', function (e) {
    if (e.target.closest('.sidebar-close')) {
      sidebar.style.display = 'none';
      return;
    }
    var trigger = e.target.closest('#ats-swap-trigger, #ats-swap-retry');
    if (trigger) {
      if (trigger.disabled) return;
      trigger.disabled = true;
      fetchSwaps();
      return;
    }
    var copyBtn = e.target.closest('button[data-action="copy-with"]');
    if (copyBtn) {
      var text = copyBtn.getAttribute('data-text') || '';
      navigator.clipboard.writeText(text).then(function () {
        flash(copyBtn, 'copied');
      }).catch(function () { flash(copyBtn, 'copy failed'); });
      return;
    }
    var applyBulletBtn = e.target.closest('button[data-action="apply-bullet"]');
    if (applyBulletBtn) {
      var ok = applyBulletSwap(
        applyBulletBtn.getAttribute('data-replace') || '',
        applyBulletBtn.getAttribute('data-with') || '',
        applyBulletBtn.getAttribute('data-role') || ''
      );
      markApplied(applyBulletBtn, ok);
      return;
    }
    var applySkillBtn = e.target.closest('button[data-action="apply-skill"]');
    if (applySkillBtn) {
      var okSkill = applySkillSwap(
        applySkillBtn.getAttribute('data-remove') || '',
        applySkillBtn.getAttribute('data-add') || ''
      );
      markApplied(applySkillBtn, okSkill);
      return;
    }
  });

  function norm(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }

  // One-click apply: edit the contenteditable resume in place so Cmd+P captures the swap.
  // Swaps are within-job only: when a role is supplied, the replaced bullet must live under
  // that company's experience-item, so a Simpro bullet can never land in the KarmaCheck list.
  function applyBulletSwap(replaceText, withText, role) {
    var want = norm(replaceText);
    if (!want) return false;
    var scopes;
    if (role) {
      scopes = [];
      var wantCompany = norm(role).toLowerCase();
      var items = document.querySelectorAll('.resume-container .experience-item');
      for (var k = 0; k < items.length; k++) {
        var cr = items[k].querySelector('.company-role');
        var company = cr ? norm(cr.textContent).split('|')[0].trim().toLowerCase() : '';
        if (company === wantCompany) scopes.push(items[k]);
      }
      if (!scopes.length) return false; // role given but no matching company section
    } else {
      scopes = [document];
    }
    for (var s = 0; s < scopes.length; s++) {
      var lis = scopes[s].querySelectorAll('ul.achievements li');
      for (var i = 0; i < lis.length; i++) {
        if (norm(lis[i].textContent) === want) {
          lis[i].textContent = withText;
          return true;
        }
      }
    }
    return false;
  }

  function applySkillSwap(removeText, addText) {
    var container = document.querySelector('.resume-container .skills-container');
    if (!container) return false;
    var tokens = norm(container.textContent).split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    var target = norm(removeText);
    var idx = -1;
    for (var i = 0; i < tokens.length; i++) {
      if (norm(tokens[i]) === target) { idx = i; break; }
    }
    if (idx === -1) return false;
    tokens[idx] = String(addText).trim();
    // Keep the skills line alphabetized after the swap (it ships sorted).
    tokens.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
    container.textContent = tokens.join(', ');
    return true;
  }

  function markApplied(btn, ok) {
    if (!ok) { flash(btn, 'not found'); return; }
    btn.textContent = 'applied';
    btn.disabled = true;
    btn.classList.add('swap-applied');
  }

  function flash(btn, label) {
    var orig = btn.textContent;
    btn.textContent = label;
    btn.disabled = true;
    setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 1100);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setBody(html) {
    var body = document.getElementById('ats-swap-body');
    if (body) body.innerHTML = html;
  }

  function renderError() {
    setBody(
      '<p class="swap-error">ATS swap recommendation service unavailable.</p>' +
      '<button type="button" class="ats-swap-trigger" id="ats-swap-retry">Retry</button>'
    );
  }

  function renderResults(data) {
    var bulletSwaps = Array.isArray(data && data.bullet_swaps) ? data.bullet_swaps : [];
    var skillSwaps = Array.isArray(data && data.skill_swaps) ? data.skill_swaps : [];

    if (!bulletSwaps.length && !skillSwaps.length) {
      setBody('<p class="swap-empty">No high-confidence swap recommendations for this role.</p>');
      return;
    }

    var html = '';
    if (bulletSwaps.length) {
      html += '<section class="swap-section"><h4>Bullet swaps</h4><ul>';
      bulletSwaps.forEach(function (s) {
        var replaceText = String(s.replace || '');
        var withText = String(s.with || '');
        var reason = String(s.reason || '');
        var meta = [s.role, s.claim_level ? s.claim_level + '-level' : ''].filter(Boolean).join(' | ');
        html +=
          '<li class="swap-item">' +
            '<div class="swap-label">Replace</div>' +
            '<div class="swap-text">' + escapeHtml(replaceText) + '</div>' +
            '<div class="swap-label">With</div>' +
            '<div class="swap-text">' + escapeHtml(withText) + '</div>' +
            (meta ? '<div class="swap-meta">' + escapeHtml(meta) + '</div>' : '') +
            (reason ? '<div class="swap-reason">' + escapeHtml(reason) + '</div>' : '') +
            '<div class="swap-actions">' +
              '<button type="button" data-action="apply-bullet" data-replace="' + escapeHtml(replaceText) + '" data-with="' + escapeHtml(withText) + '" data-role="' + escapeHtml(String(s.role || '')) + '">Apply swap</button>' +
              '<button type="button" data-action="copy-with" data-text="' + escapeHtml(withText) + '">Copy "with"</button>' +
            '</div>' +
          '</li>';
      });
      html += '</ul></section>';
    }
    if (skillSwaps.length) {
      html += '<section class="swap-section"><h4>Skill swaps</h4><ul>';
      skillSwaps.forEach(function (s) {
        var removeText = String(s.remove || '');
        var addText = String(s.add || '');
        var reason = String(s.reason || '');
        html +=
          '<li class="swap-item">' +
            '<div class="swap-label">Remove</div>' +
            '<div class="swap-text">' + escapeHtml(removeText) + '</div>' +
            '<div class="swap-label">Add</div>' +
            '<div class="swap-text">' + escapeHtml(addText) + '</div>' +
            (reason ? '<div class="swap-reason">' + escapeHtml(reason) + '</div>' : '') +
            '<div class="swap-actions">' +
              '<button type="button" data-action="apply-skill" data-remove="' + escapeHtml(removeText) + '" data-add="' + escapeHtml(addText) + '">Apply swap</button>' +
            '</div>' +
          '</li>';
      });
      html += '</ul></section>';
    }
    setBody(html);
  }

  function fetchSwaps() {
    setBody(
      '<div class="swap-loading">' +
        '<div class="swap-spinner" aria-hidden="true"></div>' +
        '<div class="swap-loading-text">' +
          '<div class="swap-loading-primary">Asking Claude for ATS swap suggestions...</div>' +
          '<div class="swap-loading-secondary">Comparing the JD against your persona resume + master bank. Typically 15-45 seconds.</div>' +
          '<div class="swap-loading-elapsed" id="swap-elapsed">elapsed 0s</div>' +
        '</div>' +
      '</div>'
    );
    var startedAt = Date.now();
    var elapsedEl = document.getElementById('swap-elapsed');
    var elapsedTimer = setInterval(function () {
      var s = Math.floor((Date.now() - startedAt) / 1000);
      if (elapsedEl && elapsedEl.isConnected) {
        elapsedEl.textContent = 'elapsed ' + s + 's';
      } else {
        clearInterval(elapsedTimer);
      }
    }, 1000);
    function done() { clearInterval(elapsedTimer); }
    fetch('/api/ats-swap/' + encodeURIComponent(jobId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (data) {
      done();
      renderResults(data);
    }).catch(function () {
      done();
      renderError();
    });
  }
})();
</script>
`;
}

const SIDEBAR_CSS = `
  .applysprint-sidebar {
    position: fixed;
    top: 16px;
    right: 16px;
    width: 320px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    background: #fffbeb;
    border: 1px solid #d97706;
    border-radius: 6px;
    padding: 12px 14px;
    font: 13px/1.4 -apple-system, system-ui, sans-serif;
    box-shadow: 0 6px 18px rgba(0,0,0,0.12);
    z-index: 9999;
    color: #1f2937;
  }
  .applysprint-sidebar .sidebar-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 8px;
  }
  .applysprint-sidebar .sidebar-close {
    background: transparent; border: 0; font-size: 16px; line-height: 1;
    cursor: pointer; color: #92400e; padding: 0 4px;
  }
  .applysprint-sidebar .ats-swap-trigger {
    width: 100%; padding: 8px 10px; border: 1px solid #d97706;
    background: #fff; color: #92400e; border-radius: 4px; cursor: pointer;
    font-size: 12px;
  }
  .applysprint-sidebar .ats-swap-trigger:hover { background: #fef3c7; }
  .applysprint-sidebar .swap-empty,
  .applysprint-sidebar .swap-error {
    margin: 0 0 8px 0; font-size: 12px; color: #92400e;
  }
  .applysprint-sidebar .swap-loading {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 4px 0 8px 0;
  }
  .applysprint-sidebar .swap-spinner {
    flex: 0 0 auto;
    width: 16px; height: 16px;
    border: 2px solid #fde68a;
    border-top-color: #d97706;
    border-radius: 50%;
    animation: applysprint-spin 0.9s linear infinite;
    margin-top: 2px;
  }
  @keyframes applysprint-spin {
    to { transform: rotate(360deg); }
  }
  .applysprint-sidebar .swap-loading-text { flex: 1 1 auto; }
  .applysprint-sidebar .swap-loading-primary {
    font-size: 12px; color: #92400e; font-weight: 600;
  }
  .applysprint-sidebar .swap-loading-secondary {
    font-size: 11px; color: #6b7280; margin-top: 3px; line-height: 1.35;
  }
  .applysprint-sidebar .swap-loading-elapsed {
    font-size: 11px; color: #92400e; margin-top: 6px;
    font-variant-numeric: tabular-nums;
  }
  .applysprint-sidebar .swap-section { margin-bottom: 12px; }
  .applysprint-sidebar .swap-section h4 {
    margin: 0 0 6px 0; font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.04em; color: #92400e;
  }
  .applysprint-sidebar .swap-section ul { list-style: none; margin: 0; padding: 0; }
  .applysprint-sidebar .swap-item {
    border-top: 1px solid #fde68a;
    padding: 8px 0;
  }
  .applysprint-sidebar .swap-item:first-child { border-top: 0; }
  .applysprint-sidebar .swap-label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em;
    color: #92400e; margin-top: 4px;
  }
  .applysprint-sidebar .swap-text {
    font-size: 12px; color: #111; margin: 2px 0 4px 0;
  }
  .applysprint-sidebar .swap-meta {
    font-size: 10px; color: #92400e; margin-top: 3px;
    text-transform: uppercase; letter-spacing: 0.03em;
  }
  .applysprint-sidebar .swap-reason {
    font-size: 11px; color: #6b7280; font-style: italic; margin-top: 4px;
  }
  .applysprint-sidebar .swap-actions { margin-top: 6px; display: flex; gap: 6px; }
  .applysprint-sidebar .swap-actions button {
    font-size: 11px; padding: 3px 8px; border: 1px solid #d97706;
    background: #fff; color: #92400e; border-radius: 3px; cursor: pointer;
  }
  .applysprint-sidebar .swap-actions button:hover { background: #fef3c7; }
  .applysprint-sidebar .swap-actions button.swap-applied {
    background: #dcfce7; border-color: #16a34a; color: #166534; cursor: default;
  }

  .applysprint-banner {
    position: fixed; top: 16px; left: 16px;
    background: #ecfeff; border: 1px solid #0e7490; color: #155e75;
    padding: 6px 10px; border-radius: 4px; font: 12px/1.3 -apple-system, system-ui, sans-serif;
    z-index: 9999; display: flex; align-items: center; gap: 10px;
  }
  .banner-enable, .banner-revert {
    font-size: 11px; padding: 3px 8px; border: 1px solid #0e7490;
    background: #fff; color: #0e7490; border-radius: 3px; cursor: pointer;
  }
  .banner-enable:hover, .banner-revert:hover { background: #ecfeff; }
  .resume-container[contenteditable="true"]:focus { outline: 2px solid #0e7490; outline-offset: 4px; }

  @media print {
    .applysprint-sidebar,
    .applysprint-banner { display: none !important; }
    .resume-container[contenteditable="true"]:focus { outline: 0; }
  }
`;

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Wraps a persona resume in the editable interface (read-only banner + "Enable editing"
// button that flips contenteditable on directly). job is optional: when present we tailor the title/job-title-header and
// attach the ATS-swap sidebar; when null (persona-only fallback) we render the canonical
// resume with no job-specific tailoring and no sidebar.
function buildResumeHtml({ personaHtml, job, job_id, withSidebar }) {
  const dom = new JSDOM(personaHtml);
  const doc = dom.window.document;

  const titleParts = ['Resume', 'Tyler Geddes'];
  if (job && job.company) titleParts.push(job.company);
  if (job && job.title) titleParts.push(job.title);
  const titleEl = doc.querySelector('title') || doc.createElement('title');
  titleEl.textContent = titleParts.join(' - ');
  if (!doc.querySelector('title')) doc.head.appendChild(titleEl);

  const styleTag = doc.createElement('style');
  styleTag.textContent = SIDEBAR_CSS;
  doc.head.appendChild(styleTag);

  const container = doc.querySelector('.resume-container');
  if (container) container.setAttribute('contenteditable', 'false');

  if (job && job.title) {
    const titleHeader = doc.querySelector('.job-title-header');
    if (titleHeader) titleHeader.textContent = roleOnly(job.title);
  }

  {
    const banner = doc.createElement('div');
    banner.className = 'applysprint-banner';
    banner.id = 'applysprint-banner';
    banner.innerHTML =
      `<span id="applysprint-banner-text">Read-only. Cmd+P to print.</span>` +
      `<button type="button" class="banner-enable" id="banner-enable">Enable editing</button>`;
    doc.body.insertBefore(banner, doc.body.firstChild);

    const editScript = doc.createElement('script');
    editScript.textContent = `
(function () {
  var banner = document.getElementById('applysprint-banner');
  var bannerText = document.getElementById('applysprint-banner-text');
  var container = document.querySelector('.resume-container');

  document.addEventListener('click', function (e) {
    if (e.target.id === 'banner-enable') {
      enableEdit();
      return;
    }
    if (e.target.matches('.banner-revert')) {
      if (confirm('Discard your edits and reload the canonical resume?')) {
        location.reload();
      }
    }
  });

  function enableEdit() {
    if (container) container.setAttribute('contenteditable', 'true');
    if (banner) {
      banner.innerHTML =
        '<span>Editing enabled. Cmd+P to print.</span>' +
        '<button type="button" class="banner-revert">Revert</button>';
    }
    if (container && typeof container.focus === 'function') {
      try { container.focus(); } catch (e) {}
    }
  }
})();
`;
    doc.body.appendChild(editScript);
  }

  if (withSidebar && job_id) {
    const sidebar = doc.createRange().createContextualFragment(buildAtsSwapSidebarHtml(job_id));
    doc.body.appendChild(sidebar);
  }

  return dom.serialize();
}

router.get('/api/resume/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const job = await findRow('Inbox', 'job_id', job_id);
    if (!job) return res.status(404).send(`job not found: ${job_id}`);

    const variant = job.recommended_persona || 'variant1';
    const filename = VARIANT_FILES[variant] || VARIANT_FILES.variant1;
    const personaHtml = await readFile(join(PERSONAS_DIR, filename), 'utf8');

    const html = buildResumeHtml({ personaHtml, job, job_id, withSidebar: true });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// Persona-only fallback: editable canonical resume with no job tailoring and no ATS-swap
// sidebar. Used by the header "Open docs" dropdown so Tyler is never dead in the water when
// a job's Apply errors out.
router.get('/api/resume/persona/:variant', async (req, res, next) => {
  try {
    const { variant } = req.params;
    const filename = VARIANT_FILES[variant];
    if (!filename) return res.status(404).send(`unknown persona: ${variant}`);
    const personaHtml = await readFile(join(PERSONAS_DIR, filename), 'utf8');

    const html = buildResumeHtml({ personaHtml, job: null, job_id: null, withSidebar: false });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

export default router;
