import { Router } from 'express';

// Discover tab: ON-DEMAND fetch from curated remote-job APIs. No worker, no
// scheduled polling, no ingest, no sheet writes. Pure read-and-return. The UI
// renders the results; clicking one calls POST /api/ingest (another route) to
// push it into the Inbox. This file only reads external sources.

const router = Router();

const TIMEOUT_MS = 10_000;
const SNIPPET_CAP = 600;
const RESULT_CAP = 40;
const UA = 'Mozilla/5.0 JobBuddy/0.1';

// --- source configs (lifted from applysprint sources/*.json) ---
const REMOTIVE_CATEGORIES = ['sales', 'marketing', 'customer-service', 'business'];
const HIMALAYAS_QUERIES = ['sales enablement', 'customer education', 'revenue operations', 'customer success'];
const REMOTEOK_KEYWORDS = [
  'enablement', 'education', 'training', 'l&d', 'learning', 'customer success',
  'customer education', 'onboarding', 'curriculum', 'instructional', 'sales enablement',
  'revenue operations', 'go-to-market', 'go to market',
];
const WWR_FEEDS = [
  'https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss',
  'https://weworkremotely.com/categories/remote-customer-support-jobs.rss',
  'https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss',
];

// --- helpers ---
function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippet(s, n = SNIPPET_CAP) {
  const clean = stripHtml(s);
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}

function toIso(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value; // epoch seconds vs ms
    const d = new Date(ms);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

async function fetchWithTimeout(url, { accept = 'application/json' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept, 'user-agent': UA },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return accept.includes('json') ? await res.json() : await res.text();
  } finally {
    clearTimeout(t);
  }
}

function matchesKeyword(haystack, keywords) {
  const hay = String(haystack || '').toLowerCase();
  return keywords.some((k) => hay.includes(k));
}

function newestFirst(jobs) {
  return jobs.sort((a, b) => {
    const ta = a.posted_at ? Date.parse(a.posted_at) : 0;
    const tb = b.posted_at ? Date.parse(b.posted_at) : 0;
    return (tb || 0) - (ta || 0);
  });
}

// --- per-source fetchers (each returns normalized jobs[]) ---

async function discoverRemotive(q) {
  const all = [];
  // If a keyword is supplied, use Remotive's search param; else pull curated categories.
  if (q) {
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=50`;
    const data = await fetchWithTimeout(url);
    for (const j of Array.isArray(data?.jobs) ? data.jobs : []) {
      all.push(normRemotive(j));
    }
  } else {
    const datasets = await Promise.all(
      REMOTIVE_CATEGORIES.map((c) =>
        fetchWithTimeout(`https://remotive.com/api/remote-jobs?category=${encodeURIComponent(c)}&limit=20`)
          .catch(() => null)
      )
    );
    for (const data of datasets) {
      for (const j of Array.isArray(data?.jobs) ? data.jobs : []) all.push(normRemotive(j));
    }
    if (!datasets.some(Boolean)) throw new Error('all categories failed');
  }
  return all;
}

function normRemotive(j) {
  return {
    company: j?.company_name || '',
    title: j?.title || '',
    url: j?.url || '',
    posted_at: toIso(j?.publication_date),
    jd_snippet: snippet(j?.description || ''),
    source: 'remotive',
  };
}

async function discoverHimalayas(q) {
  const queries = q ? [q] : HIMALAYAS_QUERIES;
  const datasets = await Promise.all(
    queries.map((query) =>
      fetchWithTimeout(`https://himalayas.app/jobs/api/search?query=${encodeURIComponent(query)}&limit=40`)
        .catch(() => null)
    )
  );
  if (!datasets.some(Boolean)) throw new Error('all queries failed');
  const all = [];
  for (const data of datasets) {
    for (const j of Array.isArray(data?.jobs) ? data.jobs : []) {
      all.push({
        company: j?.companyName || '',
        title: j?.title || '',
        url: j?.applicationLink || j?.guid || '',
        posted_at: toIso(j?.pubDate),
        jd_snippet: snippet(j?.description || j?.excerpt || ''),
        source: 'himalayas',
      });
    }
  }
  return all;
}

// Remote OK is a global firehose with no server-side filter; keyword-filter
// client-side against title + tags so the list stays in-domain.
async function discoverRemoteOk(q) {
  const data = await fetchWithTimeout('https://remoteok.com/api');
  const rows = Array.isArray(data) ? data.slice(1) : []; // [0] is metadata
  const keywords = q ? [q.toLowerCase()] : REMOTEOK_KEYWORDS;
  const out = [];
  for (const j of rows) {
    const hay = [j?.position || '', ...(Array.isArray(j?.tags) ? j.tags : [])].join(' ');
    if (!matchesKeyword(hay, keywords)) continue;
    out.push({
      company: j?.company || '',
      title: j?.position || '',
      url: j?.url || j?.apply_url || '',
      posted_at: toIso(j?.date || j?.epoch),
      jd_snippet: snippet(j?.description || ''),
      source: 'remoteok',
    });
  }
  return out;
}

// We Work Remotely publishes RSS per category. Light regex parse of <item> blocks.
function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    items.push(m[1]);
    if (items.length >= 200) break;
  }
  return items;
}

function rssField(block, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(block);
  if (!m) return '';
  let val = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(val);
  if (cdata) val = cdata[1];
  return val.trim();
}

async function discoverWwr(q) {
  const datasets = await Promise.all(
    WWR_FEEDS.map((feed) =>
      fetchWithTimeout(feed, { accept: 'application/rss+xml, application/xml, text/xml' })
        .catch(() => null)
    )
  );
  if (!datasets.some(Boolean)) throw new Error('all feeds failed');
  const out = [];
  for (const xml of datasets) {
    if (!xml) continue;
    for (const block of parseRssItems(xml)) {
      const rawTitle = rssField(block, 'title'); // usually "Company: Role"
      let company = '';
      let title = rawTitle;
      const colon = rawTitle.indexOf(':');
      if (colon > 0) {
        company = rawTitle.slice(0, colon).trim();
        title = rawTitle.slice(colon + 1).trim();
      }
      out.push({
        company,
        title,
        url: rssField(block, 'link'),
        posted_at: toIso(rssField(block, 'pubDate')),
        jd_snippet: snippet(rssField(block, 'description')),
        source: 'wwr',
      });
    }
  }
  if (q) {
    const kw = q.toLowerCase();
    return out.filter((j) => `${j.company} ${j.title} ${j.jd_snippet}`.toLowerCase().includes(kw));
  }
  return out;
}

const SOURCES = {
  remotive: discoverRemotive,
  himalayas: discoverHimalayas,
  remoteok: discoverRemoteOk,
  wwr: discoverWwr,
};

router.get('/api/discover', async (req, res) => {
  const source = String(req.query.source || 'remotive').toLowerCase();
  const q = req.query.q ? String(req.query.q).trim() : '';
  const fetcher = SOURCES[source];

  if (!fetcher) {
    return res.status(200).json({ jobs: [], error: `unknown source '${source}'` });
  }

  try {
    const jobs = await fetcher(q);
    const filtered = jobs.filter((j) => j && (j.title || j.company) && j.url);
    return res.status(200).json({ jobs: newestFirst(filtered).slice(0, RESULT_CAP) });
  } catch (err) {
    console.error(`[discover:${source}]`, err.message);
    return res.status(200).json({ jobs: [], error: `${source} unavailable` });
  }
});

export default router;
