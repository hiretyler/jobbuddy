// On-demand JD fetcher for pull-based capture. Given a URL, fetch + extract the
// visible JD text. Auth-walled hosts (LinkedIn, Workday, iCIMS, ...) throw with
// code AUTH_WALLED so the caller can route the user to the bookmarklet instead.
//
// Adapted from applysprint server/jd-prefetch.js. The applysprint-only
// prefetchTopCards (grid-prefetch worker) was dropped - JobBuddy is pull-based.

import { JSDOM } from 'jsdom';
import { canonicalizeAtsUrl } from './identity.js';

const AUTH_WALLED_HOSTS = [
  'linkedin.com',
  'workday.com',
  'myworkdayjobs.com',
  'icims.com',
  'eightfold.ai',
  'ashbyhq.com',
];

const UA = 'Mozilla/5.0 JobBuddy/0.1';

export function isAuthWalled(url) {
  if (!url) return false;
  let host;
  try {
    host = new URL(String(url).trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  return AUTH_WALLED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

function extractBody(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  doc.querySelectorAll('script, style, noscript, svg, iframe, nav, footer, header').forEach((n) => n.remove());

  const candidates = [
    ...doc.querySelectorAll('article'),
    ...doc.querySelectorAll('main'),
    ...doc.querySelectorAll('[role="main"]'),
    ...doc.querySelectorAll('[class*="job-description" i]'),
    ...doc.querySelectorAll('[class*="posting-description" i]'),
    ...doc.querySelectorAll('[data-automation-id="job-posting-details"]'),
  ];

  let best = '';
  for (const el of candidates) {
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (txt.length > best.length) best = txt;
  }

  if (best.length < 200) {
    best = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  return best;
}

export async function fetchJdBody(url, { timeoutMs = 15000 } = {}) {
  if (!url) throw new Error('fetchJdBody: missing url');
  if (isAuthWalled(url)) {
    const err = new Error(`auth-walled: ${url}`);
    err.code = 'AUTH_WALLED';
    throw err;
  }

  const canonical = canonicalizeAtsUrl(url);
  const target = canonical || url;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(target, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`fetch failed: ${e.message}`);
  }
  clearTimeout(timer);

  if (!res.ok) throw new Error(`fetch ${res.status}: ${target}`);

  const html = await res.text();
  const body = extractBody(html);
  if (!body || body.length < 80) throw new Error(`empty body: ${target}`);

  return {
    method: 'direct',
    body,
    body_length: body.length,
    fetched_at: new Date().toISOString(),
  };
}
