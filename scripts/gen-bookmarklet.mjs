// Regenerates web/bookmarklet/install.html from ONE canonical bookmarklet source,
// so the draggable href and the readable <pre> source can never drift apart.
// Run: node scripts/gen-bookmarklet.mjs
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'web', 'bookmarklet', 'install.html');

// Canonical bookmarklet JS, assembled from readable parts then flattened to one line.
// No `//` comments and every statement terminated, so newline->space flattening is safe.
const PARTS = [
"(function(){",
"function q(s,r){r=r||document;var e=r.querySelector(s);return e?(e.innerText||e.textContent||'').trim():''}",
// All readable documents: the top page plus any SAME-ORIGIN iframe (iCIMS embeds the JD this way).
"function docs(){var out=[document];try{var f=document.getElementsByTagName('iframe');for(var i=0;i<f.length;i++){try{var d=f[i].contentDocument;if(d&&d.body)out.push(d)}catch(e){}}}catch(e){}return out}",
// Largest visible text block across every readable document.
"function big(){var best='',ds=docs();for(var k=0;k<ds.length;k++){var root=ds[k].querySelector('main')||ds[k].body;if(!root)continue;var els=root.querySelectorAll('article,section,div');for(var i=0;i<els.length;i++){var t=(els[i].innerText||'').trim();if(t.length>best.length)best=t}if(!els.length){var rt=(root.innerText||'').trim();if(rt.length>best.length)best=rt}}return best}",
// A CROSS-ORIGIN iframe we can't read but whose src is a fetchable job board (Greenhouse/Lever/etc).
"function atsIframe(){var f=document.getElementsByTagName('iframe'),re=/greenhouse|lever|ashbyhq|workable|smartrecruiters|jobvite|bamboohr|recruitee|icims|myworkday/i;for(var i=0;i<f.length;i++){var acc=false;try{acc=!!(f[i].contentDocument&&f[i].contentDocument.body)}catch(e){acc=false}if(!acc){var s=f[i].src||'';if(re.test(s))return s}}return ''}",
"function jsonLd(){var s=document.querySelectorAll('script[type=\"application/ld+json\"]');for(var i=0;i<s.length;i++){try{var d=JSON.parse(s[i].textContent);var a=Array.isArray(d)?d:[d];for(var j=0;j<a.length;j++){if(a[j]&&a[j]['@type']==='JobPosting')return a[j]}}catch(e){}}return null}",
"function meta(){var h=location.hostname,pd='',na='';if(h.indexOf('linkedin.com')>-1){pd=q('.job-details-jobs-unified-top-card__primary-description-container time')||q('.posted-time-ago__text')||q('span.tvm__text--neutral time')||'';var ac=q('.job-details-jobs-unified-top-card__applicant-count')||q('.num-applicants__caption')||'';var am=ac.match(/([0-9,]+)\\s*applicant/i);if(am)na=am[1].replace(/,/g,'')}else if(h.indexOf('builtin.com')>-1){pd=q('[data-id=\"posted-date\"]')||q('.job-post-date')||q('time')||'';var bc=q('[data-id=\"applicant-count\"]')||'';var bm=bc.match(/([0-9,]+)/);if(bm)na=bm[1].replace(/,/g,'')}return{posted_date:pd,num_applicants:na}}",
"function extract(){var h=location.hostname,site='generic',title='',company='',loc='',body='';if(h.indexOf('linkedin.com')>-1){site='linkedin';title=q('.job-details-jobs-unified-top-card__job-title');company=q('.job-details-jobs-unified-top-card__company-name');loc=q('.job-details-jobs-unified-top-card__bullet');body=q('.jobs-description__content')}else if(h.indexOf('ashbyhq.com')>-1){site='ashby';title=q('h1');company=q('[class*=\"company-name\" i]')||q('[class*=\"companyName\" i]');body=q('[class*=\"job-description\" i]')||q('[class*=\"jobDescription\" i]')||q('[class*=\"posting-description\" i]')||q('main')}else if(h.indexOf('workday')>-1||h.indexOf('myworkdayjobs')>-1){site='workday';title=q('[data-automation-id=\"jobPostingHeader\"]');body=q('[data-automation-id=\"job-posting-details\"]')}else if(h.indexOf('icims')>-1){site='icims';title=q('.iCIMS_JobHeader h1');body=q('.iCIMS_JobContent')}if(!title){title=q('h1')||(document.querySelector('meta[property=\"og:title\"]')||{}).content||document.title}var ld=jsonLd();if(ld){if(!title&&ld.title)title=ld.title;if(!company&&ld.hiringOrganization)company=ld.hiringOrganization.name||'';if(!loc&&ld.jobLocation){var jl=Array.isArray(ld.jobLocation)?ld.jobLocation[0]:ld.jobLocation;if(jl&&jl.address)loc=jl.address.addressLocality||jl.address.addressRegion||''}if(!body&&ld.description){var tmp=document.createElement('div');tmp.innerHTML=ld.description;body=(tmp.innerText||tmp.textContent||'').trim()}}var fb=big();if(fb.length>body.length)body=fb;var md=meta();var pd=md.posted_date;if(!pd&&ld&&ld.datePosted)pd=ld.datePosted;return{url:location.href,site:site,source:'desktop',company:company,role:title,location:loc,body:body,posted_date:pd,num_applicants:md.num_applicants,captured_at:new Date().toISOString()}}",
"function popup(p){var b64=btoa(unescape(encodeURIComponent(JSON.stringify(p))));var w=window.open('http://localhost:3000/bookmarklet/proxy?#'+b64,'jobbuddy','width=480,height=320');if(!w)alert('JobBuddy: popup blocked - allow popups for this site.');else alert('Saving to JobBuddy...')}",
"var payload=extract();",
// If the page text is too thin, the JD is likely in a cross-origin board iframe; hand its
// src to the server to fetch. Only give up (with the scroll hint) when there's no such iframe.
"if(payload.body.length<300){var fu=atsIframe();if(fu){payload.fetch_url=fu}else{alert('JobBuddy: JD didn\\'t load yet - scroll until the description is visible, then click again.');return}}",
"try{fetch('http://localhost:3000/jd-capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json().catch(function(){return{}})}).then(function(data){try{if(typeof BroadcastChannel==='function'){var bc=new BroadcastChannel('jobbuddy');bc.postMessage({type:'jd-captured',job_id:data&&data.job_id,url:payload.url});bc.close()}}catch(_e){}alert('Saved to JobBuddy.')}).catch(function(){popup(payload)})}catch(e){popup(payload)}",
"})();",
];

