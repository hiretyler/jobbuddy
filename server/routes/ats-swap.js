import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { findRow } from '../sheets.js';
import { runClaudeJson, loadPromptTemplate, fillTemplate } from '../claude/subprocess.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const PERSONAS_DIR = join(PROJECT_ROOT, 'assets', 'personas');
const MASTER_BANK_PATH = join(PROJECT_ROOT, 'assets', 'master-bank.json');

const VARIANT_FILES = {
  variant1: 'variant1_gtm_enablement.html',
  variant2: 'variant2_customer_education.html',
};

// The structured bank keys personas by concept; the app keys them by variant.
const PERSONA_NAME = {
  variant1: 'internal-enablement',
  variant2: 'customer-education',
};

let _bankCache = null;
async function loadMasterBank() {
  if (!_bankCache) {
    _bankCache = JSON.parse(await readFile(MASTER_BANK_PATH, 'utf8'));
  }
  return _bankCache;
}

function extractPersonaBulletsAndSkills(html) {
  const doc = new JSDOM(html).window.document;
  const bullets = Array.from(doc.querySelectorAll('ul.achievements li'))
    .map((li) => li.textContent.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const skillsEl = doc.querySelector('.skills-container');
  const skillsText = skillsEl ? skillsEl.textContent.replace(/\s+/g, ' ').trim() : '';
  const skills = skillsText
    ? skillsText.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  return { bullets, skills };
}

async function loadPersona(variant) {
  const filename = VARIANT_FILES[variant];
  if (!filename) return { bullets: [], skills: [] };
  const html = await readFile(join(PERSONAS_DIR, filename), 'utf8');
  return extractPersonaBulletsAndSkills(html);
}

router.post('/api/ats-swap/:job_id', async (req, res) => {
  const { job_id } = req.params;
  try {
    const job = await findRow('Inbox', 'job_id', job_id);
    if (!job) return res.status(404).json({ error: `job not found: ${job_id}` });

    const jdBody = job.jd_body || '';
    if (!jdBody) return res.status(400).json({ error: 'no JD body for this job' });

    const variant = job.recommended_persona || 'variant1';
    if (!VARIANT_FILES[variant]) {
      return res.status(400).json({ error: `unknown recommended_persona: ${variant}` });
    }

    const current = await loadPersona(variant);

    // Strictly-from-bank: ADD candidates come only from master-bank.json, scoped to the
    // active persona. REMOVE candidates + protected bullets are the bank's per-persona pools.
    const bank = await loadMasterBank();
    const personaName = PERSONA_NAME[variant];
    const addBullets = bank.add_bullets.filter((b) => b.personas.includes(personaName));
    const addSkills = bank.skills.filter((s) => s.personas.includes(personaName));
    const removalCandidates = (bank.removal_candidates && bank.removal_candidates[personaName]) || [];
    const protectedBullets = (bank.protected_bullets && bank.protected_bullets[personaName]) || [];

    const tpl = await loadPromptTemplate('ats-swap');
    const prompt = fillTemplate(tpl, {
      company: job.company || '',
      role: job.title || '',
      jd_body: jdBody,
      recommended_persona: variant,
      persona_name: personaName,
      current_bullets: JSON.stringify(current.bullets, null, 2),
      current_skills: JSON.stringify(current.skills, null, 2),
      add_bullet_candidates: JSON.stringify(
        addBullets.map((b) => ({ id: b.id, text: b.text, role: b.role, tags: b.tags, claim_level: b.claim_level, metric: b.metric })),
        null,
        2,
      ),
      add_skill_candidates: JSON.stringify(
        addSkills.map((s) => ({ skill: s.skill, tags: s.tags, claim_level: s.claim_level })),
        null,
        2,
      ),
      removal_candidates: JSON.stringify(removalCandidates, null, 2),
      protected_bullets: JSON.stringify(protectedBullets, null, 2),
      hard_constraints: JSON.stringify((bank.meta && bank.meta.hard_constraints) || [], null, 2),
    });

    const parsed = await runClaudeJson(prompt);
    const bullet_swaps = Array.isArray(parsed.bullet_swaps) ? parsed.bullet_swaps : [];
    const skill_swaps = Array.isArray(parsed.skill_swaps) ? parsed.skill_swaps : [];
    res.json({ bullet_swaps, skill_swaps });
  } catch (err) {
    process.stderr.write(`[ats-swap] job=${job_id} failed: ${err.message}\n`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
