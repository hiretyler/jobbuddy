import { Router } from 'express';
import { findRow } from '../sheets.js';
import { loadPersonaHtml, renderSplitDoc, RESUME_FILES } from '../personas.js';

const router = Router();

// Job-specific resume: load the SELECTED persona (recommended_persona for now; a later agent
// reworks selection), fill the .company/.jobtitle spans with the job's company + role, make
// only those spans editable. Read-only otherwise; Cmd+P prints.
router.get('/api/resume/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const job = await findRow('Inbox', 'job_id', job_id);
    if (!job) return res.status(404).send(`job not found: ${job_id}`);

    const variant = job.recommended_persona || 'variant1';
    const filename = RESUME_FILES[variant] || RESUME_FILES.variant1;
    const personaHtml = await loadPersonaHtml(filename);

    const html = renderSplitDoc({ html: personaHtml, job, kind: 'resume' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// Canonical persona resume: no job tailoring, default span text left as-is. Used by the
// header "Canonical resumes" dropdown. variant in {variant1, variant2, variant3}.
router.get('/api/resume/persona/:variant', async (req, res, next) => {
  try {
    const { variant } = req.params;
    const filename = RESUME_FILES[variant];
    if (!filename) return res.status(404).send(`unknown persona: ${variant}`);
    const personaHtml = await loadPersonaHtml(filename);

    const html = renderSplitDoc({ html: personaHtml, job: null, kind: 'resume' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

export default router;
