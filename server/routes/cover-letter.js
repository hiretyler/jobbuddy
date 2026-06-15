import { Router } from 'express';
import { JSDOM } from 'jsdom';
import { findRow } from '../sheets.js';
import { loadPersonaHtml } from '../personas.js';

const router = Router();

const VARIANT_FILES = {
  variant1: 'variant1_gtm_enablement.html',
  variant2: 'variant2_customer_education.html',
};

// Tyler's canonical cover-letter opening paragraph per persona. NOT tailored to any job -
// these are his real, fixed openers. Both the job-specific and persona-only cover letters
// use them; only the recipient header (company + title) varies per job.
const CL_CANONICAL_OPENER = {
  variant1:
    "Hi there - I'm Tyler Geddes, a GTM and Revenue Enablement leader with over 8 years of experience driving the metrics that matter for customer-facing teams. I don't just use AI on a daily basis - I enable AI adoption for the teams I support, and build functional apps, workflows, and systems for them to use. I've created revenue-linked enablement programs for Sales and Customer Success teams at B2B SaaS companies in several different industries - helping them adapt faster with training that costs less to produce, and changes how reps actually work.",
  variant2:
    "Hi there - I'm Tyler Geddes, a customer education leader and AI-native training professional. I build real, functional systems and workflows with AI, and have learned how impactful it is when used for more than just low-effort content generation. For 8+ years I've turned onboarding into a retention strategy - replacing unsustainable 1:1 training with scalable 1:many systems that cut time-to-value and reduce churn. I create the AI infrastructure that supports customer education myself, speeding instructional development cycles without waiting for expensive tools to be procured.",
};

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(d = new Date()) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function extractFromPersona(personaHtml) {
  const doc = new JSDOM(personaHtml).window.document;
  const header = doc.querySelector('.resume-container > header');
  const name = (header && header.querySelector('h1') && header.querySelector('h1').textContent.trim()) || 'Tyler Geddes';
  const contactEl = header && header.querySelector('.contact-info');
  const contactHtml = contactEl ? contactEl.innerHTML : '';

  const bodyEl = doc.querySelector('.page > .body');
  const tailParagraphs = [];
  if (bodyEl) {
    const ps = Array.from(bodyEl.querySelectorAll('p'));
    for (let i = 1; i < ps.length; i++) tailParagraphs.push(ps[i].textContent.trim());
  }

  const signOffEl = doc.querySelector('.page > .sign-off');
  const signOffHtml = signOffEl ? signOffEl.innerHTML : '';

  return { name, contactHtml, tailParagraphs, signOffHtml };
}

function renderCoverLetter({ company, title, name, contactHtml, firstParagraph, tailParagraphs, signOffHtml }) {
  const dateStr = formatDate();
  const paragraphs = [firstParagraph, ...tailParagraphs]
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('\n');

  const recipient = company
    ? `<div class="recipient"><strong>${esc(company)}</strong>${title ? ` — ${esc(title)}` : ''}</div>`
    : '';

  const readOnlyText = `Read-only${company ? ' - ' + company : ''}. Cmd+P to print.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Cover Letter - ${esc(name)}${company ? ` - ${esc(company)}` : ''}${title ? ` - ${esc(title)}` : ''}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f0f0f0; padding: 10px 20px; color: #111; font-size: 11pt; line-height: 1.4; }
  .page { max-width: 8.5in; margin: 0 auto; background: #fff; padding: 0.25in 0.75in 0.75in 0.75in; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
  .letter-header { margin-bottom: 22px; }
  .letter-header h1 { font-size: 18pt; font-weight: 600; margin-bottom: 4px; }
  .contact-info { font-size: 10pt; color: #333; margin-bottom: 18px; }
  .contact-info a { color: inherit; text-decoration: none; }
  .date { font-size: 10pt; margin-bottom: 14px; }
  .recipient { font-size: 11pt; margin-bottom: 18px; }
  .body p { margin-bottom: 14px; }
  .sign-off { margin-top: 22px; }
  .sign-off p { margin-bottom: 4px; font-size: 11pt; }
  .sign-off a { color: inherit; text-decoration: none; }

  .applysprint-banner {
    position: fixed; top: 16px; left: 16px;
    background: #ecfeff; border: 1px solid #0e7490; color: #155e75;
    padding: 6px 10px; border-radius: 4px; font: 12px/1.3 -apple-system, system-ui, sans-serif;
    z-index: 9999; display: flex; align-items: center; gap: 10px;
  }
  .banner-btn {
    font-size: 11px; padding: 3px 8px; border: 1px solid #0e7490;
    background: #fff; color: #0e7490; border-radius: 3px; cursor: pointer;
  }
  .banner-btn:hover { background: #ecfeff; }
  .page[contenteditable="true"]:focus { outline: 2px solid #0e7490; outline-offset: 4px; }

  @media print {
    @page { size: 8.5in 11in; margin: 0; }
    body { background: white; padding: 0; margin: 0; }
    .page { box-shadow: none; max-width: none; width: 100%; padding: 0.5in 0.75in; }
    .applysprint-banner { display: none !important; }
    .banner-btn { display: none !important; }
    .page[contenteditable="true"]:focus { outline: 0; }
  }
</style>
</head>
<body>
<div class="applysprint-banner" data-mode="readonly"><span class="banner-text">${esc(readOnlyText)}</span> <button type="button" class="banner-btn banner-enable">Enable editing</button><button type="button" class="banner-btn banner-revert" hidden>Revert</button></div>
<div class="page" contenteditable="false" spellcheck="true">
  <div class="letter-header">
    <div class="date">${esc(dateStr)}</div>
    ${recipient}
  </div>
  <div class="body">
${paragraphs}
  </div>
  <div class="sign-off">${signOffHtml}</div>
</div>
<script>
(function () {
  var page = document.querySelector('.page');
  var banner = document.querySelector('.applysprint-banner');
  var bannerText = banner.querySelector('.banner-text');
  var enableBtn = banner.querySelector('.banner-enable');
  var revertBtn = banner.querySelector('.banner-revert');
  var readOnlyText = ${JSON.stringify(readOnlyText)};
  var editingText = readOnlyText.replace(/^Read-only/, 'Editing enabled');

  function setReadOnly() {
    page.setAttribute('contenteditable', 'false');
    banner.setAttribute('data-mode', 'readonly');
    bannerText.textContent = readOnlyText;
    enableBtn.hidden = false;
    revertBtn.hidden = true;
  }

  function setEditable() {
    page.setAttribute('contenteditable', 'true');
    banner.setAttribute('data-mode', 'editing');
    bannerText.textContent = editingText;
    enableBtn.hidden = true;
    revertBtn.hidden = false;
  }

  enableBtn.addEventListener('click', function () {
    setEditable();
  });

  revertBtn.addEventListener('click', function () {
    if (window.confirm('Discard your edits and reload the canonical cover letter?')) {
      location.reload();
    }
  });
})();
</script>
</body>
</html>
`;
}

