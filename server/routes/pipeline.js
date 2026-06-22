// JobBuddy capture + score + apply pipeline.
//
// Pull-based: the user pushes a job in (bookmarklet / desktop / mobile paste /
// Discover click). Each captured job lands in the Inbox tab, gets scored, gets
// prepped on demand, and is promoted to the Applications tab on Apply.
//
// Endpoints (all default-exported on one router):
//   POST   /jd-capture          bookmarklet/desktop capture -> create Inbox row + full-JD 3-persona score
//   OPTIONS/jd-capture          CORS preflight
//   POST   /api/ingest          mobile paste / Discover click -> fetch JD + create row + full-JD 3-persona score
//   GET    /api/inbox           list inbox cards for the UI
//   POST   /api/score/:job_id   (re)run full-JD 3-persona scoring on a row
//   POST   /api/reject/:job_id  move to the Rejected tab + remove from Inbox
//   POST   /api/select/:job_id  pick a persona, flip to 'prepped', create the dated archive folder
//   POST   /api/applied/:job_id promote: write a clean Applications row (idempotent) + remove from Inbox
//   POST   /api/did-not-apply/:job_id  log the decision, file archive under "didnt apply", remove from Inbox
//   POST   /api/help-questions/:job_id prep the archive folder + open a Claude terminal there
//   POST   /api/open-folder/:job_id    reveal the dated archive folder in Finder

import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { readTab, findRow, appendRows, updateRow, deleteRow } from '../sheets.js';
import { canonicalIdentity } from '../identity.js';
import { scoreFullJd3 } from '../claude/subprocess.js';
import { fetchJdBody, isAuthWalled } from '../jd-prefetch.js';
import { ingestUrl } from '../manual.js';
import {
  archiveConfigured, writeApplicationArchive, applicationDir, openInFinder,
  moveApplicationDirToDidNotApply,
} from '../archive.js';
import {
  loadPersonaHtml, renderSplitDoc, RESUME_FILES, COVER_LETTER_FILES,
} from '../personas.js';
import { openTerminalWithClaude } from '../terminal.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const router = Router();

const MIN_BODY_CHARS = 300;

// --- CORS (bookmarklet posts cross-origin) -------------------------------------
function cors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

// --- helpers -------------------------------------------------------------------

