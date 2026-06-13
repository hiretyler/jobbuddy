// Single source of truth for a job posting's STABLE IDENTITY.
//
// Every LinkedIn URL form (/jobs/view/<id>, ?currentJobId=<id>, /comm/ tracking
// wrappers, mwlite./m. mobile hosts, linkedin:// app deep-links, trailing slashes)
// and every ATS vendor must resolve to the SAME identity here, so a job applied/
// rejected under one URL form is recognized when it re-alerts under another.
//
// This is the single source of truth for canonical identity. (The old
// server/apps-script/intake.gs parity mirror was removed 2026-06-13 when the
// iOS-Shortcut/GAS intake path was abandoned.) Rules are covered by the shared
// fixture in test/identity.test.js.

const LEGAL_SUFFIX_RE =
  /\b(?:inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|plc|sa|nv|ab|pty|holdings|group)\b/g;

// Title qualifiers that drift between a posting and its repost without changing
// the underlying job: "(Remote)", "- US", "| Hybrid", seniority-stable wrappers.
const TITLE_QUALIFIER_RE =
  /\b(?:remote|us|usa|united\s*states|anywhere|hybrid|on-?site|in-?office|contract|full[-\s]?time|part[-\s]?time|ft|pt|w2|1099)\b/g;

function stripTrailingSlash(p) {
  if (p && p.length > 1 && p.endsWith('/')) return p.slice(0, -1);
  return p;
}

// Pull a LinkedIn numeric job id out of ANY url shape, including percent-encoded
// tracking wrappers (the real /jobs/view/<id> is often encoded inside ?url=...).
function linkedInJobId(raw) {
  let s = String(raw || '');
  // Decode up to twice - LinkedIn email links double-encode the wrapped target.
  for (let i = 0; i < 2; i += 1) {
    try {
      const dec = decodeURIComponent(s);
      if (dec === s) break;
      s = dec;
    } catch {
      break;
    }
  }
  const patterns = [
    /\/jobs\/view\/(\d{5,})/,
    /currentJobId=(\d{5,})/,
    /[?&]jobId=(\d{5,})/,
    /\/jobs\/(\d{8,})/, // mobile/app variant: /jobs/<id> with no /view/
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  return null;
}

function vendorFromHost(host, raw) {
  const h = host || '';
  if (h.endsWith('linkedin.com')) return 'linkedin';
  if (h === 'boards.greenhouse.io' || h.endsWith('.greenhouse.io')) return 'greenhouse';
  if (h === 'jobs.lever.co' || h.endsWith('lever.co')) return 'lever';
  if (h === 'jobs.ashbyhq.com' || h.endsWith('ashbyhq.com')) return 'ashby';
  if (h.includes('myworkdayjobs.com') || h.includes('workday.com')) return 'workday';
  if (h.includes('icims.com')) return 'icims';
  // linkedin:// app deep-links have an empty/odd host; sniff the raw string.
  if (/(^|\W)linkedin/i.test(String(raw || ''))) return 'linkedin';
  return host ? 'other' : 'unknown';
}

// canonicalIdentity(url) -> { id, canonicalUrl, vendor }
//   id          - the stable matching key (what dedup compares on)
//   canonicalUrl- normalized display/storage URL
//   vendor      - greenhouse | lever | ashby | workday | icims | linkedin | other | unknown
export function canonicalIdentity(url) {
  const raw = String(url || '').trim();
  if (!raw) return { id: '', canonicalUrl: '', vendor: 'unknown' };

  // LinkedIn first - it can arrive as linkedin:// or behind a tracking wrapper,
  // so try the id extractor BEFORE relying on a parseable URL/host.
  const liId = /linkedin/i.test(raw) ? linkedInJobId(raw) : null;

  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch {
    // Unparseable (e.g. linkedin://jobs/view/123). Fall back to id-only identity.
    if (liId) {
      const canonicalUrl = `https://linkedin.com/jobs/view/${liId}`;
      return { id: `linkedin:${liId}`, canonicalUrl, vendor: 'linkedin' };
    }
    const lowered = raw.toLowerCase();
    return { id: `raw:${lowered}`, canonicalUrl: lowered, vendor: 'unknown' };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = stripTrailingSlash(parsed.pathname);
  const vendor = vendorFromHost(host, raw);

  if (vendor === 'linkedin') {
    if (liId) {
      const canonicalUrl = `https://linkedin.com/jobs/view/${liId}`;
      return { id: `linkedin:${liId}`, canonicalUrl, vendor };
    }
    // LinkedIn URL with no extractable id - keep host+path, but normalize the
    // host so m./mwlite. collapse to linkedin.com.
    const canonicalUrl = `https://linkedin.com${path}`;
    return { id: `url:${canonicalUrl}`, canonicalUrl, vendor };
  }

  // All other vendors: host + path is canonical (tracking query/fragment dropped).
  const canonicalUrl = `https://${host}${path}`;
  return { id: `url:${canonicalUrl}`, canonicalUrl, vendor };
}

// Back-compat shim: the historical canonical URL string for a posting. Existing
// dedup keys (`url:<this>`) for non-LinkedIn rows are unchanged by design.
export function canonicalizeAtsUrl(url) {
  if (!url) return '';
  return canonicalIdentity(url).canonicalUrl;
}

// Conservative fuzzy-match normalizers. Used by ingest fuzzy-repeat detection to
// flag (NOT hide) probable reposts. "Flag don't hide" tolerates false positives
// here, so keep these forgiving but stable.
export function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // drop parenthetical qualifiers wholesale
    .replace(/[‐-―|/,]/g, ' ') // dashes, pipes, slashes, commas -> space
    .replace(TITLE_QUALIFIER_RE, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeCompany(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(LEGAL_SUFFIX_RE, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
