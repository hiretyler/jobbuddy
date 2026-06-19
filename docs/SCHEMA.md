# JobBuddy - schema + build contract

> NOTE: this was the original pre-build contract. The schemas, personas, and env sections below
> are kept current. The "Agent A-D / lift from applysprint" build-plan framing is HISTORICAL (the
> build is done). For the living architecture + everything added since the build (career archive,
> local-only contact/master-bank, company/title extraction, prepped status, canonical-only cover
> letters incl. the AI Adoption one), see `CLAUDE.md`.

Pull-based: the user finds jobs and pushes them in (bookmarklet / Discover tab / mobile paste).
No sourcing firehose, no dedup machinery, no polling. The Google Sheet is the user's home for
tracking. applysprint is the archived predecessor (its cut-list - poller, overnight-batch,
sources/*, dashboard.js, velocity tile, 3-tab schema - stays out, deliberately).

## Sheet (4 tabs) - server/sheets.js owns the schema

Use the existing `server/sheets.js` helpers ONLY: `readTab`, `findRow`, `appendRows`,
`updateRow`, `countRows`. Code keys are snake_case (the visible sheet shows pretty headers).
The generic helpers key off `TAB_COLUMNS[tabName]`, so all four tabs work with no per-tab wiring.

### Inbox (the app's working queue)
`job_id, captured_at, source, company, title, url, canonical_url, jd_body, jd_length,
posted_date, num_applicants, variant1_score, variant1_reason, variant2_score, variant2_reason,
variant3_score, variant3_reason, recommended_persona, status, cl_paragraph, mention_bullets,
applied_at`

- `status` vocabulary: `new` (captured, unscored) -> `scored` (snippet-scored) -> `prepped`
  (full-JD rescored, apply panel shown) -> `applied` (promoted). Delete is a hard row removal
  (`DELETE /api/inbox/:job_id`), not a status.
- `job_id`: generate with `node:crypto.randomUUID()` short form or `id-<timestamp>-<rand>`.
- `variant1/2/3_score`, `variant1/2/3_reason`: the three persona scores + one-line reasons. The
  persona-score block is contiguous (v1, v2, v3, then recommended_persona).
- `recommended_persona`: `variant1`, `variant2`, or `variant3` (the highest score; tie -> lowest
  variant number).
- `cl_paragraph`, `mention_bullets`: legacy columns, kept for positional schema stability but
  no longer written (per-JD content generation was removed - cover letters are canonical).

> POSITIONAL CAVEAT: `variant3_score`/`variant3_reason` were inserted in the MIDDLE of the Inbox
> column order (after `variant2_reason`, before `recommended_persona`). Code reads by
> `TAB_COLUMNS`, so that is fine, but the live sheet's existing Inbox cells are positional too -
> any pre-existing Inbox rows would have `recommended_persona` onward shifted two columns to the
> left relative to the new schema. Inbox is a transient working queue (typically empty/small), so
> the fix is just: clear stale Inbox rows before/after re-running bootstrap. Bootstrap only
> rewrites row 1 headers; it does NOT migrate Inbox data.

### Applications (the user's pristine tracker - written ONLY on Apply)
`date_applied, company, position, status, interview, cover_letter, post_date, num_applicants,
referral_to, referred, notes, link, score, persona, job_id`

- `status` vocabulary (matches the user's old sheet): `pending` (on apply) then the Apps Script
  Gmail scan (`apps-script/`) sets `not selected` / `interview`; `offer` / `role on hold` /
  `withdrawn` are user-set.
- `cover_letter`: always `yes` (a canonical cover letter is always available for every job).
- `interview`: blank, or set to `yes` by the Apps Script scan on an interview-request email.
- `referral_to`, `referred`, `notes`: user-owned, never overwritten by the app.

### Rejected (jobs the user / inbox scan rejected - auditable with scores)
`rejected_at, company, title, url, variant1_score, variant1_reason, variant2_score,
variant2_reason, variant3_score, variant3_reason, recommended_persona, jd_length, job_id`

- Written when a job is rejected (carries the three persona scores so the call stays reviewable).
- Pretty headers: `Rejected At, Company, Title, Link, V1 Score, V1 Reason, V2 Score, V2 Reason,
  V3 Score, V3 Reason, Recommended Persona, JD Length, _job_id`.
- No history import.

### Did Not Apply (prepped/considered but the user bailed)
`marked_at, company, position, selected_persona, variant1_score, variant1_reason, variant2_score,
variant2_reason, variant3_score, variant3_reason, reason_note, link, job_id`

- `selected_persona`: the persona the user had picked before deciding not to apply.
- `reason_note`: free text, blank by default.
- Pretty headers: `Marked At, Company, Position/Job Title, Selected Persona, V1 Score, V1 Reason,
  V2 Score, V2 Reason, V3 Score, V3 Reason, Reason, Link, _job_id`.
- No history import.

## Personas (unchanged from applysprint)
- `variant1` = `assets/personas/variant1_gtm_enablement.html` (AI-Native Enablement & L&D)
- `variant2` = `assets/personas/variant2_customer_education.html` (Customer Education)
- master-bank persona names: `variant1 -> internal-enablement`, `variant2 -> customer-education`.

## Claude (server/claude/subprocess.js - already copied)
All model work via the `claude` CLI subprocess. Use `runClaudeJson`, `loadPromptTemplate`,
`fillTemplate`, and the scoring/classify helpers. Prompts in `server/claude/prompts/`:
snippet-score, fulljd-rescore, ats-swap, rejection-classify. (cl-intro + mention-bullets were
removed with per-JD content generation.) The snippet-score JSON shape is now
`{"company":"","role":"","variant1":{score,reason},"variant2":{score,reason},"top":{persona,score,reason}}`
- it also extracts a clean company + role title used to correct the captured values.

## Route ownership (each file default-exports an Express router; server/index.js already mounts them)

- `routes/pipeline.js`: `POST /jd-capture` (+OPTIONS/CORS), `POST /api/ingest`,
  `GET /api/inbox` (list inbox cards for the UI), `POST /api/score/:job_id` (snippet-score +
  store both variant scores + corrected company/title), `POST /api/apply/:job_id` (full-JD
  rescore, set status=prepped, create the career-archive folder; NO content generation),
  `POST /api/applied/:job_id` (promote: write a clean Applications row, set Inbox status=applied,
  refresh archive notes; idempotent), `DELETE /api/inbox/:job_id` (reject/remove a row),
  `POST /api/open-folder/:job_id` (reveal the archive folder in Finder). Uses
  `server/jd-prefetch.js` (fetchJdBody, isAuthWalled), `server/manual.js` (ingestUrl), and
  `server/archive.js` (career-archive writer). Bookmarklet capture extracts `posted_date` +
  `num_applicants` from the JD page when present, and reads same-origin iframe JD content.
- `routes/resume.js`, `routes/cover-letter.js`, `routes/persona.js`, `routes/ats-swap.js`:
  the resume/CL editor (read-only banner + "Enable editing" -> contenteditable + Cmd+P). The
  ATS-swap sidebar UI is inlined in resume.js. Personas load through `server/personas.js`
  (`loadPersonaHtml`), which injects the local-only contact info into the persona HTML
  placeholders. `/api/resume/:job_id`, `/api/resume/persona/:variant`, `/api/cover-letter/:job_id`,
  `/api/cover-letter/persona/:variant`, `/api/cover-letter/ai-adoption` (canonical generic letter),
  `/api/persona/:job_id`, `/api/personas/:variant`, `/api/ats-swap/:job_id`. Cover letters use
  Tyler's canonical paragraphs - only the recipient header (company+title) varies per job.
- Gmail status scanning (was `routes/status.js` + `server/gmail.js`, both removed) now lives in
  `apps-script/` as a standalone Google Apps Script that runs on a time trigger as the user's
  Google account. It reads `Applications` rows whose `status` is non-terminal, searches Gmail by
  company, classifies each thread (rejection / interview-request) with the SAME heuristics, and
  writes back: rejection -> `not selected`; interview-request -> `interview` + `interview=yes`.
  Behavior change: Apps Script cannot call the local `claude` CLI, so ambiguous rejections (a
  rejection phrase with no matching confirmation email) are left UNCHANGED and only logged - never
  auto-marked. See `apps-script/README.md`. The Node app no longer mounts any Gmail/scan routes.
- `routes/discover.js` (Agent D): `GET /api/discover?source=remotive|himalayas|remoteok|wwr` -
  on-demand fetch from the curated remote APIs (adapt fetch logic from applysprint
  `server/sources/job-apis.js`, but NO worker, NO auto-ingest, NO writing to sheet). Returns a
  list of `{company, title, url, posted_at, jd_snippet}`. The UI shows them; clicking one calls
  `/api/ingest` to push it into the Inbox. Keyword-filter Remote OK client-side (it's a firehose).

## Frontend API the Wave 2 UI will consume (publish these shapes)
- `GET /api/inbox` -> `{ jobs: [{job_id, company, title, url, source, status, variant1_score,
  variant2_score, recommended_persona}] }`
- `POST /api/applied/:job_id` -> `{ ok: true, archived: "<folder path>" | null }`
- `GET /api/discover?source=...` -> `{ jobs: [...] }`
- (Gmail status scanning is no longer a Node endpoint - it runs in `apps-script/`.)

## Env / credentials (already copied)
`.env` + `secrets/service-account.json` are copied from applysprint. `GOOGLE_SHEET_ID` is set
to the NEW JobBuddy sheet by the bootstrap. PORT=3000 (applysprint's launchd will be stopped
before JobBuddy runs). Headless claude needs `--dangerously-skip-permissions` (already in
subprocess.js). The Node app no longer uses Gmail: the old `tokens/gmail.json` and the
`GMAIL_OAUTH_*` / `GMAIL_TOKEN_PATH` `.env` keys are unused - Gmail scanning moved to the
`apps-script/` Apps Script, which runs as the user's Google account (no OAuth token needed).