const SOURCE_TAGS = new Set(['desktop', 'bookmarklet', 'mobile', 'discover']);
function normSource(s, fallback) {
  const v = String(s || '').toLowerCase();
  return SOURCE_TAGS.has(v) ? v : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

// M/D/YYYY to match the user's Applications-tab date format (no leading zeros).
function todayMDY() {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

const PERSONAS = new Set(['variant1', 'variant2', 'variant3']);
const PERSONA_LABELS = {
  variant1: 'GTM / Revenue Enablement',
  variant2: 'Customer Education',
  variant3: 'Internal Enablement (AI Adoption)',
};

// Locate + read the master bank JSON (the fuller career bank). Mirrors the contact.json
// precedent in personas.js: MASTER_BANK_PATH override, then secrets/, then the tracked example.
const MASTER_BANK_PATH = process.env.MASTER_BANK_PATH || join(REPO_ROOT, 'secrets', 'master-bank.json');
const MASTER_BANK_EXAMPLE = join(REPO_ROOT, 'assets', 'master-bank.example.json');
async function readMasterBank() {
  for (const p of [MASTER_BANK_PATH, MASTER_BANK_EXAMPLE]) {
    try {
      return await readFile(p, 'utf8');
    } catch { /* try the next source */ }
  }
  return null;
}

// Ensure the row has a usable JD body, reusing the same refetch-if-short fallback the old
// /api/apply had. Returns { ok, jdBody } on success or { ok:false, reason, ... } to relay.
async function ensureJdBody(row) {
  let jdBody = String(row.jd_body || '');
  if (jdBody.trim().length >= MIN_BODY_CHARS) return { ok: true, jdBody };
  if (isAuthWalled(row.url)) {
    return { ok: false, result: 'needs_bookmarklet', install_url: '/bookmarklet/install', reason: 'auth-walled' };
  }
  try {
    const fetched = await fetchJdBody(row.url);
    jdBody = fetched.body;
    await updateRow('Inbox', 'job_id', row.job_id, { jd_body: jdBody, jd_length: String(jdBody.length) });
    return { ok: true, jdBody };
  } catch (err) {
    const reason = err.code === 'AUTH_WALLED' ? 'auth-walled' : err.message;
    return { ok: false, result: 'needs_bookmarklet', install_url: '/bookmarklet/install', reason };
  }
}

// Hosts that are job boards or ATS vendors, not the hiring company.
const NON_COMPANY_HOSTS = [
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'myworkdayjobs.com', 'workday.com', 'icims.com',
  'eightfold.ai', 'linkedin.com', 'builtin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com',
  'wellfound.com', 'otta.com', 'dice.com', 'monster.com', 'linkedin.cn',
];
const JOB_BOARD_WORDS = new Set([
  'builtin', 'linkedin', 'indeed', 'glassdoor', 'ziprecruiter', 'wellfound', 'otta', 'dice',
  'monster', 'lever', 'greenhouse', 'ashby', 'workday', 'icims', 'eightfold', 'careers',
]);

// Validate/clean a candidate company name. Returns '' for junk (job boards, ATS vendors,
// region/location tokens like "AMER" or "US-Nationwide", page-title cruft).
function cleanCompany(name) {
  let n = String(name || '').replace(/\s+/g, ' ').trim();
  // Strip "... | Careers", "- Careers at X", trailing "Careers" noise.
  n = n.replace(/\s*[|–-]\s*careers\b.*$/i, '').replace(/\bcareers\s+at\b/i, '').trim();
  if (n.length < 2) return '';
  if (JOB_BOARD_WORDS.has(n.toLowerCase())) return '';
  // Pure region/location/remote tokens, or things that are clearly not a company.
  if (/^(amer|emea|apac|us|usa|uk|emea-apac|na|latam)$/i.test(n)) return '';
  if (/^(remote|anywhere|nationwide|us[\s-]?nationwide|worldwide|global)$/i.test(n)) return '';
  if (/nationwide|\bremote\b|^us[\s-]/i.test(n) && n.split(' ').length <= 3) return '';
  return n.slice(0, 80);
}

// Clean a captured job title: drop "| Company | Source" suffixes and reject junk titles
// (page-title cruft like "Application"). Returns '' when the title is unusable.
function cleanTitle(raw) {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();
  t = t.split(' | ')[0].trim(); // strip a trailing "| Company | LinkedIn"-style suffix
  t = t.replace(/\s*[-|–]\s*careers\b.*$/i, '').trim();
  if (t.length < 2) return '';
  if (/^(application|apply|apply now|careers?|job|jobs|untitled|home)$/i.test(t)) return '';
  return t.slice(0, 120);
}

// Derive a best-effort company name from title ("Role at Company"), then URL host, then body.
// This is only the initial guess; scoreRow replaces it with the JD-extracted name when scoring.
function deriveCompany({ title, url, body }) {
  const t = String(title || '');
  const m = t.match(/\bat\s+(.+?)(?:\s*[-|–]\s*.*)?$/i);
  if (m) { const c = cleanCompany(m[1]); if (c) return c; }
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (!NON_COMPANY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      const label = host.split('.')[0];
      const c = cleanCompany(label ? label.charAt(0).toUpperCase() + label.slice(1) : '');
      if (c) return c;
    }
  } catch {}
  // Body heuristic: "<Company> is/creates/builds/powers ..." in the opening sentence.
  const firstChunk = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const bm = firstChunk.match(
    /^([A-Z][\w.&'’-]*(?:\s+[A-Z][\w.&'’-]*){0,3})\s+(?:is|are|was|were|creates?|builds?|makes?|provides?|powers?|helps?|empowers?|delivers?|offers?)\b/,
  );
  if (bm) { const c = cleanCompany(bm[1]); if (c) return c; }
  // last resort: first non-empty line of the body
  const firstLine = String(body || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return firstLine.slice(0, 60);
}

// Shape an Inbox row into the {role, company, location, ats_url} contract the
// full-JD scoring helper reads. The JD body is passed separately.
function asScoringRole(row) {
  return {
    company: row.company || '',
    role: row.title || '',
    location: '',
    ats_url: row.url || '',
  };
}

// Score JSON shape:
// {company, role, variant1:{score,reason}, variant2:{...}, variant3:{...}, top:{persona,score,reason}}
function parseScores(scoreObj) {
  const v1 = scoreObj?.variant1 || {};
  const v2 = scoreObj?.variant2 || {};
  const v3 = scoreObj?.variant3 || {};
  const s1 = Number(v1.score) || 0;
  const s2 = Number(v2.score) || 0;
  const s3 = Number(v3.score) || 0;
  // recommended = the model's top pick; fall back to highest score, ties variant1 > variant2 > variant3.
  const top = scoreObj?.top?.persona;
  let recommended = ['variant1', 'variant2', 'variant3'].includes(top) ? top : null;
  if (!recommended) {
    recommended = (s1 >= s2 && s1 >= s3) ? 'variant1' : (s2 >= s3 ? 'variant2' : 'variant3');
  }
  return {
    variant1_score: s1,
    variant1_reason: String(v1.reason || ''),
    variant2_score: s2,
    variant2_reason: String(v2.reason || ''),
    variant3_score: s3,
    variant3_reason: String(v3.reason || ''),
    recommended_persona: recommended,
  };
}

// Run authoritative full-JD 3-persona scoring on an Inbox row and persist the
// scores + extracted company/title. Sets status='scored'. Returns parsed fields.
async function scoreRow(row) {
  const scoreObj = await scoreFullJd3(asScoringRole(row), row.jd_body || '');
  const scores = parseScores(scoreObj);
  const update = { ...scores, status: 'scored' };
  // The model reads the JD and names the actual employer + posted title - more reliable
  // than the title/host guess. Use them when present (fixes "Builtin"->Toast, "AMER"->Quest,
  // "Application"->"Senior Program Manager, Content Operations & Learning Technology").
  const extracted = cleanCompany(scoreObj?.company);
  if (extracted) update.company = extracted;
  const role = cleanTitle(scoreObj?.role) || cleanTitle(row.title);
  if (role) update.title = role;
  await updateRow('Inbox', 'job_id', row.job_id, update);
  return { ...scores, company: extracted || row.company, title: role || row.title };
}

// --- POST /jd-capture (bookmarklet / desktop) ----------------------------------
router.options('/jd-capture', cors);

router.post('/jd-capture', cors, async (req, res, next) => {
  try {
    const b = req.body || {};
    const url = String(b.url || '').trim();
    let body = String(b.body || '');
    let title = String(b.role || b.title || '').trim();
    let company = (b.company && String(b.company).trim()) || '';
    const source = normSource(b.source, 'bookmarklet');

    if (!url) return res.status(400).json({ ok: false, error: 'missing url' });

    // The JD often lives in a cross-origin iframe (Greenhouse/Lever embeds) the bookmarklet
    // can't read. It hands us that iframe's src as fetch_url; pull the JD server-side.
    if (body.trim().length < MIN_BODY_CHARS) {
      const fetchUrl = String(b.fetch_url || '').trim();
      if (fetchUrl && !isAuthWalled(fetchUrl)) {
        try {
          const ext = await ingestUrl(fetchUrl);
          if (ext && String(ext.jd_body || '').trim().length >= MIN_BODY_CHARS) {
            body = ext.jd_body;
            if (!title && ext.title) title = ext.title;
            if (!company && ext.company) company = ext.company;
          }
        } catch { /* fall through to the error below */ }
      }
    }

    if (body.trim().length < MIN_BODY_CHARS) {
      return res.status(400).json({
        ok: false,
        error: 'empty body — bookmarklet captured no JD content; scroll the page until the description is visible then click the bookmarklet again',
      });
    }

    if (!company) company = deriveCompany({ title, url, body });
    const { canonicalUrl } = canonicalIdentity(url);

    const job_id = randomUUID();
    const row = {
      job_id,
      captured_at: b.captured_at || nowIso(),
      source,
      company,
      title,
      url,
      canonical_url: canonicalUrl,
      jd_body: body,
      jd_length: String(body.length),
      posted_date: String(b.posted_date || '').trim(),
      num_applicants: String(b.num_applicants || '').trim(),
      variant1_score: '',
      variant1_reason: '',
      variant2_score: '',
      variant2_reason: '',
      variant3_score: '',
      variant3_reason: '',
      recommended_persona: '',
      status: 'new',
      cl_paragraph: '',
      mention_bullets: '',
      applied_at: '',
    };
    await appendRows('Inbox', [row]);

    // Score inline, then flip to 'scored'.
    const scores = await scoreRow(row);

    res.json({
      ok: true,
      job_id,
      variant1_score: scores.variant1_score,
      variant2_score: scores.variant2_score,
      recommended_persona: scores.recommended_persona,
    });
  } catch (err) {
    next(err);
  }
});

// --- POST /api/ingest (mobile paste / Discover click) --------------------------
router.options('/api/ingest', cors);

router.post('/api/ingest', cors, async (req, res, next) => {
  try {
    const b = req.body || {};
    const url = String(b.url || '').trim();
    const source = normSource(b.source, 'mobile');
    if (!url) return res.status(400).json({ ok: false, error: 'missing url' });

    const { canonicalUrl } = canonicalIdentity(url);

    // Try to fetch + extract the JD. Auth-walled or failed fetch -> create a
    // metadata-only 'new' row so the user can bookmarklet it.
    let extracted = null;
    if (!isAuthWalled(url)) {
      extracted = await ingestUrl(url);
    }

    const body = extracted?.jd_body || '';
    const title = (b.title && String(b.title).trim()) || extracted?.title || '';
    const company = (b.company && String(b.company).trim())
      || extracted?.company
      || deriveCompany({ title, url, body });

    const job_id = randomUUID();
    const haveJd = body.trim().length >= MIN_BODY_CHARS;
    const row = {
      job_id,
      captured_at: nowIso(),
      source,
      company,
      title,
      url,
      canonical_url: canonicalUrl,
      jd_body: body,
      jd_length: String(body.length),
      posted_date: String(b.posted_date || b.posted_at || '').trim(),
      num_applicants: String(b.num_applicants || '').trim(),
      variant1_score: '',
      variant1_reason: '',
      variant2_score: '',
      variant2_reason: '',
      variant3_score: '',
      variant3_reason: '',
      recommended_persona: '',
      status: 'new',
      cl_paragraph: '',
      mention_bullets: '',
      applied_at: '',
    };
    await appendRows('Inbox', [row]);

    if (!haveJd) {
      // Couldn't pull the JD (auth-walled or blocked). Leave as 'new'; user bookmarklets it.
      return res.json({
        ok: true,
        job_id,
        status: 'new',
        needs_bookmarklet: true,
        reason: isAuthWalled(url) ? 'auth-walled' : 'fetch-failed-or-empty',
      });
    }

    const scores = await scoreRow(row);
    res.json({
      ok: true,
      job_id,
      status: 'scored',
      variant1_score: scores.variant1_score,
      variant2_score: scores.variant2_score,
      recommended_persona: scores.recommended_persona,
    });
  } catch (err) {
    next(err);
  }
});

// --- GET /api/inbox ------------------------------------------------------------
router.get('/api/inbox', async (_req, res, next) => {
  try {
    const rows = await readTab('Inbox');
    const SHOW = new Set(['new', 'scored', 'prepped', 'applied']);
    const jobs = rows
      .filter((r) => SHOW.has(r.status))
      .map((r) => ({
        job_id: r.job_id,
        company: r.company,
        title: r.title,
        url: r.url,
        source: r.source,
        status: r.status,
        variant1_score: r.variant1_score === '' ? null : Number(r.variant1_score),
        variant1_reason: r.variant1_reason || '',
        variant2_score: r.variant2_score === '' ? null : Number(r.variant2_score),
        variant2_reason: r.variant2_reason || '',
        variant3_score: r.variant3_score === '' ? null : Number(r.variant3_score),
        variant3_reason: r.variant3_reason || '',
        recommended_persona: r.recommended_persona,
        captured_at: r.captured_at,
      }))
      .sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
    // captured_at is an internal sort key; strip it from the published shape.
    for (const j of jobs) delete j.captured_at;
    res.json({ jobs });
  } catch (err) {
    next(err);
  }
});

// --- DELETE /api/inbox/:job_id -------------------------------------------------
// Reject/remove a job from the Inbox (dupe, or a poor score not worth keeping). Only
// touches the Inbox tab; any Applications-tracker row already written stays intact.
router.delete('/api/inbox/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    await deleteRow('Inbox', 'job_id', job_id);
    res.json({ ok: true });
  } catch (err) {
    if (/no row matched/.test(err.message)) {
      return res.status(404).json({ ok: false, error: 'job not found' });
    }
    next(err);
  }
});

