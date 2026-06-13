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
   JobBuddy extracts the JD, scores both personas, and lands it in the **Inbox**.
2. **Prep** - "Prep to apply" runs a full-JD rescore, generates a tailored cover-letter intro +
   3 mention bullets, and opens the editable resume (with one-click ATS swap suggestions from
   the master bank) and cover letter.
3. **Applied** - one click writes a clean row to the **Applications** tab (your tracker).
4. **Scan inbox** - a manual button reads Gmail and updates statuses (confirmation / rejection /
   interview) on your applied rows. No background polling.

## Two personas
- `variant1` = AI-Native Enablement & L&D (`assets/personas/variant1_gtm_enablement.html`)
- `variant2` = Customer Education (`assets/personas/variant2_customer_education.html`)

## Sheet (2 tabs)
- **Inbox** - the app's working queue (captured -> scored -> applied). JD body stored inline.
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
