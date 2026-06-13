// Persona resume loader. The tracked persona HTML carries a {{CONTACT_INFO}} placeholder
// instead of real contact details, so phone/email/LinkedIn never live in the public repo.
// Contact info loads at serve time from a local-only file (secrets/contact.json), falling
// back to the tracked placeholder example so a fresh clone still renders (with dummy info).

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export const PERSONAS_DIR = join(ROOT, 'assets', 'personas');
const CONTACT_PATH = process.env.CONTACT_PATH || join(ROOT, 'secrets', 'contact.json');
const CONTACT_EXAMPLE = join(ROOT, 'assets', 'contact.example.json');

let _contact = null;

async function loadContact() {
  if (_contact) return _contact;
  for (const p of [CONTACT_PATH, CONTACT_EXAMPLE]) {
    try {
      _contact = JSON.parse(await readFile(p, 'utf8'));
      return _contact;
    } catch { /* try the next source */ }
  }
  _contact = {};
  return _contact;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Strip any leading scheme so we can render the bare label and build a clean href.
const bare = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');

const emailLink = (c) => (c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '');
const webLink = (c) => (c.website ? `<a href="http://${esc(bare(c.website))}">${esc(bare(c.website))}</a>` : '');
const linkedinLink = (c) => (c.linkedin ? `<a href="https://${esc(bare(c.linkedin))}">${esc(bare(c.linkedin))}</a>` : '');

// The pipe-joined line inside the resume header's <div class="contact-info">.
function contactInfoHtml(c) {
  return [c.location ? esc(c.location) : '', emailLink(c), c.phone ? esc(c.phone) : '', webLink(c), linkedinLink(c)]
    .filter(Boolean).join(' | ');
}
// The two cover-letter sign-off lines.
const phoneEmailHtml = (c) => [c.phone ? esc(c.phone) : '', emailLink(c)].filter(Boolean).join(' | ');
const webLinkedinHtml = (c) => [webLink(c), linkedinLink(c)].filter(Boolean).join(' | ');

// Read a persona file and inject real contact details in place of the placeholders.
export async function loadPersonaHtml(filename) {
  const raw = await readFile(join(PERSONAS_DIR, filename), 'utf8');
  const c = await loadContact();
  return raw
    .replace('{{CONTACT_INFO}}', contactInfoHtml(c))
    .replace('{{CONTACT_PHONE_EMAIL}}', phoneEmailHtml(c))
    .replace('{{CONTACT_WEB_LINKEDIN}}', webLinkedinHtml(c));
}