// --- POST /api/score/:job_id ---------------------------------------------------
router.post('/api/score/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const row = await findRow('Inbox', 'job_id', job_id);
    if (!row) return res.status(404).json({ ok: false, error: `job not found: ${job_id}` });
    // Optional pasted body: when the captured JD was junk (cookie banner, careers shell),
    // the user can paste the real description from the inbox card and re-score in place.
    const pasted = String(req.body?.body || '').trim();
    if (pasted) {
      if (pasted.length < MIN_BODY_CHARS) {
        return res.status(400).json({ ok: false, error: 'that looks too short - paste the full description' });
      }
      await updateRow('Inbox', 'job_id', job_id, { jd_body: pasted, jd_length: String(pasted.length) });
      row.jd_body = pasted;
    }
    if (String(row.jd_body || '').trim().length < MIN_BODY_CHARS) {
      return res.status(400).json({ ok: false, error: 'no JD body to score - capture it with the bookmarklet first' });
    }
    const scores = await scoreRow(row);
    res.json({ ok: true, job_id, ...scores });
  } catch (err) {
    next(err);
  }
});

// --- POST /api/reject/:job_id (move an Inbox job to the Rejected tab) -----------
// Records the three persona scores + reasons so the rejection stays auditable, then removes
// the row from the live Inbox queue.
router.post('/api/reject/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const row = await findRow('Inbox', 'job_id', job_id);
    if (!row) return res.status(404).json({ ok: false, error: `job not found: ${job_id}` });

    await appendRows('Rejected', [{
      rejected_at: nowIso(),
      company: row.company || '',
      title: row.title || '',
      url: row.url || '',
      variant1_score: row.variant1_score || '',
      variant1_reason: row.variant1_reason || '',
      variant2_score: row.variant2_score || '',
      variant2_reason: row.variant2_reason || '',
      variant3_score: row.variant3_score || '',
      variant3_reason: row.variant3_reason || '',
      recommended_persona: row.recommended_persona || '',
      jd_length: row.jd_length || '',
      job_id,
    }]);
    await deleteRow('Inbox', 'job_id', job_id);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- POST /api/select/:job_id (pick the persona, prep to apply) -----------------
// Replaces the old "Prep to apply" /api/apply. The user picks which persona to apply with;
// we store it on recommended_persona (the resume/CL routes read that to choose the file),
// flip status to 'prepped', ensure the JD body is present, and create the dated archive
// folder so it's ready to drop PDFs into. No re-score, no per-JD content generation.
router.post('/api/select/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const persona = String(req.body?.persona || '').trim();
    if (!PERSONAS.has(persona)) {
      return res.status(400).json({ ok: false, error: `invalid persona: ${persona || '(empty)'}` });
    }

    const row = await findRow('Inbox', 'job_id', job_id);
    if (!row) return res.status(404).json({ ok: false, error: `job not found: ${job_id}` });

    const jd = await ensureJdBody(row);
    if (!jd.ok) return res.json({ ok: false, ...jd });

    await updateRow('Inbox', 'job_id', job_id, { recommended_persona: persona, status: 'prepped' });

    // Create the dated career-archive folder now (with the JD + capture-time scores) so it's
    // ready to drop resume/CL PDFs into while applying - not after Mark applied.
    let archivePath = null;
    if (archiveConfigured()) {
      const result = await writeApplicationArchive({
        ...row, recommended_persona: persona, jd_body: jd.jdBody, status: 'prepped',
      });
      if (result.ok) archivePath = result.dir;
      else process.stderr.write(`[select] archive write failed job=${job_id}: ${result.error || result.reason}\n`);
    }

    res.json({
      ok: true,
      persona,
      resume_url: `/api/resume/${job_id}`,
      cover_letter_url: `/api/cover-letter/${job_id}`,
      archive_path: archivePath,
    });
  } catch (err) {
    next(err);
  }
});

