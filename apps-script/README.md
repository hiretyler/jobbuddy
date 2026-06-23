# JobBuddy Gmail status scanner (Apps Script)

This Google Apps Script replaces the old in-app "Scan inbox" button
(`server/routes/status.js` + `server/gmail.js`, both removed). It runs as YOUR
Google account on a time trigger, so `GmailApp` reads your inbox natively - no
OAuth client, no token file, no local server involvement.

Deploy it as the **sheet-bound** script (recommended) - it then targets the
sheet directly and needs no id. `Code.gs` also works as a standalone project via
`SHEET_ID` if you prefer (it tries `getActiveSpreadsheet()` first, then falls
back to `SHEET_ID`).

It walks the **Applications** tab, searches Gmail per company (scoped by company
name + `Date Applied`), classifies recent mail, and writes `Status` / `Interview?`
back to the same row.

## What it does (ported from the Node app)

- Only scans **non-terminal** rows: `pending`, `interview`, `role on hold`, or
  blank. Terminal rows (`not selected`, `offer`, `withdrawn`) are skipped and
  never downgraded.
- Classification precedence: **rejection > interview-request > nothing**.
  - Rejection -> `Status = not selected`. Two tiers: an unambiguous **strong**
    rejection clause ("decided to move forward with other candidates") auto-marks
    on its own; a **weak** phrase ("unfortunately") only acts when the paired-
    confirmation gate also fires (an application-received email from the same
    company). All company attribution is strict (the company must be named in the
    email's From or Subject, generic calendar/meeting senders excluded), so an
    incidental body mention cannot misattribute a rejection.
  - Interview-request phrase -> `Status = interview`, `Interview? = yes`
    (never regresses a row already at `interview`). The company match is strict:
    the company must appear in the email's **From or Subject**, not merely its
    body, and generic calendar/meeting senders (Google Calendar, Zoom, Calendly)
    are ignored as a From match - so an interview invite for company A that is
    delivered over Zoom or mentions another brand in its body does not register
    as an interview for company B. A message that reads as a rejection is never
    counted as an interview.
- Idempotent and safe to run repeatedly on a trigger.
- Columns are matched by the **header row** (the pretty headers the bootstrap
  writes, e.g. "Date Applied", "Status", "Interview?"), so it is robust to
  column reordering.

## Behavior change: no Claude fallback

The Node app escalated ambiguous rejections (a rejection phrase with NO matching
confirmation email) to the local `claude` CLI. Apps Script cannot call that CLI.

Replacement: only a **weak** rejection phrase with no confirmation is ambiguous,
and it is **left unchanged** - NOT auto-marked `not selected`, only logged
("Flagged for review") so you can eyeball it. Strong rejection clauses are
unambiguous and auto-mark without the gate, so the ambiguous bucket is now small.
This trades a little recall for near-zero false rejections.

## Deploy steps (sheet-bound, recommended)

1. Open the JobBuddy tracking sheet, then **Extensions > Apps Script**. This
   opens the script project bound to that sheet (created on first open). This is
   "the jobbuddy apps script project" - reuse it rather than making a new one.
2. Replace the default `Code.gs` contents with this folder's `Code.gs`. Leave
   `SHEET_ID` as the placeholder - a bound script does not need it.
3. Open **Project Settings** (gear icon) and check "Show appsscript.json manifest
   file in editor", then replace the editor's `appsscript.json` with this
   folder's `appsscript.json`.
4. Select the `scanInbox` function in the toolbar and click **Run** once.
   Google will prompt you to authorize Gmail (read-only) and Sheets access -
   approve them. The script runs as your account, so it sees your inbox.
5. Add a time-driven trigger:
   - Click the clock icon (**Triggers**) in the left sidebar.
   - **Add Trigger**: function `scanInbox`, event source "Time-driven",
     "Hour timer", "Every 6 hours" (or whatever cadence you like).
6. Done. The scanner now keeps the Applications tab's statuses fresh on its own.
   Check **Executions** (left sidebar) and `Logger.log` output to see what each
   run updated or flagged.

### Standalone alternative

If you ever want it as its own project instead: create a **New project** at
https://script.google.com, paste `Code.gs` + `appsscript.json`, and set
`SHEET_ID` to your `GOOGLE_SHEET_ID`. Do NOT commit a real id back to this public
repo - keep the placeholder in the tracked copy.

## Notes

- The old Gmail OAuth keys in the Node `.env` (`GMAIL_OAUTH_*`,
  `GMAIL_TOKEN_PATH`) and `tokens/gmail.json` are no longer used by the Node app.
- This is still **pull, not push**: it only reacts to mail for jobs you already
  applied to. It does not source jobs.
