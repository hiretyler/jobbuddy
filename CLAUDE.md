# jobbuddy - Claude Code project instructions

## What this is

A small, pull-based job-application assistant. The successor to `applysprint` (now archived),
deliberately boiled down after applysprint became more futzing than applying. **The user curates
the input** (finds jobs on LinkedIn/BuiltIn/etc and sends them in); JobBuddy scores all three
personas, opens the chosen canonical docs, and tracks the outcome. There is NO email-alert
sourcing, NO dedup machinery, NO polling firehose, NO busy dashboard - those were the cruft that
killed applysprint.

Read `docs/SCHEMA.md` for the full build contract and `README.md` for the flow.

## Core flow

capture (bookmarklet / paste box / Discover) -> Inbox row + **full-JD score of all 3 personas in
one pass** (also extracts the clean company + title), status -> 'scored' -> the Inbox card shows
the 3 scores + reasons and offers **Reject** or **pick one of 3 personas** -> selecting a persona
(`/api/select`) sets `recommended_persona`, status -> 'prepped', creates the dated archive folder,
and the UI opens the chosen canonical resume + cover letter in new tabs -> from there: **Mark
applied** (writes the Applications tracker), **Did not apply** (writes the Did Not Apply tab, moves
the folder), or **Help with questions** (spawns a Claude terminal preloaded with the JD + docs +
bank). A Google Apps Script (deployed separately, runs as the user) watches Gmail and updates
Applications statuses on a time trigger.

NO per-JD content generation and NO in-app editing or AI customization. The resume and cover
letter are the fixed canonical persona files. The ONLY job-specific tailoring is (a) the 3 scores
and (b) three editable fields in the rendered docs - `.company` (cover letter), `.jobtitle`
(resume), `.skills-container` (resume) - which the app pre-fills and lets the user tweak before
printing. (Removed in the realign: the contenteditable editor, the ATS-swap sidebar, the old
CL-intro / mention-bullet generators, and the standalone generic AI-Adoption cover letter.)

## Always respect

- **Pull, not push.** The user finds jobs. Never re-add automated job sourcing, LinkedIn email
  ingestion, pollers, overnight batches, or cross-source dedup. That was applysprint's mistake.
  (The Apps Script Gmail watcher is fine - it only updates statuses of jobs already applied to,
  it does not source.)
- **The Google Sheet is the user's home for tracking.** The app writes; the user lives in the
  sheet. Keep the Applications tab pristine and readable (it mirrors his old "JobBuddy" sheet).
- No Anthropic API. All model work via the `claude` CLI subprocess (`server/claude/subprocess.js`),
  `--dangerously-skip-permissions` for headless. Model from `.env` CLAUDE_MODEL (sonnet).
- Three personas: `variant1` = GTM Enablement, `variant2` = Customer Education, `variant3` =
  Internal Enablement (a.k.a. "AI Adoption" - remote-first / async / AI-adoption / behavior-change
  at scale). Friendly UI labels: GTM Enablement / Customer Education / AI Adoption.
- Resume/CL are rendered **read-only except** the `.company` / `.jobtitle` / `.skills-container`
  fields. No editor, no toggle, no AI rewrite. The user owns the HTML in `assets/personas/`.
