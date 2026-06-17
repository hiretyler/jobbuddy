# JobBuddy

A small, pull-based job-application assistant. You find jobs (LinkedIn, BuiltIn, anywhere) and
send them in; JobBuddy reads the JD, scores it against two positioning personas, suggests
resume swaps, gives you the editable resume + cover letter, and tracks everything in a clean
Google Sheet that is your home for the pipeline.

Successor to `applysprint`, deliberately boiled down: no email-alert sourcing, no dedup
machinery, no polling firehose, no busy dashboard. You curate the input; the app preps you and
tracks the outcome.

## Flow

1. **Capture** - the bookmarklet (or the paste box, or the Discover tab) sends a job in.
   JobBuddy extracts the JD, scores both personas off a snippet, and lands it in the **Inbox**.
   The scoring pass also extracts a clean company + role title (no job-board / region junk).
2. **Prep** - "Prep to apply" runs a full-JD rescore (more accurate than the intake snippet
   score), flips the row to `prepped`, and reveals the apply actions: the editable canonical
   resume (with one-click ATS swap suggestions from the master bank), the canonical cover
   letter, and the dated archive folder. **No per-JD content is generated** - the cover letter
   uses fixed canonical paragraphs; only the scores and the opt-in ATS swaps are job-specific.
3. **Applied** - one click writes a clean row to the **Applications** tab (your tracker). The
   dated career-archive folder (created at Prep) holds the JD + a notes file; you drop your
   printed resume/CL PDFs in there.
4. **Scan inbox** - a manual button reads Gmail and updates statuses (confirmation / rejection /
   interview) on your applied rows. No background polling.

A **Setup** tab in the app has the draggable bookmarklet and relaunch-from-a-fresh-clone steps.

## Two personas
- `variant1` = AI-Native Enablement & L&D (`assets/personas/variant1_gtm_enablement.html`)
- `variant2` = Customer Education (`assets/personas/variant2_customer_education.html`)

The "Canonical resumes" menu serves both persona resumes, both persona cover letters, and a
hand-written generic "AI Adoption" cover letter - all editable in-browser, Cmd+P to print.

## Local-only data (the repo is public)
Personal data is gitignored and loaded at runtime, with tracked `*.example.json` fallbacks:
- `secrets/contact.json` - resume contact info, injected into the persona HTML placeholders.
- `secrets/master-bank.json` - the career bank that powers the ATS swap suggestions.

A fresh clone needs these restored (plus `.env`, `secrets/service-account.json`,
`tokens/gmail.json`). The Setup tab lists the steps.

## Sheet (2 tabs)
- **Inbox** - the app's working queue (`new -> scored -> prepped -> applied`). JD body stored
  inline. (`cl_paragraph`/`mention_bullets` columns survive for schema stability but are unused.)
- **Applications** - your pristine tracker, written only on Apply. Mirrors the old JobBuddy
  spreadsheet columns; the last few helper columns (Link/Score/Persona/_job_id) are hideable.

Schema details: `docs/SCHEMA.md`. Code uses snake_case keys; the sheet shows pretty headers.

## Run
- Lives at `http://localhost:3000` via a launchd KeepAlive agent
  (`com.hiretyler.jobbuddy.dashboard`, plist mirrored in `launchd/`). The ONLY background piece -
  it is just the web server, no pollers.
- Manual run: `npm start`. Bootstrap/repair the sheet: `npm run bootstrap-sheet`.
- All model work via the headless `claude` CLI (no Anthropic API). Google Sheets is storage.
  Gmail OAuth + service account reused from applysprint (same credentials).

## Stack
Node + Express, Google Sheets API, `claude` CLI subprocess, jsdom. Five npm deps.
