/**
 * JobBuddy - Gmail -> Applications status scanner (standalone Apps Script).
 *
 * Runs as the USER's Google account on a time trigger, so GmailApp reads the
 * inbox natively - no OAuth token, no local server. Replaces the old in-app
 * "Scan inbox" button (server/routes/status.js + server/gmail.js, both removed).
 *
 * For each non-terminal row in the "Applications" tab it searches Gmail scoped
 * by company + since date_applied, classifies the mail, and writes status /
 * interview back to the same row. Idempotent and never downgrades a terminal
 * status, so it is safe to run repeatedly on a trigger.
 *
 * BEHAVIOR CHANGE vs the Node app: Apps Script cannot call the local `claude`
 * CLI, so the Claude-escalation fallback for ambiguous rejections is gone.
 * Conservative rule instead: a rejection phrase is only acted on when the
 * paired-confirmation gate also fires. A rejection phrase WITHOUT a confirmation
 * is left UNCHANGED (we never auto-mark it; it is just flagged in the run log).
 */

// ---- Config -----------------------------------------------------------------

// PASTE YOUR SPREADSHEET ID HERE. This is the value of GOOGLE_SHEET_ID from the
// Node app's .env (the JobBuddy tracking sheet). Do NOT commit a real id - keep
// this a placeholder in the repo.
var SHEET_ID = 'PASTE_GOOGLE_SHEET_ID_HERE';

var TAB_NAME = 'Applications';

// Cap on Gmail threads inspected per company (keeps trigger runs fast).
var MAX_THREADS = 20;

// ---- Status sets (ported verbatim from status.js) ---------------------------

// Statuses we re-scan. Blank counts as in-flight (just applied).
var NON_TERMINAL = ['pending', 'interview', 'role on hold', ''];
// Statuses we never touch once set.
var TERMINAL = ['not selected', 'offer', 'withdrawn'];

// ---- Phrase banks (ported verbatim from gmail.js / status.js) ---------------

var REJECTION_PHRASES = [
  'unfortunately',
  'not moving forward',
  'will not be moving forward',
  'decided to move forward with other candidates',
  'move forward with other candidates',
  'position has been filled',
  'role has been filled',
  'will not be proceeding',
  'not be proceeding',
  'not selected',
  'pursue other candidates',
  'other applicants',
  'we have decided not to',
  'no longer under consideration',
  'wish you the best in your',
  'wish you success in your search'
];

var CONFIRMATION_PHRASES = [
  'thank you for applying',
  'thanks for applying',
  'application received',
  'received your application',
  'we received your application',
  'thank you for your application',
  'application has been received',
  'your application to',
  'successfully applied',
  'applying to',
  'apply for'
];

var INTERVIEW_PHRASES = [
  'we would like to talk',
  "we'd like to talk",
  'we would like to schedule',
  "we'd like to schedule",
  'schedule a call',
  'schedule a time',
  'schedule an interview',
  'set up a call',
  'set up a time',
  'set up an interview',
  'invite you to interview',
  'invitation to interview',
  'like to invite you',
  'move forward with your application',
  'move forward in the process',
  'move you forward',
  'next steps',
  'next step in the process',
  'phone screen',
  'phone interview',
  'video interview',
  'speak with you',
  'chat with you',
  'meet with you',
  'available for a call',
  'your availability',
  'book a time'
];

// ---- Helpers ----------------------------------------------------------------

function normKey(s) {
  return (s == null ? '' : String(s)).trim().toLowerCase();
}

function phraseHit(text, phrases) {
  var lower = (text || '').toLowerCase();
  for (var i = 0; i < phrases.length; i++) {
    if (lower.indexOf(phrases[i]) !== -1) return true;
  }
  return false;
}

function inSet(set, value) {
  for (var i = 0; i < set.length; i++) {
    if (set[i] === value) return true;
  }
  return false;
}

