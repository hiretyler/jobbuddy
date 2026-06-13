// Gmail client (JobBuddy split). Pull-based only: OAuth handshake + per-company
// mail search + rejection/confirmation phrase classification. The applysprint
// LinkedIn-digest/poller path (scanInbox, parseAlertMessage, parse*Digest,
// splitLinkedInRoleText, buildRecord, parsePostedAge, the digest regexes and the
// canonicalIdentity import) was cut - JobBuddy does not source jobs from email.

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { readFile, writeFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

let gmailClient = null;
let oauthClient = null;

async function loadToken(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function saveToken(path, token) {
  try { await writeFile(path, JSON.stringify(token, null, 2), 'utf8'); }
  catch (e) { console.error('gmail: failed to persist token', e.message); }
}

export async function setupGmailAuth() {
  try {
    const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
    const redirectUri = process.env.GMAIL_OAUTH_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('missing GMAIL_OAUTH_* env vars');
    }
    const tokenPath = process.env.GMAIL_TOKEN_PATH;
    oauthClient = new OAuth2Client({ clientId, clientSecret, redirectUri });

    const token = tokenPath ? await loadToken(tokenPath) : null;
    if (token && token.refresh_token) {
      oauthClient.setCredentials(token);
      oauthClient.on('tokens', async (t) => {
        if (tokenPath) await saveToken(tokenPath, { ...token, ...t });
      });
      gmailClient = google.gmail({ version: 'v1', auth: oauthClient });
      return { gmail: gmailClient, oauth: oauthClient };
    }

    const authUrl = oauthClient.generateAuthUrl({
      access_type: 'offline', prompt: 'consent', scope: SCOPES,
    });
    return { authUrl, oauth: oauthClient };
  } catch (e) {
    console.error('gmail: setupGmailAuth failed', e.message);
    return { error: e.message };
  }
}

export async function exchangeCode(code) {
  try {
    if (!oauthClient) await setupGmailAuth();
    const { tokens } = await oauthClient.getToken(code);
    oauthClient.setCredentials(tokens);
    const tokenPath = process.env.GMAIL_TOKEN_PATH;
    if (tokenPath) await saveToken(tokenPath, tokens);
    gmailClient = google.gmail({ version: 'v1', auth: oauthClient });
    return { ok: true };
  } catch (e) {
    console.error('gmail: exchangeCode failed', e.message);
    return { error: e.message };
  }
}

function headerValue(headers, name) {
  if (!headers) return '';
  const h = headers.find((x) => x.name && x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function decodeBase64Url(data) {
  if (!data) return '';
  try { return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
  catch { return ''; }
}

function extractParts(payload) {
  const out = { plain: '', html: '' };
  const walk = (part) => {
    if (!part) return;
    const mime = (part.mimeType || '').toLowerCase();
    const data = part.body && part.body.data;
    if (mime === 'text/plain' && data) out.plain += decodeBase64Url(data);
    else if (mime === 'text/html' && data) out.html += decodeBase64Url(data);
    if (Array.isArray(part.parts)) part.parts.forEach(walk);
  };
  walk(payload);
  return out;
}

function htmlToText(html) {
  try {
    const dom = new JSDOM(html);
    return dom.window.document.body ? dom.window.document.body.textContent : '';
  } catch { return ''; }
}

function isoFromInternal(internalDate) {
  const n = Number(internalDate);
  return n ? new Date(n).toISOString() : new Date().toISOString();
}

// Phrase banks for status classification. Heuristic-first; only genuinely
// ambiguous rejection cases escalate to claude in the route.
export const REJECTION_PHRASES = [
  'unfortunately',
  'not moving forward',
  'will not be moving forward',
  'decided to move forward with other candidates',
  'move forward with other candidates',
  'position has been filled',
  'role has been filled',
  'will not be proceeding',
  'not be proceeding',
  'not selected',
  'pursue other candidates',
  'other applicants',
  'we have decided not to',
  'no longer under consideration',
  'wish you the best in your',
  'wish you success in your search',
];

export const CONFIRMATION_PHRASES = [
  'thank you for applying',
  'thanks for applying',
  'application received',
  'received your application',
  'we received your application',
  'thank you for your application',
  'application has been received',
  'your application to',
  'successfully applied',
  'applying to',
  'apply for',
];

function rejectionPhraseHit(text) {
  const lower = (text || '').toLowerCase();
  return REJECTION_PHRASES.some((p) => lower.includes(p));
}

function confirmationPhraseHit(text) {
  const lower = (text || '').toLowerCase();
  return CONFIRMATION_PHRASES.some((p) => lower.includes(p));
}

// Search the inbox for emails plausibly from a given company. gmail.readonly is
// sufficient for arbitrary q searches via messages.list. We return lightweight
// {id, from, subject, body, internalDate} records for the scanner to classify.
export async function searchCompanyMail(company, { sinceIso, maxResults = 20 } = {}) {
  try {
    if (!gmailClient) {
      const setup = await setupGmailAuth();
      if (!setup || setup.authUrl || setup.error) return { error: 'gmail-unauthorized', messages: [] };
    }
    const name = (company || '').trim();
    if (!name) return { messages: [] };

    // Quote the company name for an exact-ish phrase match across from/subject/body.
    const terms = [`"${name.replace(/"/g, '')}"`];
    if (sinceIso) {
      const t = Date.parse(sinceIso);
      if (!isNaN(t)) terms.push(`after:${Math.floor(t / 1000)}`);
    }
    const q = terms.join(' ');

    const listed = await gmailClient.users.messages.list({ userId: 'me', q, maxResults });
    const ids = (listed.data.messages || []).map((m) => m.id);
    const messages = [];
    for (const id of ids) {
      try {
        const res = await gmailClient.users.messages.get({ userId: 'me', id, format: 'full' });
        const msg = res.data;
        const headers = msg.payload && msg.payload.headers;
        const parts = extractParts(msg.payload);
        const body = parts.plain || htmlToText(parts.html);
        messages.push({
          id: msg.id,
          internalDate: msg.internalDate,
          from: headerValue(headers, 'From'),
          subject: headerValue(headers, 'Subject'),
          body: (body || '').slice(0, 4000),
        });
      } catch (e) {
        console.error('gmail: searchCompanyMail fetch failed', id, e.message);
      }
    }
    return { messages };
  } catch (e) {
    console.error('gmail: searchCompanyMail failed', e.message);
    return { error: e.message, messages: [] };
  }
}

// Classify a company's mail for a rejection signal. Returns
// {rejected, confidence, msg_id, received_at, ambiguous, reason}.
// rejected=true only when a confirmation email exists from the company AND a
// rejection phrase is present (high precision). Cases where a confirmation
// exists but no clear phrase are flagged ambiguous for claude/the user.
export function classifyRejection(company, messages) {
  const name = (company || '').toLowerCase().trim();
  const fromCompany = (messages || []).filter((m) => {
    const blob = `${m.from} ${m.subject} ${m.body}`.toLowerCase();
    return name && blob.includes(name);
  });
  if (!fromCompany.length) {
    return { rejected: false, confidence: 0, ambiguous: false, reason: 'no-company-mail' };
  }

  const hasConfirmation = fromCompany.some(
    (m) => confirmationPhraseHit(`${m.subject} ${m.body}`),
  );

  // Find the strongest rejection-phrase hit (prefer subject hits, then most recent).
  let rejectMsg = null;
  for (const m of fromCompany) {
    if (rejectionPhraseHit(`${m.subject} ${m.body}`)) {
      if (!rejectMsg || Number(m.internalDate) > Number(rejectMsg.internalDate)) rejectMsg = m;
    }
  }

  if (rejectMsg && hasConfirmation) {
    return {
      rejected: true,
      confidence: 0.95,
      msg_id: rejectMsg.id,
      received_at: isoFromInternal(rejectMsg.internalDate),
      ambiguous: false,
      reason: 'phrase+confirmation',
    };
  }
  if (rejectMsg && !hasConfirmation) {
    // Phrase hit but no paired confirmation: weaker. Surface, do not auto-flip.
    return {
      rejected: false,
      confidence: 0.5,
      msg_id: rejectMsg.id,
      received_at: isoFromInternal(rejectMsg.internalDate),
      ambiguous: true,
      reason: 'phrase-no-confirmation',
    };
  }
  if (hasConfirmation) {
    // Confirmed application, no rejection phrase yet: in-flight, not rejected.
    return { rejected: false, confidence: 0, ambiguous: false, reason: 'confirmation-only' };
  }
  return { rejected: false, confidence: 0, ambiguous: false, reason: 'company-mail-no-signal' };
}

export { headerValue, extractParts, decodeBase64Url, htmlToText, isoFromInternal };