// --- POST /api/applied/:job_id (promote to Applications, idempotent) -----------
router.post('/api/applied/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const row = await findRow('Inbox', 'job_id', job_id);
    if (!row) return res.status(404).json({ ok: false, error: `job not found: ${job_id}` });

    // Idempotent: already promoted -> no duplicate Applications row.
    if (row.status === 'applied') {
      return res.json({ ok: true, already_applied: true });
    }

    const persona = row.recommended_persona || 'variant1';
    const score = persona === 'variant2' ? row.variant2_score : row.variant1_score;

    const appRow = {
      date_applied: todayMDY(),
      company: row.company || '',
      position: row.title || '',
      status: 'pending',
      interview: '',
      // A canonical cover letter is always available, so every application ships with one.
      cover_letter: 'yes',
      post_date: row.posted_date || '',
      num_applicants: row.num_applicants || '',
      referral_to: '',
      referred: '',
      notes: '',
      link: row.url || '',
      score: score || '',
      persona,
      job_id,
    };
    await appendRows('Applications', [appRow]);
    const appliedAt = nowIso();

    // Refresh the dated career-archive folder (adds the applied date) BEFORE deleting the
    // Inbox row - applicationDir is anchored on captured_at, so do this while the row exists.
    let archived = null;
    if (archiveConfigured()) {
      const result = await writeApplicationArchive({ ...row, status: 'applied', applied_at: appliedAt });
      if (result.ok) archived = result.dir;
      else process.stderr.write(`[applied] archive write failed job=${job_id}: ${result.error || result.reason}\n`);
    }

    // Inbox is now a live queue: terminal actions remove the row (the Applications tracker
    // is the system of record for a submitted application).
    await deleteRow('Inbox', 'job_id', job_id);

    res.json({ ok: true, archived });
  } catch (err) {
    next(err);
  }
});

