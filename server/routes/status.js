// Status route: Gmail OAuth handshake + the manual "Scan inbox for updates" button.
//
// No background jobs, no polling. POST /api/scan-inbox is user-triggered. It walks
// the Applications tab, searches Gmail per company, classifies recent mail as
// confirmation / rejection / interview-request, and updates non-terminal rows.
//
// High precision: only auto-update on confident heuristic (or claude-confirmed)
// classification. Genuinely ambiguous rejections are escalated to claude; anything
// still uncertain is returned in needs_review rather than mutating the sheet.

import { Router } from 'express';
import { readTab, updateRow, getSheets, _columnsFor } from '../sheets.js';
import * as gmail from '../gmail.js';
import { classifyRejectionWithClaude } from '../claude/subprocess.js';

const router = Router();

// Statuses we re-scan for updates. Blank counts as in-flight (just applied).
const NON_TERMINAL = new Set(['pending', 'interview', 'role on hold', '']);
// Statuses we never touch once set.
const TERMINAL = new Set(['not selected', 'offer', 'withdrawn']);

const CLAUDE_CONF_FLOOR = 0.8; // claude must be this confident to auto-mark a rejection

// Interview-request signals. Distinct from a generic confirmation: these indicate
// the company wants to talk / schedule / advance, which promotes status to 'interview'.
const INTERVIEW_PHRASES = [
  'we would like to talk',
  "we'd like to talk",
  'we would like to schedule',
  "we'd like to schedule",
  'schedule a call',
  'schedule a time',
  'schedule an interview',
  'set up a call',
  'set up a time',
  'set up an interview',
  'invite you to interview',
  'invitation to interview',
  'like to invite you',
  'move forward with your application',
  'move forward in the process',
  'move you forward',
  'next steps',
  'next step in the process',
  'phone screen',
  'phone interview',
  'video interview',
  'speak with you',
  'chat with you',
  'meet with you',
  'available for a call',
  'your availability',
  'book a time',
];

function interviewPhraseHit(text) {
  const lower = (text || '').toLowerCase();
  return INTERVIEW_PHRASES.some((p) => lower.includes(p));
}

// ---- OAuth handshake (lifted from applysprint oauth.js) ----

router.get('/oauth/gmail/start', async (req, res, next) => {
  try {
    const setup = await gmail.setupGmailAuth();
    if (setup && setup.authUrl) return res.redirect(302, setup.authUrl);
    if (setup && setup.error) return res.status(500).type('text/plain').send(`gmail auth error: ${setup.error}`);
    res.type('html').send('<html><body><h1>Already authorized.</h1></body></html>');
  } catch (err) {
    next(err);
  }
});

router.get('/oauth/gmail/callback', async (req, res) => {
  const code = req.query && req.query.code;
  if (!code) return res.status(400).type('text/plain').send('missing code');
  try {
    const result = await gmail.exchangeCode(String(code));
    if (result && result.error) {
      return res.status(500).type('text/plain').send(`gmail exchange failed: ${result.error}`);
    }
    res.type('html').send('<html><body><h1>Gmail authorized</h1><p>You can close this tab.</p></body></html>');
  } catch (err) {
    res.status(500).type('text/plain').send(`gmail exchange failed: ${err.message}`);
  }
});

// ---- Row matching for Applications rows that may lack a job_id ----
//
// updateRow() requires a UNIQUE key-column match. job_id is the stable key when
// present, but history rows (imported from the user's old sheet) have no job_id.
// For those we match by company+position via the raw sheets client and update the
// exact row by its sheet index. If company+position is non-unique we refuse to
// guess (returns false) so we never mutate the wrong row.

function normKey(s) {
  return (s || '').toString().trim().toLowerCase();
}

