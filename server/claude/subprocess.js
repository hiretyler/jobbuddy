import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/opt/homebrew/bin/claude';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const TIMEOUT_MS = 180000;

const _templateCache = new Map();

function runOnce(prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--dangerously-skip-permissions', '--model', CLAUDE_MODEL];
    const child = spawn(CLAUDE_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch {}
      const err = new Error(`claude timed out after ${timeoutMs}ms`);
      err.code = 'TIMEOUT';
      reject(err);
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`claude spawn failed: ${err.message}`));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || '(no output)';
        reject(new Error(`claude exited ${code}: ${detail.slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function runClaude(prompt, { timeoutMs = TIMEOUT_MS } = {}) {
  try {
    return await runOnce(prompt, timeoutMs);
  } catch (err) {
    if (err.code !== 'TIMEOUT') throw err;
    process.stderr.write(`[claude-cli] attempt=1 timed out after ${timeoutMs}ms, retrying...\n`);
    try {
      return await runOnce(prompt, timeoutMs);
    } catch (err2) {
      if (err2.code === 'TIMEOUT') {
        process.stderr.write(`[claude-cli] attempt=2 timed out after ${timeoutMs}ms, giving up\n`);
      }
      throw err2;
    }
  }
}

export async function runClaudeJson(prompt, opts) {
  const out = await runClaude(prompt, opts);
  const m = out.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!m) {
    throw new Error(`no json block in claude output: ${out.slice(0, 200)}`);
  }
  try {
    return JSON.parse(m[1]);
  } catch (err) {
    throw new Error(`json parse failed (${err.message}): ${out.slice(0, 200)}`);
  }
}

export async function loadPromptTemplate(name) {
  if (_templateCache.has(name)) return _templateCache.get(name);
  const url = new URL(`../claude/prompts/${name}.md`, import.meta.url);
  const text = await readFile(url, 'utf8');
  _templateCache.set(name, text);
  return text;
}

export function fillTemplate(template, subs) {
  let out = template;
  for (const [k, v] of Object.entries(subs)) {
    const re = new RegExp(`\\{\\{${k}\\}\\}`, 'g');
    out = out.replace(re, v == null ? '' : String(v));
  }
  const leftover = out.match(/\{\{([a-z_][a-z0-9_]*)\}\}/i);
  if (leftover) {
    throw new Error(`unfilled template placeholder: {{${leftover[1]}}}`);
  }
  return out;
}

export async function scoreSnippet(role) {
  const tpl = await loadPromptTemplate('snippet-score');
  const prompt = fillTemplate(tpl, {
    snippet: role.snippet || '',
    company: role.company || '',
    role: role.role || '',
    location: role.location || '',
    ats_url: role.ats_url || '',
  });
  return runClaudeJson(prompt);
}

export async function rescoreFullJd(role, jdBody) {
  const tpl = await loadPromptTemplate('fulljd-rescore');
  const prompt = fillTemplate(tpl, {
    jd_body: jdBody || '',
    company: role.company || '',
    role: role.role || '',
    location: role.location || '',
    ats_url: role.ats_url || '',
    snippet_score: role.snippet_score || '',
    recommended_persona_from_snippet: role.recommended_persona || '',
  });
  return runClaudeJson(prompt);
}

export async function generateClIntro(role, persona, masterBankRelevant) {
  const tpl = await loadPromptTemplate('cl-intro');
  const prompt = fillTemplate(tpl, {
    company: role.company || '',
    role: role.role || '',
    persona: persona || '',
    jd_body: role.jd_body || '',
    master_bank_relevant: masterBankRelevant || '',
  });
  return runClaude(prompt);
}

// Ambiguous-rejection classifier. Used only when the cheap phrase heuristic is
// inconclusive, to keep CLI volume/cost down. emails is a preformatted string of
// "Subject: ...\nSnippet: ..." blocks. Returns {rejected, confidence}.
export async function classifyRejectionWithClaude(company, emails) {
  const tpl = await loadPromptTemplate('rejection-classify');
  const prompt = fillTemplate(tpl, { company: company || '', emails: emails || '' });
  return runClaudeJson(prompt);
}

const VARIANT_FILES = {
  variant1: 'variant1_gtm_enablement.html',
  variant2: 'variant2_customer_education.html',
};

async function loadOtherPersonaBullets(recommended) {
  const others = Object.keys(VARIANT_FILES).filter((v) => v !== recommended);
  const out = [];
  for (const variant of others) {
    try {
      const fileUrl = new URL(`../../assets/personas/${VARIANT_FILES[variant]}`, import.meta.url);
      const html = await readFile(fileUrl, 'utf8');
      const doc = new JSDOM(html).window.document;
      const bullets = Array.from(doc.querySelectorAll('ul.achievements li'))
        .map((li) => li.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      for (const b of bullets) out.push(`[${variant}] ${b}`);
    } catch {}
  }
  return Array.from(new Set(out));
}

export async function generateMentionBullets(role, persona, masterBankFullText) {
  const tpl = await loadPromptTemplate('mention-bullets');
  const recommended = persona || role.recommended_persona || 'variant1';
  const otherBullets = await loadOtherPersonaBullets(recommended);
  const prompt = fillTemplate(tpl, {
    company: role.company || '',
    role: role.role || '',
    recommended_persona: recommended,
    jd_body: role.jd_body || '',
    master_bank: masterBankFullText || '',
    other_persona_bullets: otherBullets.join('\n'),
  });
  return runClaude(prompt);
}