// --- POST /api/did-not-apply/:job_id (considered, chose not to apply) -----------
// Records the decision (with the persona that was selected + an optional free-text reason)
// to the "Did Not Apply" tab, files the dated archive folder under a "didnt apply" subfolder
// of the same date, then removes the row from the live Inbox queue.
router.post('/api/did-not-apply/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const reasonNote = String(req.body?.reason_note || '');
    const row = await findRow('Inbox', 'job_id', job_id);
    if (!row) return res.status(404).json({ ok: false, error: `job not found: ${job_id}` });

    await appendRows('Did Not Apply', [{
      marked_at: nowIso(),
      company: row.company || '',
      position: row.title || '',
      selected_persona: row.recommended_persona || '',
      variant1_score: row.variant1_score || '',
      variant1_reason: row.variant1_reason || '',
      variant2_score: row.variant2_score || '',
      variant2_reason: row.variant2_reason || '',
      variant3_score: row.variant3_score || '',
      variant3_reason: row.variant3_reason || '',
      reason_note: reasonNote,
      link: row.url || '',
      job_id,
    }]);

    // File the dated folder under "<date>/didnt apply/<Company - Role>/". No-ops gracefully
    // if the archive isn't configured or the folder was never created.
    if (archiveConfigured()) {
      const moved = await moveApplicationDirToDidNotApply(row);
      if (!moved.ok && !moved.skipped) {
        process.stderr.write(`[did-not-apply] archive move failed job=${job_id}: ${moved.error}\n`);
      }
    }

    await deleteRow('Inbox', 'job_id', job_id);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- POST /api/help-questions/:job_id (spawn a Claude terminal for this job) -----
// Preps the job's archive folder with the selected persona's resume + cover letter, a copy of
// the master bank, and a priming CLAUDE.md, then opens Terminal.app running the claude CLI
// there - so Tyler can answer detailed application questions with full context loaded.
router.post('/api/help-questions/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    if (!archiveConfigured()) {
      return res.status(400).json({ ok: false, error: 'ARCHIVE_DIR not set' });
    }
    const row = await findRow('Inbox', 'job_id', job_id);
    if (!row) return res.status(404).json({ ok: false, error: `job not found: ${job_id}` });

    const dir = applicationDir(row);
    const persona = PERSONAS.has(row.recommended_persona) ? row.recommended_persona : 'variant1';
    const personaLabel = PERSONA_LABELS[persona];

    // Render the SELECTED persona's resume + cover letter for this job (same loader the
    // resume/cover-letter routes use).
    const resumeFile = RESUME_FILES[persona] || RESUME_FILES.variant1;
    const clFile = COVER_LETTER_FILES[persona] || COVER_LETTER_FILES.variant1;
    const resumeHtml = renderSplitDoc({ html: await loadPersonaHtml(resumeFile), job: row, kind: 'resume' });
    const clHtml = renderSplitDoc({ html: await loadPersonaHtml(clFile), job: row, kind: 'cover-letter' });

    await writeFile(join(dir, 'resume.html'), resumeHtml, 'utf8');
    await writeFile(join(dir, 'cover-letter.html'), clHtml, 'utf8');

    const bank = await readMasterBank();
    if (bank != null) await writeFile(join(dir, 'master-bank.json'), bank, 'utf8');

    const claudeMd = [
      `# Help Tyler answer application questions - ${row.company || 'Unknown'} / ${String(row.title || '').split('|')[0].trim() || 'Role'}`,
      '',
      'You are helping Tyler answer detailed application questions for THIS job.',
      '',
      '- The job description is in `job-description.txt`.',
      `- The resume and cover letter being submitted are \`resume.html\` and \`cover-letter.html\` (selected persona: ${personaLabel}).`,
      '- `master-bank.json` holds Tyler\'s fuller experience - draw on it for specifics.',
      '',
      'Answer questions concisely, in Tyler\'s voice, grounded in the bank and the submitted',
      'documents. Never invent facts. When a question asks for an example or metric, pull it',
      'from the bank rather than guessing.',
      '',
    ].join('\n');
    await writeFile(join(dir, 'CLAUDE.md'), claudeMd, 'utf8');

    const launched = await openTerminalWithClaude(dir);
    if (!launched) process.stderr.write(`[help-questions] terminal launch failed job=${job_id}\n`);

    res.json({ ok: true, folder: dir });
  } catch (err) {
    next(err);
  }
});

// --- POST /api/open-folder/:job_id (reveal this application's archive folder) ---
router.post('/api/open-folder/:job_id', async (req, res, next) => {
  try {
    if (!archiveConfigured()) {
      return res.status(400).json({ ok: false, error: 'archive folder not configured (set ARCHIVE_DIR in .env)' });
    }
    const { job_id } = req.params;
    const row = await findRow('Inbox', 'job_id', job_id);
    if (!row) return res.status(404).json({ ok: false, error: `job not found: ${job_id}` });
    const dir = applicationDir(row);
    const opened = await openInFinder(dir);
    res.json({ ok: opened, dir });
  } catch (err) {
    next(err);
  }
});

export default router;
