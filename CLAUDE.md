# jobbuddy - Claude Code project instructions

## What this is

A small, pull-based job-application assistant. The successor to `applysprint` (now archived),
deliberately boiled down after applysprint became more futzing than applying. **The user curates
the input** (finds jobs on LinkedIn/BuiltIn/etc and sends them in); JobBuddy scores, preps, and
tracks. There is NO email-alert sourcing, NO dedup machinery, NO polling firehose, NO busy
dashboard - those were the cruft that killed applysprint.

Read `docs/SCHEMA.md` for the full build contract and `README.md` for the flow.

## Core flow

capture (bookmarklet / paste box / Discover) -> Inbox row + snippet-score both personas (also
extracts clean company + title) -> "Prep to apply" (full-JD rescore, status -> 'prepped', reveals
the apply actions) -> open canonical resume (+ optional ATS swap sidebar) / canonical cover letter
-> "Mark applied" writes a clean row to the Applications tracker -> "Scan inbox" updates statuses
from Gmail on demand.

NO per-JD content generation. The cover letter uses Tyler's fixed canonical paragraphs (only the
recipient header varies); the resume is the canonical persona. The ONLY job-specific tailoring is
the scores and the user-driven ATS swap suggestions. (Removed: the old CL-intro and mention-bullet
generators - they customized per JD, which Tyler does not want.)

## Always respect

- **Pull, not push.** The user finds jobs. Never re-add automated sourcing, LinkedIn email
  ingestion, pollers, overnight batches, or cross-source dedup. That was applysprint's mistake.
- **The Google Sheet is the user's home for tracking.** The app writes; the user lives in the
  sheet. Keep the Applications tab pristine and readable (it mirrors his old "JobBuddy" sheet).
- No Anthropic API. All model work via the `claude` CLI subprocess (`server/claude/subprocess.js`),
  `--dangerously-skip-permissions` for headless. Model from `.env` CLAUDE_MODEL (sonnet).
- Two personas only: `variant1` = AI-Native Enablement & L&D, `variant2` = Customer Education.
  master-bank persona names: variant1->internal-enablement, variant2->customer-education.
- Resume/CL editor is loved and stable - do not redesign it without cause.
- UI must stay calm and readable (the old one's busyness was the #1 complaint). One file each:
  web/index.html, web/app.js, web/style.css. No frameworks, no build step.

## Architecture

- Node + Express on `:3000` via launchd KeepAlive `com.hiretyler.jobbuddy.dashboard`
  (plist mirrored in `launchd/`). The ONLY background piece - just the web server.
- Google Sheets = storage (2 tabs: Inbox working queue + Applications tracker). `server/sheets.js`
  reads/writes POSITIONALLY against TAB_COLUMNS (snake_case code keys; pretty display headers
  written by `scripts/bootstrap-sheet.js`).
- Credentials reused from applysprint: same Google service account (`secrets/service-account.json`,
  email `applysprint-sheets@applysprint-496714.iam.gserviceaccount.com`) and the same authorized
  Gmail OAuth token (`tokens/gmail.json`) - no re-auth needed. `.env` has the keys.
- **Repo is PUBLIC - keep personal data local-only.** Two pieces live under gitignored `secrets/`,
  loaded at runtime with a tracked `assets/*.example.json` fallback: `secrets/contact.json` (resume
  phone/email/LinkedIn - injected into the persona HTML's `{{CONTACT_INFO}}` / `{{CONTACT_PHONE_EMAIL}}`
  / `{{CONTACT_WEB_LINKEDIN}}` tokens by `server/personas.js`) and `secrets/master-bank.json` (the
  career bank for ATS swaps). The persona HTML in `assets/personas/` carries placeholders, never real
  contact info. Never commit real contact details or the bank back into tracked files.
- Routes: pipeline.js (capture/score/apply/applied/inbox + DELETE /api/inbox/:id + open-folder),
  resume/cover-letter/persona/ats-swap (prep), status.js (gmail oauth + /api/scan-inbox),
  discover.js (on-demand sources).
- Career archive (`server/archive.js`): the dated folder is created at **Prep to apply** (so it's
  ready to drop PDFs into while applying), at `$ARCHIVE_DIR/<YYYY-MM-DD>/<Company> - <Role>/` with
  the JD + a notes file; Mark applied refreshes the same folder (adds the Applied date). The path
  is anchored on `captured_at` so it stays stable across prep -> applied -> open-folder. Pull, not
  push - only on prep/apply, never background. `ARCHIVE_DIR` in `.env`; unset = silently skipped.
  Open-folder button shells out to macOS `open`, path always recomputed from job_id (never
  client-supplied). No server-side PDF rendering (user prints via Cmd+P).
- The bookmarklet (`web/bookmarklet/install.html`) is GENERATED from `scripts/gen-bookmarklet.mjs`
  (single source for the draggable href + the readable source - they used to drift). Edit the
  script, run `node scripts/gen-bookmarklet.mjs`, restart, re-drag. The Setup tab pulls the live
  href off the install page so it always matches.

## Gotchas / lessons

- **Service accounts cannot CREATE Drive files** (no storage quota -> 403). The JobBuddy sheet
  was created in the user's Drive (via the Drive MCP, owned by him) and shared with the service
  account as Editor. The SA can read/write but never create. `scripts/bootstrap-sheet.js` targets
  the EXISTING sheet id in `.env` GOOGLE_SHEET_ID.
- Headless `claude` CLI returns JSON in ```json fences; subprocess.js extracts before parsing.
- The HTML `hidden` attribute is overridden by any author `display` rule - a dropdown styled
  `display:flex` needs an explicit `[hidden]{display:none}`. (Bit us on the canonical-resumes menu.)
- `/api/scan-inbox` does a Gmail search per non-terminal Applications row; over a full tracker
  (45+ rows) this is SLOW. If it needs to scale, scope it to recent applications or parallelize.
- Worker/entry scripts need `import 'dotenv/config'` first (launchd does not load `.env`).
- Restart the dashboard after server/prompt changes:
  `launchctl kickstart -k gui/$(id -u)/com.hiretyler.jobbuddy.dashboard`. Static web/ assets
  serve fresh from disk (just hard-refresh the browser).

## Provenance

Built 2026-06-13 in a fresh project by lifting the proven applysprint modules (scoring/rescore,
2 personas + master-bank + swap recommender, resume/CL editor, bookmarklet, Gmail status-scan)
and leaving the cut-list behind. applysprint repo is private + archived; its local folder is the
historical reference. Vault: `~/vault/Projects/` (applysprint note has the full lineage).

## Style
Hyphens never em-dashes. No emojis. Terse, operational. Iterative file-by-file edits. Clarify
architecture before building when scope is non-trivial. Confirm before `git push`.
