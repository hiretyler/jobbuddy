// JobBuddy capture + score + apply pipeline.
//
// Pull-based: the user pushes a job in (bookmarklet / desktop / mobile paste /
// Discover click). Each captured job lands in the Inbox tab, gets scored, gets
// prepped on demand, and is promoted to the Applications tab on Apply.
//
// Endpoints (all default-exported on one router):
//   POST   /jd-capture          bookmarklet/desktop capture -> create Inbox row + score
//   OPTIONS/jd-capture          CORS preflight
//   POST   /api/ingest          mobile paste / Discover click -> fetch JD + create row + score
//   GET    /api/inbox           list inbox cards for the UI
//   POST   /api/score/:job_id   (re)run snippet scoring on a row
//   POST   /api/apply/:job_id   full-JD rescore + generate CL para + mention bullets
//   POST   /api/applied/:job_id promote: write a clean Applications row (idempotent)

import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { readTab, findRow, appendRows, updateRow } from '../sheets.js';
import { canonicalIdentity } from '../identity.js';
import {
  scoreSnippet,
  rescoreFullJd,
  generateClIntro,
  generateMentionBullets,
} from '../claude/subprocess.js';
import { fetchJdBody, isAuthWalled } from '../jd-prefetch.js';
import { ingestUrl } from '../manual.js';

const router = Router();

const MIN_BODY_CHARS = 300;
const SNIPPET_CAP = 1500;

const MASTER_BANK_PATH = new URL('../../assets/master-bank.json', import.meta.url);
let masterBankCache = null;
async function loadMasterBank() {
  if (masterBankCache !== null) return masterBankCache;
  try { masterBankCache = await readFile(MASTER_BANK_PATH, 'utf8'); }
  catch { masterBankCache = ''; }
  return masterBankCache;
}

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

// Derive a best-effort company name from title ("Role at Company"), then URL host.
function deriveCompany({ title, url, body }) {
  const t = String(title || '');
  const m = t.match(/\bat\s+(.+?)(?:\s*[-|–]\s*.*)?$/i);
  if (m && m[1].trim()) return m[1].trim();
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const ATS = ['greenhouse.io', 'lever.co', 'ashbyhq.com', 'myworkdayjobs.com', 'workday.com', 'icims.com', 'linkedin.com'];
    if (!ATS.some((h) => host === h || host.endsWith(`.${h}`))) {
      const label = host.split('.')[0];
      if (label) return label.charAt(0).toUpperCase() + label.slice(1);
    }
  } catch {}
  // last resort: first non-empty line of the body
  const firstLine = String(body || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return firstLine.slice(0, 60);
}

// Shape an Inbox row into the {role, company, location, snippet, ats_url}
// contract the subprocess scoring helpers read.
function asScoringRole(row, jdBody) {
  const body = jdBody != null ? jdBody : row.jd_body;
  return {
    company: row.company || '',
    role: row.title || '',
    location: '',
    ats_url: row.url || '',
    snippet: String(body || '').slice(0, SNIPPET_CAP),
    snippet_score: row.variant1_score || row.variant2_score || '',
    recommended_persona: row.recommended_persona || '',
    jd_body: body || '',
  };
}

// Score JSON shape: {variant1:{score,reason}, variant2:{score,reason}, top:{persona,score,reason}}
function parseScores(scoreObj) {
  const v1 = scoreObj?.variant1 || {};
  const v2 = scoreObj?.variant2 || {};
  const s1 = Number(v1.score) || 0;
  const s2 = Number(v2.score) || 0;
  // recommended = higher score; tie -> variant1
  const recommended = s2 > s1 ? 'variant2' : 'variant1';
  return {
    variant1_score: s1,
    variant1_reason: String(v1.reason || ''),
    variant2_score: s2,
    variant2_reason: String(v2.reason || ''),
    recommended_persona: recommended,
  };
}

// Run snippet scoring on an Inbox row and persist the scores. Returns the parsed
// score fields. Sets status='scored'.
async function scoreRow(row) {
  const scoreObj = await scoreSnippet(asScoringRole(row));
  const scores = parseScores(scoreObj);
  await updateRow('Inbox', 'job_id', row.job_id, { ...scores, status: 'scored' });
  return scores;
}

// --- POST /jd-capture (bookmarklet / desktop) ----------------------------------
router.options('/jd-capture', cors);

