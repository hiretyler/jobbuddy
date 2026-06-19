// Persona resume loader. The tracked persona HTML carries a {{CONTACT_INFO}} placeholder
// instead of real contact details, so phone/email/LinkedIn never live in the public repo.
// Contact info loads at serve time from a local-only file (secrets/contact.json), falling
// back to the tracked placeholder example so a fresh clone still renders (with dummy info).

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export const PERSONAS_DIR = join(ROOT, 'assets', 'personas');

// The three personas, each split into a separate resume + cover-letter HTML file.
//   variant1 = GTM / Revenue Enablement, variant2 = Customer Education, variant3 = Internal Enablement (AI Adoption).
export const RESUME_FILES = {
  variant1: 'variant1_gtm_enablement_resume.html',
  variant2: 'variant2_customer_education_resume.html',
  variant3: 'variant3_internal_enablement_resume.html',
};

export const COVER_LETTER_FILES = {
  variant1: 'variant1_gtm_enablement_cover_letter.html',
  variant2: 'variant2_customer_education_cover_letter.html',
  variant3: 'variant3_internal_enablement_cover_letter.html',
};
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

// Captured posting titles can arrive as "Role | Company | Source"; the resume/CL should
// only show the role, not the company or JD source.
function roleOnly(title) {
  return String(title || '').split('|')[0].trim();
}

// Make ONLY .company / h1 / .skills-container editable; everything else stays
// read-only (the default). The resume <h1> wraps the .jobtitle span, so the whole
// name + title line edits as one region (the span still auto-fills with the role).
// Focused targets get a subtle outline. No banner, no toggle, no revert - Cmd+P prints.
const EDITABLE_SPANS_CSS = `
  .company[contenteditable="true"]:focus,
  h1[contenteditable="true"]:focus,
  .skills-container[contenteditable="true"]:focus {
    outline: 1px dashed #2563eb; outline-offset: 2px; border-radius: 2px;
  }
  @media print {
    .company[contenteditable="true"]:focus,
    h1[contenteditable="true"]:focus,
    .skills-container[contenteditable="true"]:focus { outline: 0; }
  }
`;

const EDITABLE_SPANS_SCRIPT = `
(function () {
  var els = document.querySelectorAll('.company, h1, .skills-container');
  for (var i = 0; i < els.length; i++) els[i].setAttribute('contenteditable', 'true');
})();
`;

// Render a split persona/cover-letter file per the span contract:
//  - job-specific (job present): replace inner text of every .company span with the job's
//    company and every .jobtitle span with the job's extracted role title.
//  - canonical (job null): leave the HTML's default span text untouched.
// In both cases inject the editable-spans style + script. Files with no such spans render
// fully read-only. The page <title> is tailored to the job when one is supplied.
export function renderSplitDoc({ html, job, kind }) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  if (job) {
    const company = String(job.company || '').trim();
    const role = roleOnly(job.title);
    if (company) {
      doc.querySelectorAll('.company').forEach((el) => { el.textContent = company; });
    }
    if (role) {
      doc.querySelectorAll('.jobtitle').forEach((el) => { el.textContent = role; });
    }

    const label = kind === 'cover-letter' ? 'Cover Letter' : 'Resume';
    const parts = [label, 'Tyler Geddes'];
    if (company) parts.push(company);
    if (role) parts.push(role);
    let titleEl = doc.querySelector('title');
    if (!titleEl) { titleEl = doc.createElement('title'); doc.head.appendChild(titleEl); }
    titleEl.textContent = parts.join(' - ');
  }

  const styleTag = doc.createElement('style');
  styleTag.textContent = EDITABLE_SPANS_CSS;
  doc.head.appendChild(styleTag);

  const scriptTag = doc.createElement('script');
  scriptTag.textContent = EDITABLE_SPANS_SCRIPT;
  doc.body.appendChild(scriptTag);

  return dom.serialize();
}