const JS = PARTS.join('');

// Validate it parses before writing anything.
// eslint-disable-next-line no-new-func
new Function(JS);

const href = 'javascript:' + JS.replace(/"/g, '%22');

const htmlEscape = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Show the source one logical chunk per line so the <pre> stays skimmable.
const prettySrc = PARTS.join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>JobBuddy JD grabber</title>
<style>
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; max-width: 720px; margin: 2em auto; padding: 0 1em; color: #222; }
  h1 { font-size: 1.4em; margin-bottom: 0.2em; }
  p { color: #444; }
  a.bookmarklet { display: inline-block; padding: 10px 16px; background: #1a1a1a; color: #fff; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 1em 0; }
  a.bookmarklet:hover { background: #333; }
  pre { background: #f4f4f4; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; line-height: 1.4; }
  code { font-family: ui-monospace, Menlo, monospace; }
</style>
</head>
<body>
<h1>JobBuddy JD grabber</h1>
<p>One bookmarklet for every job page. Drag the bookmark below to your bookmarks bar. On a job posting, click it: it grabs the URL + visible JD text (plus posting date and applicant count when the page shows them) and sends it straight to JobBuddy. It also reads the description out of same-origin embeds (iCIMS) and, when the JD sits in a cross-origin board iframe (Greenhouse, Lever, and friends), hands that board URL to JobBuddy to fetch server-side. On strict sites (LinkedIn, Workday, Eightfold) where the page blocks background requests, it automatically falls back to a brief popup that routes through <code>localhost</code> to save it. The captured job lands in your Inbox, scored, ready to prep.</p>

<a class="bookmarklet" href="${href}">Grab JD &rarr; JobBuddy</a>

<p>If selectors break, the source is below - tweak <code>scripts/gen-bookmarklet.mjs</code> and re-run it.</p>

<pre><code>${htmlEscape(prettySrc)}</code></pre>
</body>
</html>
`;

await writeFile(OUT, html, 'utf8');
process.stdout.write(`wrote ${OUT}\nhref length: ${href.length}\n`);
