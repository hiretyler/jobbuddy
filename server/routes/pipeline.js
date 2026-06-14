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
import { readTab, findRow, appendRows, updateRow, deleteRow } from '../sheets.js';
import { canonicalIdentity } from '../identity.js';
import {
  scoreSnippet,
  rescoreFullJd,
  generateClIntro,
  generateMentionBullets,
} from '../claude/subprocess.js';
import { fetchJdBody, isAuthWalled } from '../jd-prefetch.js';
import { ingestUrl } from '../manual.js';
import { archiveConfigured, writeApplicationArchive, applicationDir, openInFinder } from '../archive.js';

const router = Router();

const MIN_BODY_CHARS = 300;
const SNIPPET_CAP = 1500;

// Real bank is local-only (secrets/); fall back to the tracked schema example on a fresh clone.
const MASTER_BANK_SOURCES = [
  process.env.MASTER_BANK_PATH,
  new URL('../../secrets/master-bank.json', import.meta.url),
  new URL('../../assets/master-bank.example.json', import.meta.url),
].filter(Boolean);
let masterBankCache = null;
async function loadMasterBank() {
  if (masterBankCache !== null) return masterBankCache;
  for (const src of MASTER_BANK_SOURCES) {
    try { masterBankCache = await readFile(src, 'utf8'); return masterBankCache; }
    catch { /* try next source */ }
  }
  masterBankCache = '';
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
    const appliedAt = nowIso();
    await updateRow('Inbox', 'job_id', job_id, { status: 'applied', applied_at: appliedAt });

    // Drop the JD + notes into the dated career-archive folder for this application.
    let archived = null;
    if (archiveConfigured()) {
      const result = await writeApplicationArchive({ ...row, status: 'applied', applied_at: appliedAt });
      if (result.ok) archived = result.dir;
      else process.stderr.write(`[applied] archive write failed job=${job_id}: ${result.error || result.reason}\n`);
    }

    res.json({ ok: true, archived });
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