// Find the 1-based sheet row number (accounting for the header row) for an
// Applications row matching company+position. Returns {rowNumber} or {error}.
async function findAppRowByCompanyPosition(company, position) {
  const sheets = await getSheets();
  const columns = _columnsFor('Applications');
  const companyIdx = columns.indexOf('company');
  const positionIdx = columns.indexOf('position');
  const lastCol = colLetter(columns.length - 1);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `Applications!A2:${lastCol}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  const values = res.data.values || [];
  const matches = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (normKey(row[companyIdx]) === normKey(company) && normKey(row[positionIdx]) === normKey(position)) {
      matches.push(i + 2); // +1 header, +1 to 1-based
    }
  }
  if (matches.length === 0) return { error: 'no-row-matched' };
  if (matches.length > 1) return { error: 'ambiguous-company-position' };
  return { rowNumber: matches[0] };
}

function colLetter(index) {
  let n = index;
  let letters = '';
  while (true) {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return letters;
}

// Update a single Applications row by its sheet row number (positional, schema-safe).
async function updateAppRowByNumber(rowNumber, updates) {
  const sheets = await getSheets();
  const columns = _columnsFor('Applications');
  const data = [];
  for (const [col, val] of Object.entries(updates)) {
    const cIdx = columns.indexOf(col);
    if (cIdx === -1) throw new Error(`Unknown Applications column ${col}`);
    data.push({
      range: `Applications!${colLetter(cIdx)}${rowNumber}`,
      values: [[val == null ? '' : String(val)]],
    });
  }
  if (!data.length) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
}

// Apply an update to the Applications row identified by job_id when present, else
// by company+position. Returns true on success, or a string error code.
async function applyRowUpdate(row, updates) {
  if (row.job_id && String(row.job_id).trim()) {
    await updateRow('Applications', 'job_id', row.job_id, updates);
    return true;
  }
  const found = await findAppRowByCompanyPosition(row.company, row.position);
  if (found.error) return found.error;
  await updateAppRowByNumber(found.rowNumber, updates);
  return true;
}

// ---- Classification of a company's recent mail into a status verdict ----
//
// Order of precedence on confident signals: rejection > interview-request >
// confirmation. Rejection requires the paired-confirmation gate (a company that
// rejects you first confirmed receipt) for high precision; bare rejection phrases
// without that gate are flagged ambiguous and escalated to claude.

function formatEmailsForClaude(messages) {
  return (messages || [])
    .slice(0, 8)
    .map((m) => `Subject: ${m.subject || ''}\nSnippet: ${(m.body || '').slice(0, 400)}`)
    .join('\n\n---\n\n');
}

function findInterviewMsg(company, messages) {
  const name = normKey(company);
  const fromCompany = (messages || []).filter((m) => {
    const blob = `${m.from} ${m.subject} ${m.body}`.toLowerCase();
    return name && blob.includes(name);
  });
  let best = null;
  for (const m of fromCompany) {
    if (interviewPhraseHit(`${m.subject} ${m.body}`)) {
      if (!best || Number(m.internalDate) > Number(best.internalDate)) best = m;
    }
  }
  return best;
}

// ---- The manual scan ----

router.post('/api/scan-inbox', async (req, res) => {
  try {
    let apps;
    try {
      apps = await readTab('Applications');
    } catch (e) {
      return res.status(500).json({ ok: false, error: `read Applications failed: ${e.message}` });
    }

    const targets = apps.filter((r) => {
      const s = normKey(r.status);
      if (TERMINAL.has(s)) return false;
      return NON_TERMINAL.has(s);
    });

    const out = {
      ok: true,
      scanned: 0,
      updated: [],       // [{company, position, from, to}]
      needs_review: [],  // [{company, position, reason, confidence}]
      errors: [],        // [{company, position, error}]
      gmail_unauthorized: false,
    };

    for (const row of targets) {
      const company = (row.company || '').trim();
      const position = (row.position || '').trim();
      if (!company) continue;
      out.scanned += 1;
      const fromStatus = normKey(row.status) || 'pending';

      try {
        const { messages, error } = await gmail.searchCompanyMail(company, {
          sinceIso: row.date_applied || '',
        });
        if (error === 'gmail-unauthorized') {
          out.gmail_unauthorized = true;
          out.ok = false;
          break;
        }
        if (error) {
          out.errors.push({ company, position, error });
          continue;
        }

        // 1) Rejection (highest precedence). Heuristic gate, then claude on ambiguity.
        const verdict = gmail.classifyRejection(company, messages);
        if (verdict.rejected) {
          const result = await applyRowUpdate(row, { status: 'not selected' });
          if (result === true) {
            out.updated.push({ company, position, from: fromStatus, to: 'not selected' });
          } else {
            out.errors.push({ company, position, error: result });
          }
          continue;
        }

        // 2) Interview request -> promote to interview (never regress from interview).
        const interviewMsg = findInterviewMsg(company, messages);
        if (interviewMsg) {
          if (fromStatus === 'interview') {
            // Already at interview; nothing to do (idempotent, no downgrade).
            continue;
          }
          const result = await applyRowUpdate(row, { status: 'interview', interview: 'yes' });
          if (result === true) {
            out.updated.push({ company, position, from: fromStatus, to: 'interview' });
          } else {
            out.errors.push({ company, position, error: result });
          }
          continue;
        }

        // 3) Ambiguous rejection (phrase but no confirmation gate) -> escalate to claude.
        if (verdict.ambiguous && messages && messages.length) {
          let cl = null;
          try {
            cl = await classifyRejectionWithClaude(company, formatEmailsForClaude(messages));
          } catch (e) {
            process.stderr.write(`[scan-inbox] claude failed ${company}: ${e.message}\n`);
          }
          if (cl && cl.rejected && Number(cl.confidence) >= CLAUDE_CONF_FLOOR) {
            // Never downgrade an interview row to rejected on a claude call.
            if (fromStatus === 'interview') { continue; }
            const result = await applyRowUpdate(row, { status: 'not selected' });
            if (result === true) {
              out.updated.push({ company, position, from: fromStatus, to: 'not selected' });
            } else {
              out.errors.push({ company, position, error: result });
            }
            continue;
          }
          out.needs_review.push({
            company, position, reason: verdict.reason, confidence: verdict.confidence,
          });
          continue;
        }

        // 4) Confirmation-only or no signal: leave status as-is (in-flight). Not reported.
      } catch (e) {
        out.errors.push({ company, position, error: e.message });
        process.stderr.write(`[scan-inbox] ${company} failed: ${e.message}\n`);
      }
    }

    return res.json(out);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