// Build the per-message records the classifiers expect: {from, subject, body, date}.
// We flatten the threads of a search into one message list (mirrors the Node app,
// which listed messages directly).
function messagesFromThreads(threads) {
  var out = [];
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      var body = '';
      try { body = msg.getPlainBody() || ''; } catch (e) { body = ''; }
      out.push({
        from: msg.getFrom() || '',
        subject: msg.getSubject() || '',
        body: body.slice(0, 4000),
        date: msg.getDate()
      });
    }
  }
  return out;
}

// ---- Gmail search (ports searchCompanyMail) ---------------------------------

// Quote the company name for an exact-ish phrase match; add after: when a
// date_applied is present. GmailApp.search takes a normal Gmail query string.
function searchCompanyMail(company, dateApplied) {
  var name = (company || '').trim();
  if (!name) return [];

  var q = '"' + name.replace(/"/g, '') + '"';
  var since = parseDate(dateApplied);
  if (since) {
    // Gmail after: wants YYYY/MM/DD.
    q += ' after:' + Utilities.formatDate(since, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  }

  var threads = GmailApp.search(q, 0, MAX_THREADS);
  return messagesFromThreads(threads);
}

function parseDate(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? null : value;
  }
  var t = Date.parse(String(value));
  return isNaN(t) ? null : new Date(t);
}

// ---- Classification (ports classifyRejection + findInterviewMsg) ------------

// Returns {rejected, ambiguous, reason}. rejected=true only when a confirmation
// email exists from the company AND a rejection phrase is present (high
// precision). Phrase-without-confirmation is ambiguous (left unchanged - the
// no-Claude conservative rule).
function classifyRejection(company, messages) {
  var name = normKey(company);
  var fromCompany = messages.filter(function (m) {
    var blob = (m.from + ' ' + m.subject + ' ' + m.body).toLowerCase();
    return name && blob.indexOf(name) !== -1;
  });
  if (!fromCompany.length) {
    return { rejected: false, ambiguous: false, reason: 'no-company-mail' };
  }

  var hasConfirmation = fromCompany.some(function (m) {
    return phraseHit(m.subject + ' ' + m.body, CONFIRMATION_PHRASES);
  });

  var rejectMsg = null;
  for (var i = 0; i < fromCompany.length; i++) {
    var m = fromCompany[i];
    if (phraseHit(m.subject + ' ' + m.body, REJECTION_PHRASES)) {
      if (!rejectMsg || m.date > rejectMsg.date) rejectMsg = m;
    }
  }

  if (rejectMsg && hasConfirmation) {
    return { rejected: true, ambiguous: false, reason: 'phrase+confirmation' };
  }
  if (rejectMsg && !hasConfirmation) {
    return { rejected: false, ambiguous: true, reason: 'phrase-no-confirmation' };
  }
  if (hasConfirmation) {
    return { rejected: false, ambiguous: false, reason: 'confirmation-only' };
  }
  return { rejected: false, ambiguous: false, reason: 'company-mail-no-signal' };
}

// Newest message from the company that hits an interview-request phrase, or null.
function findInterviewMsg(company, messages) {
  var name = normKey(company);
  var fromCompany = messages.filter(function (m) {
    var blob = (m.from + ' ' + m.subject + ' ' + m.body).toLowerCase();
    return name && blob.indexOf(name) !== -1;
  });
  var best = null;
  for (var i = 0; i < fromCompany.length; i++) {
    var m = fromCompany[i];
    if (phraseHit(m.subject + ' ' + m.body, INTERVIEW_PHRASES)) {
      if (!best || m.date > best.date) best = m;
    }
  }
  return best;
}

// ---- Header mapping (robust to column order) --------------------------------

// Map a code key -> 0-based column index using the display header row. Matches by
// the pretty header text the bootstrap writes, falling back to the snake_case key
// itself (so it works whichever header style is present).
var HEADER_ALIASES = {
  date_applied: ['date applied', 'date_applied'],
  company: ['company'],
  position: ['position/job title', 'position', 'position_job_title'],
  status: ['status'],
  interview: ['interview?', 'interview']
};

function buildColumnIndex(headerRow) {
  var idx = {};
  var lowered = headerRow.map(function (h) { return normKey(h); });
  Object.keys(HEADER_ALIASES).forEach(function (key) {
    var aliases = HEADER_ALIASES[key];
    for (var a = 0; a < aliases.length; a++) {
      var pos = lowered.indexOf(aliases[a]);
      if (pos !== -1) { idx[key] = pos; break; }
    }
  });
  return idx;
}

// ---- Main scan (ports the /api/scan-inbox loop) -----------------------------

function scanInbox() {
  // Container-bound (Extensions > Apps Script on the sheet): getActiveSpreadsheet()
  // returns the bound sheet even from a time trigger - no SHEET_ID needed.
  // Standalone project: getActiveSpreadsheet() is null, so fall back to SHEET_ID.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    if (SHEET_ID === 'PASTE_GOOGLE_SHEET_ID_HERE' || !SHEET_ID) {
      throw new Error('Standalone project: set SHEET_ID to your GOOGLE_SHEET_ID, ' +
        'or deploy this as the sheet-bound script (Extensions > Apps Script).');
    }
    ss = SpreadsheetApp.openById(SHEET_ID);
  }

  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) throw new Error('Tab "' + TAB_NAME + '" not found.');

  var range = sheet.getDataRange();
  var values = range.getValues();
  if (values.length < 2) {
    Logger.log('No data rows to scan.');
    return;
  }

  var headerRow = values[0];
  var col = buildColumnIndex(headerRow);
  if (col.company == null || col.status == null) {
    throw new Error('Could not locate Company / Status columns by header.');
  }

  var updated = [];
  var flagged = []; // ambiguous rejections we deliberately did NOT auto-mark
  var scanned = 0;

  for (var r = 1; r < values.length; r++) {
    var rowNum = r + 1; // 1-based sheet row (incl. header)
    var rowVals = values[r];

    var status = normKey(rowVals[col.status]);
    if (inSet(TERMINAL, status)) continue;
    if (!inSet(NON_TERMINAL, status)) continue;

    var company = String(rowVals[col.company] || '').trim();
    var position = col.position != null ? String(rowVals[col.position] || '').trim() : '';
    if (!company) continue;
    scanned++;

    var fromStatus = status || 'pending';
    var dateApplied = col.date_applied != null ? rowVals[col.date_applied] : '';

    var messages;
    try {
      messages = searchCompanyMail(company, dateApplied);
    } catch (e) {
      Logger.log('search failed for ' + company + ': ' + e.message);
      continue;
    }

    // 1) Rejection (highest precedence) - only on the confirmation gate.
    var verdict = classifyRejection(company, messages);
    if (verdict.rejected) {
      sheet.getRange(rowNum, col.status + 1).setValue('not selected');
      updated.push(company + ' | ' + position + ': ' + fromStatus + ' -> not selected');
      continue;
    }

    // 2) Interview request -> promote (never downgrade an interview row).
    var interviewMsg = findInterviewMsg(company, messages);
    if (interviewMsg) {
      if (fromStatus === 'interview') continue; // idempotent
      sheet.getRange(rowNum, col.status + 1).setValue('interview');
      if (col.interview != null) sheet.getRange(rowNum, col.interview + 1).setValue('yes');
      updated.push(company + ' | ' + position + ': ' + fromStatus + ' -> interview');
      continue;
    }

    // 3) Ambiguous rejection (phrase, no confirmation gate). NO-CLAUDE rule:
    //    leave the status UNCHANGED, just flag it in the log for the user.
    if (verdict.ambiguous) {
      flagged.push(company + ' | ' + position + ': possible rejection (no confirmation) - left as ' + fromStatus);
      continue;
    }

    // 4) Confirmation-only / no signal: in-flight, leave as-is.
  }

  Logger.log('Scanned ' + scanned + ' non-terminal row(s).');
  if (updated.length) Logger.log('Updated:\n  ' + updated.join('\n  '));
  if (flagged.length) Logger.log('Flagged for review (not auto-marked):\n  ' + flagged.join('\n  '));
  if (!updated.length && !flagged.length) Logger.log('No changes.');
}