// Canonical "AI Adoption" cover letter - a hand-written generic letter (no company/role),
// served editable + printable exactly like the two persona cover letters. The sign-off is
// reused from a persona (identical across both). Registered BEFORE the :job_id route so the
// literal "ai-adoption" segment isn't captured as a job id.
const CL_AI_ADOPTION = {
  firstParagraph:
    "Hi there - I'm Tyler Geddes, an enablement professional with 8+ years building successful programs for customer-facing teams at B2B SaaS companies.",
  tailParagraphs: [
    "I have direct experience running AI adoption workshops at Simpro, coaching Sales and Customer Success reps to integrate Gemini into deal and renewal reviews. I paired this with an AI content development system in NotebookLM and Gemini that cut training production time 60% for my team. I also built my own enablement delivery system - using Claude Code and Google Apps Script - that provides daily micro-training content without the licensing and login hassles of a heavy, traditional LMS.",
    "My experience spans the full spectrum of AI usage: content creation, tool building, and helping others integrate it into their daily workflows. Most importantly, I know how to change attitudes - turning AI into an essential tool, rather than a toy or a threat! I'd welcome the chance to talk through what I can bring to your team.",
  ],
};

router.get('/api/cover-letter/ai-adoption', async (req, res, next) => {
  try {
    const personaHtml = await loadPersonaHtml(VARIANT_FILES.variant1);
    const { name, contactHtml, signOffHtml } = extractFromPersona(personaHtml);

    const html = renderCoverLetter({
      company: '',
      title: '',
      name,
      contactHtml,
      firstParagraph: CL_AI_ADOPTION.firstParagraph,
      tailParagraphs: CL_AI_ADOPTION.tailParagraphs,
      signOffHtml,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

router.get('/api/cover-letter/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const job = await findRow('Inbox', 'job_id', job_id);
    if (!job) return res.status(404).send(`job not found: ${job_id}`);

    const variant = job.recommended_persona || 'variant1';
    const filename = VARIANT_FILES[variant] || VARIANT_FILES.variant1;
    const personaHtml = await loadPersonaHtml(filename);
    const { name, contactHtml, tailParagraphs, signOffHtml } = extractFromPersona(personaHtml);

    // Canonical opening paragraph - NOT tailored to the job. Only the recipient header
    // (company + title) is job-specific; the letter body is Tyler's canonical content.
    const html = renderCoverLetter({
      company: job.company,
      title: job.title,
      name,
      contactHtml,
      firstParagraph: CL_CANONICAL_OPENER[variant] || CL_CANONICAL_OPENER.variant1,
      tailParagraphs,
      signOffHtml,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// Persona-only canonical cover letter: the canonical opener + follow-on paragraphs + sign-off,
// no recipient (there is no job). Used by the header "Canonical resumes" dropdown.
router.get('/api/cover-letter/persona/:variant', async (req, res, next) => {
  try {
    const { variant } = req.params;
    const filename = VARIANT_FILES[variant];
    if (!filename) return res.status(404).send(`unknown persona: ${variant}`);
    const personaHtml = await loadPersonaHtml(filename);
    const { name, contactHtml, tailParagraphs, signOffHtml } = extractFromPersona(personaHtml);

    const html = renderCoverLetter({
      company: '',
      title: '',
      name,
      contactHtml,
      firstParagraph: CL_CANONICAL_OPENER[variant] || CL_CANONICAL_OPENER.variant1,
      tailParagraphs,
      signOffHtml,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

export default router;
