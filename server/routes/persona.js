import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateRow } from '../sheets.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const PERSONAS_DIR = join(__dirname, '..', '..', 'assets', 'personas');

const VARIANT_FILES = {
  variant1: 'variant1_gtm_enablement.html',
  variant2: 'variant2_customer_education.html',
};

router.post('/api/persona/:job_id', async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const { persona } = req.body || {};
    if (!VARIANT_FILES[persona]) {
      return res.status(400).json({ error: `invalid persona: ${persona}` });
    }
    // Cover letter + mention bullets are persona-specific. Clear them on switch so the
    // next Apply regenerates them for the new persona (the apply route only generates
    // when these are empty). Without this, Apply reuses the old persona's blocks.
    await updateRow('Inbox', 'job_id', job_id, {
      recommended_persona: persona,
      cl_paragraph: '',
      mention_bullets: '',
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/api/personas/:variant', async (req, res, next) => {
  try {
    const { variant } = req.params;
    const filename = VARIANT_FILES[variant];
    if (!filename) return res.status(404).send(`unknown persona: ${variant}`);
    const html = await readFile(join(PERSONAS_DIR, filename), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

export default router;
