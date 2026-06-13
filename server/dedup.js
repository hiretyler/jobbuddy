// Dedup key generation for role rows.
// URL-based when we have an ATS link; falls back to company+role slug.
//
// Canonical-URL + identity logic now lives in server/identity.js (the single
// source of truth). This module keeps the historical dedupKey / appliedIdentities
// contract and the name: slug fallback.

import { canonicalIdentity, canonicalizeAtsUrl, normalizeTitle, normalizeCompany } from './identity.js';

// Re-export so existing importers (jd-prefetch, manual, jd-capture, ingest,
// ingest-filter, dashboard) keep working unchanged.
export { canonicalizeAtsUrl, canonicalIdentity, normalizeTitle, normalizeCompany };

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function dedupKey(role) {
  const { ats_canonical_url, ats_url, company, role: roleTitle } = role || {};

  if (ats_canonical_url && String(ats_canonical_url).trim()) {
    return `url:${canonicalizeAtsUrl(ats_canonical_url)}`;
  }
  if (ats_url && String(ats_url).trim()) {
    return `url:${canonicalizeAtsUrl(ats_url)}`;
  }
  return `name:${slugify(company)}:${slugify(roleTitle)}`;
}

// Identity signals for cross-source suppression. The dedup_key alone is not
// enough to suppress a job that was applied via one ATS host (e.g. Greenhouse)
// and later re-alerted via a different host (e.g. LinkedIn) - those produce
// different url: keys. appliedIdentities returns ALL stable signals a role
// carries so the dashboard can suppress any re-alert that matches an
// already-applied role on ANY signal.
export function appliedIdentities(role) {
  const out = new Set();
  const { dedup_key, ats_canonical_url, ats_url, company, role: roleTitle } = role || {};

  if (dedup_key && String(dedup_key).trim()) out.add(String(dedup_key).trim());

  const canon = ats_canonical_url || ats_url;
  if (canon && String(canon).trim()) out.add(`url:${canonicalizeAtsUrl(canon)}`);

  // company+title fallback catches the cross-host LinkedIn-vs-X case.
  const co = slugify(company);
  const title = slugify(roleTitle);
  if (co && title) out.add(`name:${co}:${title}`);

  return out;
}

// Conservative fuzzy identity for "possible repeat" flagging (flag, don't hide).
// A row's fuzzy key is normalizeCompany + normalizeTitle. Two rows with the same
// fuzzy key but DIFFERENT exact identities are probable reposts/title-drifts.
// Returns '' when either side is missing (never fuzzy-match on company alone).
export function fuzzyKey(role) {
  const co = normalizeCompany(role && role.company);
  const title = normalizeTitle(role && role.role);
  if (!co || !title) return '';
  return `fuzzy:${co}:${title}`;
}

export { slugify };
