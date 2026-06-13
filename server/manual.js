// On-demand single-URL extractor for the pull-based capture flow. Given a URL,
// FETCH the page and EXTRACT { company, title, jd_body } - it writes NO sheet rows
// (routes/pipeline.js owns all writes). Returns null on fetch failure / auth wall
// so the caller can fall back to the bookmarklet.
//
// Adapted from applysprint server/sources/manual.js. The old-schema sheet-shaped
// return (source/received_at/ats_url/ats_canonical_url/snippet) and the
// auth-walled-stub branch were stripped; isAuthWalled lives in jd-prefetch.js.

import { JSDOM } from 'jsdom';

const TIMEOUT_MS = 15_000;
const UA = 'Mozilla/5.0 JobBuddy/0.1';

function stripHtml(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function textOf(doc, selector) {
  if (!doc) return '';
  const el = doc.querySelector(selector);
  if (!el) return '';
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

function bodyTextOf(doc, selector) {
  if (!doc) return '';
  const el = doc.querySelector(selector);
  if (!el) return '';
  return (el.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function tryGreenhouse(doc, url) {
  const role = textOf(doc, '.app-title');
  if (!role && !url.includes('greenhouse')) return null;
  if (!role) return null;
  const company = textOf(doc, '.company-name');
  const location = textOf(doc, '.location');
  const body = bodyTextOf(doc, '#content');
  return { role, company, location, body, vendor: 'greenhouse' };
}

function tryLever(doc, url) {
  const role = textOf(doc, '.posting-headline h2');
  if (!role && !url.includes('lever.co')) return null;
  if (!role) return null;
  const location = textOf(doc, '.posting-categories .location');
  const body = bodyTextOf(doc, '.section-wrapper .section.page-centered');
  let company = '';
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length > 0) company = parts[0];
  } catch {}
  return { role, company, location, body, vendor: 'lever' };
}

function tryAshby(doc, url) {
  const role = textOf(doc, '.ashby-job-posting-heading');
  if (!role && !url.includes('ashbyhq')) return null;
  if (!role) return null;
  const body = bodyTextOf(doc, '.ashby-job-posting-content');
  let company = '';
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length > 0) company = parts[0];
  } catch {}
  return { role, company, location: '', body, vendor: 'ashby' };
}

function tryLinkedIn(doc, url) {
  const role = textOf(doc, '.job-details-jobs-unified-top-card__job-title')
    || textOf(doc, '.topcard__title');
  if (!role && !url.includes('linkedin.com')) return null;
  if (!role) return null;
  const company = textOf(doc, '.job-details-jobs-unified-top-card__company-name')
    || textOf(doc, '.topcard__org-name-link');
  const location = textOf(doc, '.job-details-jobs-unified-top-card__bullet')
    || textOf(doc, '.topcard__flavor--bullet');
  const body = bodyTextOf(doc, '.jobs-description__content')
    || bodyTextOf(doc, '.description__text');
  return { role, company, location, body, vendor: 'linkedin' };
}

function tryJsonLd(doc) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const s of Array.from(scripts)) {
    let parsed;
    try {
      parsed = JSON.parse(s.textContent || '');
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      const graph = node['@graph'] && Array.isArray(node['@graph']) ? node['@graph'] : [node];
      for (const item of graph) {
        const t = item['@type'];
        const isJob = t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'));
        if (!isJob) continue;
        return {
          role: item.title || '',
          company: item.hiringOrganization?.name || '',
          location: item.jobLocation?.address?.addressLocality
            || item.jobLocation?.address?.addressRegion
            || (Array.isArray(item.jobLocation) ? item.jobLocation[0]?.address?.addressLocality : '')
            || '',
          body: stripHtml(item.description || ''),
          vendor: 'jsonld',
        };
      }
    }
  }
  return null;
}

function companyFromHostname(host) {
  if (!host) return '';
  const h = host.toLowerCase().replace(/^www\./, '');
  if (h.includes('greenhouse.io') || h.includes('lever.co') || h.includes('ashbyhq.com') ||
      h.includes('myworkdayjobs.com') || h.includes('icims.com') || h.includes('linkedin.com')) {
    return '';
  }
  const label = h.split('.')[0];
  if (!label) return '';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function mainBodyText(doc) {
  const clone = doc.cloneNode ? doc.cloneNode(true) : doc;
  const noisy = clone.querySelectorAll('nav, header, footer, aside');
  for (const el of Array.from(noisy)) el.remove();
  return bodyTextOf(clone, 'main') || bodyTextOf(clone, 'article') || bodyTextOf(clone, 'body');
}

function tryFallback(doc, url) {
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
  const pageTitle = textOf(doc, 'title');
  const h1 = textOf(doc, 'h1');
  const title = og || pageTitle || h1;
  let role = title;
  let company = '';
  const m = title.match(/^(.+?)\s+at\s+(.+)$/i);
  if (m) {
    role = m[1].trim();
    company = m[2].trim();
  }

  if (!company) {
    company = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || '';
  }
  if (!company) {
    company = doc.querySelector('meta[name="application-name"]')?.getAttribute('content')
      || doc.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')
      || '';
  }
  if (!company) {
    try { company = companyFromHostname(new URL(url).hostname); } catch {}
  }

  const body = mainBodyText(doc);
  return { role, company, location: '', body, vendor: 'unknown' };
}

export function extractFromAtsPage(html, url) {
  if (!html) return null;
  let dom;
  try {
    dom = new JSDOM(html, { url });
  } catch (err) {
    console.error('[manual:parse]', err.message);
    return null;
  }
  const doc = dom.window.document;
  const candidates = [tryGreenhouse, tryLever, tryAshby, tryLinkedIn];
  for (const fn of candidates) {
    const out = fn(doc, url);
    if (out && out.role) return out;
  }
  const ld = tryJsonLd(doc);
  if (ld && ld.role) return ld;
  return tryFallback(doc, url);
}

// ingestUrl(url) -> { company, title, jd_body } | null
// Fetches the page and extracts the three fields pipeline.js needs. Returns null
// on any fetch error (timeout, non-2xx, abort) so the caller falls back to the
// bookmarklet. Does NOT touch the sheet.
export async function ingestUrl(url) {
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const html = await res.text();
    const extracted = extractFromAtsPage(html, url) || {};
    return {
      company: extracted.company || '',
      title: extracted.role || '',
      jd_body: extracted.body || '',
    };
  } catch (err) {
    console.error('[manual]', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