router.post('/jd-capture', cors, async (req, res, next) => {
  try {
    const b = req.body || {};
    const url = String(b.url || '').trim();
    const body = String(b.body || '');
    const title = String(b.role || b.title || '').trim();
    const source = normSource(b.source, 'bookmarklet');

    if (!url) return res.status(400).json({ ok: false, error: 'missing url' });
    if (body.trim().length < MIN_BODY_CHARS) {
      return res.status(400).json({
        ok: false,
        error: 'empty body — bookmarklet captured no JD content; scroll the page until the description is visible then click the bookmarklet again',
      });
    }

    const company = (b.company && String(b.company).trim()) || deriveCompany({ title, url, body });
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
    const SHOW = new Set(['new', 'scored', 'applied']);
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
        variant2_score: r.variant2_score === '' ? null : Number(r.variant2_score),
        recommended_persona: r.recommended_persona,
        has_cl: !!String(r.cl_paragraph || '').trim(),
        has_bullets: !!String(r.mention_bullets || '').trim(),
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

// --- POST /api/score/:job_id ---------------------------------------------------
router.post('/api/score/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const row = await findRow('Inbox', 'job_id', job_id);
    if (!row) return res.status(404).json({ ok: false, error: `job not found: ${job_id}` });
    if (String(row.jd_body || '').trim().length < MIN_BODY_CHARS) {
      return res.status(400).json({ ok: false, error: 'no JD body to score - capture it with the bookmarklet first' });
    }
    const scores = await scoreRow(row);
    res.json({ ok: true, job_id, ...scores });
  } catch (err) {
    next(err);
  }
});

// --- POST /api/apply/:job_id (prep: full-JD rescore + CL + bullets) -------------
function extractJsonBlock(raw) {
  if (!raw) return null;
  const fenced = String(raw).match(/```json\s*\n([\s\S]*?)\n```/);
  const candidate = fenced ? fenced[1] : String(raw);
  try { return JSON.parse(candidate); } catch { return null; }
}

function extractClParagraph(raw) {
  const obj = extractJsonBlock(raw);
  if (obj && typeof obj.cl_paragraph === 'string') return obj.cl_paragraph.trim();
  if (typeof raw === 'string' && !raw.includes('```') && !raw.trim().startsWith('{')) return raw.trim();
  return '';
}

function parseBullets(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === 'string' && x.trim());
  const obj = extractJsonBlock(raw);
  if (obj && Array.isArray(obj.bullets)) return obj.bullets;
  if (Array.isArray(obj)) return obj.filter((x) => typeof x === 'string' && x.trim());
  return [];
}

router.post('/api/apply/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const row = await findRow('Inbox', 'job_id', job_id);
    if (!row) return res.status(404).json({ ok: false, error: `job not found: ${job_id}` });

    let jdBody = String(row.jd_body || '');
    // If the row was created metadata-only (auth-walled ingest), try a fetch now.
    if (jdBody.trim().length < MIN_BODY_CHARS) {
      if (isAuthWalled(row.url)) {
        return res.json({ ok: false, result: 'needs_bookmarklet', install_url: '/bookmarklet/install', reason: 'auth-walled' });
      }
      try {
        const fetched = await fetchJdBody(row.url);
        jdBody = fetched.body;
        await updateRow('Inbox', 'job_id', job_id, { jd_body: jdBody, jd_length: String(jdBody.length) });
      } catch (err) {
        const reason = err.code === 'AUTH_WALLED' ? 'auth-walled' : err.message;
        return res.json({ ok: false, result: 'needs_bookmarklet', install_url: '/bookmarklet/install', reason });
      }
    }

    // Full-JD rescore (updates both variant scores + recommended persona).
    const scoreObj = await rescoreFullJd(asScoringRole(row, jdBody), jdBody);
    const scores = parseScores(scoreObj);
    const persona = scores.recommended_persona || 'variant1';

    const roleForGen = { ...asScoringRole(row, jdBody) };
    const masterBank = await loadMasterBank();

    const clRaw = (await generateClIntro(roleForGen, persona, masterBank)).trim();
    const cl_paragraph = extractClParagraph(clRaw) || clRaw;

    const bulletsRaw = (await generateMentionBullets(roleForGen, persona, masterBank)).trim();
    const mention_bullets = parseBullets(bulletsRaw);

    await updateRow('Inbox', 'job_id', job_id, {
      ...scores,
      status: 'scored',
      cl_paragraph,
      mention_bullets: JSON.stringify(mention_bullets),
    });

    res.json({
      ok: true,
      job_id,
      variant1_score: scores.variant1_score,
      variant2_score: scores.variant2_score,
      recommended_persona: persona,
      cl_paragraph,
      mention_bullets,
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
    const hasCl = !!String(row.cl_paragraph || '').trim();

    const appRow = {
      date_applied: todayMDY(),
      company: row.company || '',
      position: row.title || '',
      status: 'pending',
      interview: '',
      cover_letter: hasCl ? 'yes' : 'no',
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
    await updateRow('Inbox', 'job_id', job_id, { status: 'applied', applied_at: nowIso() });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
