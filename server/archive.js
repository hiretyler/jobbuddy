// Career-archive integration. On "Mark applied" JobBuddy drops the captured JD and a
// notes file into a dated per-application folder under ARCHIVE_DIR, so the user has one
// place per application to also keep the resume/CL PDFs they print. Pull, not push: this
// only writes when the user marks applied, never in the background.
//
// Layout: <ARCHIVE_DIR>/<YYYY-MM-DD>/<Company> - <Role>/
//   job-description.txt   the captured JD
//   application.md        url, scores, persona, dates

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Read lazily so dotenv is guaranteed loaded by the time these run.
function archiveRoot() {
  return String(process.env.ARCHIVE_DIR || '').trim();
}
export function archiveConfigured() {
  return !!archiveRoot();
}

// Filesystem-safe path segment: drop separators/illegal chars, collapse whitespace, cap length.
function safe(s) {
  return String(s || '')
    .replace(/[/\\:]+/g, '-')
    .replace(/[<>:"|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

// Captured titles are "Role | Company | Source"; keep only the role.
function roleOnly(title) {
  return String(title || '').split('|')[0].trim();
}

// YYYY-MM-DD from an ISO timestamp (falls back to now on a bad/empty value).
function dateStamp(iso) {
  let d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Deterministic folder path for a (promoted) Inbox row. Same row -> same path, so the
// open-folder route can recompute it without storing anything.
export function applicationDir(row) {
  const root = archiveRoot();
  if (!root) return '';
  const date = dateStamp(row.applied_at);
  const company = safe(row.company) || 'Unknown';
  const role = safe(roleOnly(row.title)) || 'Role';
  return join(root, date, `${company} - ${role}`);
}

// Create the folder and write the JD + notes. Idempotent (re-marking overwrites the two
// files, never the user's own PDFs). Never throws into the apply flow - returns a result.
export async function writeApplicationArchive(row) {
  const dir = applicationDir(row);
  if (!dir) return { ok: false, skipped: true, reason: 'ARCHIVE_DIR not set' };
  try {
    await mkdir(dir, { recursive: true });

    const jd = String(row.jd_body || '').trim();
    if (jd) await writeFile(join(dir, 'job-description.txt'), `${jd}\n`, 'utf8');

    const persona = row.recommended_persona === 'variant2'
      ? 'Customer Education'
      : 'AI-Native Enablement & L&D';
    const lines = [
      `# ${row.company || 'Unknown'} - ${roleOnly(row.title) || 'Role'}`,
      '',
      `- Applied: ${dateStamp(row.applied_at)}`,
      `- Posting: ${row.url || ''}`,
      `- Persona used: ${persona}`,
      `- Enablement & L&D score: ${row.variant1_score || '--'}`,
      `- Customer Education score: ${row.variant2_score || '--'}`,
    ];
    if (row.posted_date) lines.push(`- Posted: ${row.posted_date}`);
    if (row.num_applicants) lines.push(`- Applicants at apply time: ${row.num_applicants}`);
    lines.push('', '_Drop your final resume + cover letter PDFs in this folder._', '');
    await writeFile(join(dir, 'application.md'), lines.join('\n'), 'utf8');

    return { ok: true, dir };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Open a folder in Finder (macOS `open`). Callers must pass a path from applicationDir(),
// so this never opens an arbitrary client-supplied path.
export function openInFinder(dir) {
  return new Promise((resolve) => {
    if (!dir) return resolve(false);
    const child = spawn('open', [dir], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}
