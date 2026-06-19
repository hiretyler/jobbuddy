import { Router } from 'express';
import { updateRow } from '../sheets.js';
import { loadPersonaHtml, RESUME_FILES } from '../personas.js';

const router = Router();

router.post('/api/persona/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const { persona } = req.body || {};
    if (!RESUME_FILES[persona]) {
      return res.status(400).json({ error: `invalid persona: ${persona}` });
    }
    await updateRow('Inbox', 'job_id', job_id, { recommended_persona: persona });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/api/personas/:variant', async (req, res, next) => {
  try {
    const { variant } = req.params;
    const filename = RESUME_FILES[variant];
    if (!filename) return res.status(404).send(`unknown persona: ${variant}`);
    const html = await loadPersonaHtml(filename);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

export default router;