- UI must stay calm and readable (the old one's busyness was the #1 complaint). One file each:
  web/index.html, web/app.js, web/style.css. No frameworks, no build step.

## Architecture

- Node + Express on `:3000` via launchd KeepAlive `com.hiretyler.jobbuddy.dashboard`
  (plist mirrored in `launchd/`). The web server is the only background piece on this machine;
  the Apps Script watcher runs in Google's cloud as the user.
- Google Sheets = storage, **4 tabs**: `Inbox` (working queue), `Applications` (tracker),
  `Rejected` (pre-selection rejects), `Did Not Apply` (post-selection bail-outs). `server/sheets.js`
  reads/writes POSITIONALLY against TAB_COLUMNS (snake_case code keys; pretty display headers
  written by `scripts/bootstrap-sheet.js`). All three persona scores + the selected/recommended
  persona are carried into every destination tab.
- **Inbox is a live queue.** Rows hold status `new` -> `scored` -> `prepped`. Terminal actions
  (Mark applied / Reject / Did not apply) copy the row to the right tracking tab and then DELETE
  the Inbox row.
- Credentials: Google service account (`secrets/service-account.json`, email
  `applysprint-sheets@applysprint-496714.iam.gserviceaccount.com`) shared as Editor on the sheet.
  The old Gmail OAuth token (`tokens/gmail.json`) and `GMAIL_OAUTH_*` / `GMAIL_TOKEN_PATH` env keys
  are now UNUSED by the Node app - Gmail scanning moved to the Apps Script.
- **Repo is PUBLIC - keep personal data local-only.** Two pieces live under gitignored `secrets/`,
  loaded at runtime with a tracked `assets/*.example.json` fallback: `secrets/contact.json` (resume
  phone/email/LinkedIn - injected into the persona HTML's `{{CONTACT_INFO}}` / `{{CONTACT_PHONE_EMAIL}}`
  / `{{CONTACT_WEB_LINKEDIN}}` tokens by `server/personas.js`) and `secrets/master-bank.json` (the
  fuller career bank, copied into a job folder for the Help-with-questions Claude session). The
  persona HTML in `assets/personas/` carries `{{CONTACT_*}}` placeholders, never real contact info.
  Never commit real contact details, the bank, or per-job cover-letter contact lines.
- Personas live as **6 split files** in `assets/personas/` - a separate resume + cover letter per
  variant (`variantN_<slug>_resume.html`, `variantN_<slug>_cover_letter.html`). The user maintains
  these by hand: they carry the `{{CONTACT_*}}` tokens and the editable `.company` / `.jobtitle` /
  `.skills-container` markers. `server/personas.js` injects contact, fills the editable fields for
  job-specific serves (via JSDOM), and injects a tiny script that makes only those fields
  contenteditable. Cmd+P prints.
- Routes: `pipeline.js` (capture/score + select/applied/reject/did-not-apply/help-questions +
  DELETE /api/inbox/:id + open-folder), `resume.js` / `cover-letter.js` / `persona.js` (serve the
  canonical + job-specific docs read-only), `discover.js` (on-demand sources). The canonical docs
  menu = 3 resumes + 3 cover letters. (Removed: `ats-swap.js`, `status.js`, the generic
  `/api/cover-letter/ai-adoption` route.)
- Company/title accuracy: `deriveCompany`/`cleanCompany`/`cleanTitle` in pipeline.js give a clean
  first guess (reject job-board hosts, region tokens, "Application"-type junk); the full-JD scoring
  pass (`scoreFullJd3` -> prompt `server/claude/prompts/fulljd-score3.md`) then extracts the
  authoritative company + title from the JD and writes them.
- Career archive (`server/archive.js`): the dated folder is created at **persona select** (so it's
  ready to drop PDFs into while applying), at `$ARCHIVE_DIR/<YYYY-MM-DD>/<Company> - <Role>/` with
  the JD + a notes file; Mark applied refreshes the same folder (adds the Applied date). The path
  is anchored on `captured_at` so it stays stable across select -> applied -> open-folder. Did not
  apply moves the folder into `$ARCHIVE_DIR/<YYYY-MM-DD>/didnt apply/<Company> - <Role>/`. Pull,
  not push - only on these user actions, never background. `ARCHIVE_DIR` in `.env`; unset = silently
  skipped. Open-folder shells out to macOS `open`, path always recomputed from job_id (never
  client-supplied). No server-side PDF rendering (user prints via Cmd+P).
- Help-with-questions (`/api/help-questions` + `server/terminal.js`): writes `resume.html`,
  `cover-letter.html` (rendered for the selected persona), `master-bank.json`, and a priming
  `CLAUDE.md` into the job folder, then spawns Terminal.app `cd`'d there running the `claude` CLI
  (via `osascript`; binary from `.env` CLAUDE_BIN). The spawned session helps answer detailed
  application questions grounded in the bank. macOS-only.
- Gmail watcher (`apps-script/`): a standalone Apps Script the user deploys against the sheet
  (`SpreadsheetApp.openById`), on a time trigger, running as his own Google account so `GmailApp`
  reaches his inbox natively. It reads non-terminal Applications rows, classifies mail
  (confirmation/rejection/interview) with the ported heuristics, and writes status back. NOTE: it
  cannot call the local `claude` CLI, so the ambiguous-rejection escalation is replaced by a
  conservative rule - a rejection phrase WITHOUT a matching confirmation is left unchanged. See
  `apps-script/README.md`.
- The bookmarklet (`web/bookmarklet/install.html`) is GENERATED from `scripts/gen-bookmarklet.mjs`
  (single source for the draggable href + the readable source - they used to drift). Edit the
  script, run `node scripts/gen-bookmarklet.mjs`, restart, re-drag. The Setup tab pulls the live
  href off the install page so it always matches.

## Gotchas / lessons

- **Service accounts cannot CREATE Drive files** (no storage quota -> 403). The JobBuddy sheet
  was created in the user's Drive (owned by him) and shared with the service account as Editor.
  The SA can read/write but never create. `scripts/bootstrap-sheet.js` targets the EXISTING sheet
  id in `.env` GOOGLE_SHEET_ID and creates/ensures the 4 tabs + headers.
- **Inbox columns are positional.** The variant3 score columns were inserted mid-schema in the
  realign; if live Inbox rows ever predate a column change they will be shifted. Inbox is a
  transient queue, so the fix is to clear stale Inbox rows before re-running bootstrap. The other
  tabs are unaffected.
- Headless `claude` CLI returns JSON in ```json fences; subprocess.js extracts before parsing.
- The HTML `hidden` attribute is overridden by any author `display` rule - a dropdown styled
  `display:flex` needs an explicit `[hidden]{display:none}`. (Bit us on the canonical-resumes menu.)
- Editable fields are made contenteditable client-side by an injected script, so the SERVED HTML
  won't show the `contenteditable` attribute - check for the injected script + the target elements,
  not a baked-in attribute.
- Worker/entry scripts need `import 'dotenv/config'` first (launchd does not load `.env`).
- Restart the dashboard after server/prompt changes:
  `launchctl kickstart -k gui/$(id -u)/com.hiretyler.jobbuddy.dashboard`. Static web/ assets
  serve fresh from disk (just hard-refresh the browser).

## Provenance

Built 2026-06-13 in a fresh project by lifting the proven applysprint modules (scoring, personas +
master-bank, bookmarklet, Gmail status-scan) and leaving the cut-list behind. Realigned 2026-06-17
to the current contract: 3 personas as split files, full-JD 3-persona scoring at capture, no in-app
editing (only `.company`/`.jobtitle`/`.skills-container`), Reject + Did Not Apply tracking tabs,
the Help-with-questions terminal spawn, and the Apps Script Gmail watcher replacing the in-app
OAuth scan. applysprint repo is private + archived; its local folder is the historical reference.
Vault: `~/vault/Projects/` (applysprint note has the full lineage).

## Style
Hyphens never em-dashes. No emojis. Terse, operational. Iterative file-by-file edits. Clarify
architecture before building when scope is non-trivial. Confirm before `git push`.
