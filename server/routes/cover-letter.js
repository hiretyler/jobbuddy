import { Router } from 'express';
import { findRow } from '../sheets.js';
import { loadPersonaHtml, renderSplitDoc, COVER_LETTER_FILES } from '../personas.js';

const router = Router();

// Job-specific cover letter: load the SELECTED persona's cover-letter file (recommended_persona
// for now), fill the .company spans with the job's company, make only those spans editable.
// The letter body is the persona's canonical, fixed content - NOT tailored per job.
router.get('/api/cover-letter/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const job = await findRow('Inbox', 'job_id', job_id);
    if (!job) return res.status(404).send(`job not found: ${job_id}`);

    const variant = job.recommended_persona || 'variant1';
    const filename = COVER_LETTER_FILES[variant] || COVER_LETTER_FILES.variant1;
    const personaHtml = await loadPersonaHtml(filename);

    const html = renderSplitDoc({ html: personaHtml, job, kind: 'cover-letter' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// Canonical persona cover letter: no job, default span text left as-is. Used by the header
// "Canonical resumes" dropdown. variant in {variant1, variant2, variant3}.
router.get('/api/cover-letter/persona/:variant', async (req, res, next) => {
  try {
    const { variant } = req.params;
    const filename = COVER_LETTER_FILES[variant];
    if (!filename) return res.status(404).send(`unknown persona: ${variant}`);
    const personaHtml = await loadPersonaHtml(filename);

    const html = renderSplitDoc({ html: personaHtml, job: null, kind: 'cover-letter' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

export default router;
