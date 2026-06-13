# JobBuddy - build contract (read first)

Fresh, minimal rebuild of applysprint. Pull-based: the user finds jobs and pushes them in
(bookmarklet / Discover tab / mobile paste). No sourcing firehose, no dedup machinery, no
polling. The Google Sheet is the user's home for tracking.

Source of proven code to adapt: `../applysprint`. Copy + adapt, do not re-invent. But DO NOT
drag in anything from applysprint's cut-list (poller, overnight-batch, sources/*, ingest-filter,
possible-repeat, dashboard.js, velocity tile, 3-tab schema, launchd).

## Sheet (2 tabs) - server/sheets.js owns the schema

Use the existing `server/sheets.js` helpers ONLY: `readTab`, `findRow`, `appendRows`,
`updateRow`, `countRows`. Code keys are snake_case (the visible sheet shows pretty headers).

### Inbox (the app's working queue)
`job_id, captured_at, source, company, title, url, canonical_url, jd_body, jd_length,
posted_date, num_applicants, variant1_score, variant1_reason, variant2_score, variant2_reason,
recommended_persona, status, cl_paragraph, mention_bullets, applied_at`

- `status` vocabulary: `new` (captured, unscored) -> `scored` -> `applied` (promoted) / `discarded`.
- `job_id`: generate with `node:crypto.randomUUID()` short form or `id-<timestamp>-<rand>`.
- `recommended_persona`: `variant1` or `variant2` (the higher score; tie -> variant1).

### Applications (the user's pristine tracker - written ONLY on Apply)
`date_applied, company, position, status, interview, cover_letter, post_date, num_applicants,
referral_to, referred, notes, link, score, persona, job_id`

- `status` vocabulary (matches the user's old sheet): `pending` (on apply) then the inbox scan
  sets `not selected` / `interview` / `offer` / `role on hold` / `withdrawn`.
- `cover_letter`: `yes`/`no` (yes if a CL paragraph was generated for the job).
- `interview`: blank, or set to `yes`/stage by the inbox scan on an interview-request email.
- `referral_to`, `referred`, `notes`: user-owned, never overwritten by the app.

## Personas (unchanged from applysprint)
- `variant1` = `assets/personas/variant1_gtm_enablement.html` (AI-Native Enablement & L&D)
- `variant2` = `assets/personas/variant2_customer_education.html` (Customer Education)
- master-bank persona names: `variant1 -> internal-enablement`, `variant2 -> customer-education`.

## Claude (server/claude/subprocess.js - already copied)
All model work via the `claude` CLI subprocess. Use `runClaudeJson`, `loadPromptTemplate`,
`fillTemplate`, and the scoring/classify helpers. Prompts already copied to
`server/claude/prompts/`: snippet-score, fulljd-rescore, ats-swap, cl-intro, mention-bullets,
rejection-classify. Score JSON shape: `{"variant1":{score,reason},"variant2":{score,reason},
"top":{persona,score,reason}}`.

## Route ownership (each file default-exports an Express router; server/index.js already mounts them)

- `routes/pipeline.js` (Agent A): `POST /jd-capture` (+OPTIONS/CORS), `POST /api/ingest`,
  `GET /api/inbox` (list inbox cards for the UI), `POST /api/score/:job_id` (snippet+ store both
  variant scores), `POST /api/apply/:job_id` (full-JD rescore + generate CL para + mention
  bullets), `POST /api/applied/:job_id` (promote: write a clean Applications row, set Inbox
  status=applied, idempotent). Also owns copying/adapting `server/jd-prefetch.js` (fetchJdBody,
  isAuthWalled) and `server/sources/manual.js` -> `server/manual.js` (ingestUrl) from applysprint.
  Bookmarklet capture extracts `posted_date` + `num_applicants` from the JD page when present.
- `routes/resume.js`, `routes/cover-letter.js`, `routes/persona.js`, `routes/ats-swap.js`
  (Agent B): lift from applysprint nearly verbatim; adapt sheet keys (role_id -> job_id, the
  Inbox tab, `cl_paragraph`/`mention_bullets` live on Inbox). The ATS-swap sidebar UI is inlined
  in resume.js. PERSONA_NAME map as above. `/api/resume/:job_id`, `/api/resume/persona/:variant`,
  `/api/cover-letter/:job_id`, `/api/cover-letter/persona/:variant`, `/api/persona/:job_id`,
  `/api/personas/:variant`, `/api/ats-swap/:job_id`.
- `routes/status.js` (Agent C): `GET /oauth/gmail/start` + `/oauth/gmail/callback` (lift from
  applysprint oauth.js), and `POST /api/scan-inbox` - the manual "Scan inbox for updates" button.
  Reads `Applications` rows whose `status` is non-terminal, searches Gmail by company (reuse the
  Gmail client), classifies each thread as confirmation / rejection / interview-request (heuristic
  first, escalate ambiguous to `classifyRejectionWithClaude`-style claude call), and updates the
  Applications row: rejection -> status `not selected`; interview-request -> `interview` +
  `interview=yes`; confirmation -> leave status `pending` (optionally note in `notes`). Idempotent.
  Agent C ALSO creates `server/gmail.js` by copying applysprint `server/sources/gmail.js` and
  DELETING the LinkedIn-digest/poller functions (`scanInbox`, `parseAlertMessage`,
  `parseLinkedInDigest`, `parseGenericDigest`, `splitLinkedInRoleText`, `buildRecord`,
  `parsePostedAge`, the digest regexes) and the now-unused `identity.js` import. KEEP
  `setupGmailAuth`, `exchangeCode`, `searchCompanyMail`, `classifyRejection` + helpers.
- `routes/discover.js` (Agent D): `GET /api/discover?source=remotive|himalayas|remoteok|wwr` -
  on-demand fetch from the curated remote APIs (adapt fetch logic from applysprint
  `server/sources/job-apis.js`, but NO worker, NO auto-ingest, NO writing to sheet). Returns a
  list of `{company, title, url, posted_at, jd_snippet}`. The UI shows them; clicking one calls
  `/api/ingest` to push it into the Inbox. Keyword-filter Remote OK client-side (it's a firehose).

## Frontend API the Wave 2 UI will consume (publish these shapes)
- `GET /api/inbox` -> `{ jobs: [{job_id, company, title, url, source, status, variant1_score,
  variant2_score, recommended_persona, has_cl, has_bullets}] }`
- `POST /api/applied/:job_id` -> `{ ok: true }`
- `GET /api/discover?source=...` -> `{ jobs: [...] }`
- `POST /api/scan-inbox` -> `{ ok: true, updated: [{company, position, from, to}], scanned: N }`

## Env / credentials (already copied)
`.env`, `secrets/service-account.json`, `tokens/gmail.json` are copied from applysprint. Same
Gmail OAuth client + the existing authorized token (no re-auth needed). `GOOGLE_SHEET_ID` is set
to the NEW JobBuddy sheet by the bootstrap. PORT=3000 (applysprint's launchd will be stopped
before JobBuddy runs). Headless claude needs `--dangerously-skip-permissions` (already in
subprocess.js).
