import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';

const KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './secrets/service-account.json';
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// JobBuddy uses TWO tabs:
//
// - 'Inbox': the app's working queue. A captured job lands here, gets scored, prepped,
//   and (on Apply) promoted to Applications. JD body is stored inline (no separate tab).
//
// - 'Applications': the user's pristine tracker (his old "JobBuddy" spreadsheet format).
//   A clean row is written ONLY on Apply. Code uses snake_case keys; the bootstrap writes
//   the pretty display headers ("Date Applied", "# Applicants", ...) into row 1. sheets.js
//   reads/writes POSITIONALLY against TAB_COLUMNS, so the visible header text is cosmetic.
//
// Display header for each Applications column (used by scripts/bootstrap-sheet.js):
//   date_applied   -> "Date Applied"
//   company        -> "Company"
//   position       -> "Position/Job Title"
//   status         -> "Status"
//   interview      -> "Interview?"
//   cover_letter   -> "Cover Letter?"
//   post_date      -> "Post Date"
//   num_applicants -> "# Applicants"
//   referral_to    -> "Referral Requests To"
//   referred       -> "Referred?"
//   notes          -> "Notes"
//   link           -> "Link"          (helper, hideable)
//   score          -> "Score"         (helper, hideable)
//   persona        -> "Persona"       (helper, hideable)
//   job_id         -> "_job_id"       (helper, links back to Inbox)
const TAB_COLUMNS = {
  'Inbox': [
    'job_id', 'captured_at', 'source', 'company', 'title', 'url', 'canonical_url',
    'jd_body', 'jd_length', 'posted_date', 'num_applicants',
    'variant1_score', 'variant1_reason', 'variant2_score', 'variant2_reason',
    'recommended_persona', 'status', 'cl_paragraph', 'mention_bullets', 'applied_at',
  ],
  'Applications': [
    'date_applied', 'company', 'position', 'status', 'interview', 'cover_letter',
    'post_date', 'num_applicants', 'referral_to', 'referred', 'notes',
    'link', 'score', 'persona', 'job_id',
  ],
};

// Pretty headers written to row 1 by the bootstrap. Order matches TAB_COLUMNS.
export const DISPLAY_HEADERS = {
  'Inbox': TAB_COLUMNS['Inbox'].slice(),
  'Applications': [
    'Date Applied', 'Company', 'Position/Job Title', 'Status', 'Interview?', 'Cover Letter?',
    'Post Date', '# Applicants', 'Referral Requests To', 'Referred?', 'Notes',
    'Link', 'Score', 'Persona', '_job_id',
  ],
};

let _authClient = null;
let _sheetsClient = null;

function debug(...args) {
  if (process.env.LOG_LEVEL === 'debug') {
    process.stderr.write('[sheets] ' + args.join(' ') + '\n');
  }
}

function requireSheetId() {
  if (!SHEET_ID) throw new Error('GOOGLE_SHEET_ID env var is required');
  return SHEET_ID;
}

async function getAuth() {
  if (_authClient) return _authClient;
  const auth = new GoogleAuth({ keyFile: KEY_PATH, scopes: SCOPES });
  _authClient = await auth.getClient();
  return _authClient;
}

export async function getSheets() {
  if (_sheetsClient) return _sheetsClient;
  const auth = await getAuth();
  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

export function _columnsFor(tabName) {
  const cols = TAB_COLUMNS[tabName];
  if (!cols) throw new Error(`Unknown tab: ${tabName}`);
  return cols.slice();
}

// Resolve a tab's numeric sheetId (gid), needed for structural ops like deleteDimension.
async function getSheetGid(sheets, tabName) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: requireSheetId(),
    fields: 'sheets(properties(sheetId,title))',
  });
  const sheet = (meta.data.sheets || []).find((s) => s.properties.title === tabName);
  if (!sheet) throw new Error(`Tab not found: ${tabName}`);
  return sheet.properties.sheetId;
}

function columnLetter(index) {
  let n = index;
  let letters = '';
  while (true) {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return letters;
}

function quoteTab(tabName) {
  if (/[^A-Za-z0-9_]/.test(tabName)) return `'${tabName.replace(/'/g, "''")}'`;
  return tabName;
}

function normalizeCell(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function rowsToObjects(values, columns) {
  if (!values || values.length === 0) return [];
  return values.map((row) => {
    const obj = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]] = row[i] === undefined ? '' : String(row[i]);
    }
    return obj;
  });
}

function matchesFilter(row, filter) {
  if (!filter) return true;
  const { column, value, in: inList } = filter;
  const cell = row[column];
  if (Array.isArray(inList)) return inList.includes(cell);
  return cell === value;
}

async function readAllRows(tabName) {
  const sheets = await getSheets();
  const columns = _columnsFor(tabName);
  const lastCol = columnLetter(columns.length - 1);
  const range = `${quoteTab(tabName)}!A2:${lastCol}`;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: requireSheetId(),
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    return rowsToObjects(res.data.values || [], columns);
  } catch (err) {
    throw new Error(`Failed to read ${tabName}: ${err.message}`);
  }
}

export async function readTab(tabName, opts = {}) {
  const { limit, offset = 0, filter } = opts;
  let rows = await readAllRows(tabName);
  if (filter) rows = rows.filter((r) => matchesFilter(r, filter));
  if (offset) rows = rows.slice(offset);
  if (limit !== undefined) rows = rows.slice(0, limit);
  debug('readTab', tabName, 'returned', rows.length, 'rows');
  return rows;
}

export async function findRow(tabName, key, keyValue) {
  const rows = await readAllRows(tabName);
  const matches = rows.filter((r) => r[key] === keyValue);
  if (matches.length === 0) return null;
  return matches[0];
}

export async function countRows(tabName, filter) {
  const rows = await readAllRows(tabName);
  if (!filter) return rows.length;
  return rows.filter((r) => matchesFilter(r, filter)).length;
}

export async function appendRows(tabName, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { appended: 0 };
  const sheets = await getSheets();
  const columns = _columnsFor(tabName);
  const lastCol = columnLetter(columns.length - 1);
  const values = rows.map((row) => columns.map((c) => normalizeCell(row[c])));
  try {
    const res = await sheets.spreadsheets.values.append({
      spreadsheetId: requireSheetId(),
      range: `${quoteTab(tabName)}!A1:${lastCol}`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
    debug('appendRows', tabName, 'appended', values.length);
    return { appended: values.length, updates: res.data.updates };
  } catch (err) {
    throw new Error(`Failed to append ${tabName}: ${err.message}`);
  }
}

// Physically remove the single row where key=keyValue (shifts rows up). Used to reject /
// delete an Inbox job. Errors if zero or multiple rows match, to avoid clobbering the wrong one.
export async function deleteRow(tabName, key, keyValue) {
  const sheets = await getSheets();
  const columns = _columnsFor(tabName);
  const keyIdx = columns.indexOf(key);
  if (keyIdx === -1) throw new Error(`Unknown column ${key} on tab ${tabName}`);

  const lastCol = columnLetter(columns.length - 1);
  let allValues;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: requireSheetId(),
      range: `${quoteTab(tabName)}!A2:${lastCol}`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    allValues = res.data.values || [];
  } catch (err) {
    throw new Error(`Failed to delete ${tabName}: ${err.message}`);
  }

  const matches = [];
  for (let i = 0; i < allValues.length; i++) {
    const cell = allValues[i][keyIdx];
    if (cell !== undefined && String(cell) === String(keyValue)) matches.push(i);
  }
  if (matches.length === 0) throw new Error(`Failed to delete ${tabName}: no row matched ${key}=${keyValue}`);
  if (matches.length > 1) throw new Error(`Failed to delete ${tabName}: multiple rows matched ${key}=${keyValue}`);

  // allValues[0] is sheet row 2 (dimension index 1); header is dimension index 0.
  const startIndex = matches[0] + 1;
  const gid = await getSheetGid(sheets, tabName);
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: requireSheetId(),
      requestBody: {
        requests: [{
          deleteDimension: {
            range: { sheetId: gid, dimension: 'ROWS', startIndex, endIndex: startIndex + 1 },
          },
        }],
      },
    });
    debug('deleteRow', tabName, key, keyValue, 'sheetRow', startIndex + 1);
    return { deleted: 1 };
  } catch (err) {
    throw new Error(`Failed to delete ${tabName}: ${err.message}`);
  }
}

export async function updateRow(tabName, key, keyValue, updates) {
  const sheets = await getSheets();
  const columns = _columnsFor(tabName);
  const keyIdx = columns.indexOf(key);
  if (keyIdx === -1) throw new Error(`Unknown column ${key} on tab ${tabName}`);

  const lastCol = columnLetter(columns.length - 1);
  let allValues;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: requireSheetId(),
      range: `${quoteTab(tabName)}!A2:${lastCol}`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    allValues = res.data.values || [];
  } catch (err) {
    throw new Error(`Failed to update ${tabName}: ${err.message}`);
  }

  const matches = [];
  for (let i = 0; i < allValues.length; i++) {
    const cell = allValues[i][keyIdx];
    if (cell !== undefined && String(cell) === String(keyValue)) matches.push(i);
  }
  if (matches.length === 0) throw new Error(`Failed to update ${tabName}: no row matched ${key}=${keyValue}`);
  if (matches.length > 1) throw new Error(`Failed to update ${tabName}: multiple rows matched ${key}=${keyValue}`);

  const rowIndex = matches[0] + 2;
  const data = [];
  for (const [col, val] of Object.entries(updates)) {
    const cIdx = columns.indexOf(col);
    if (cIdx === -1) throw new Error(`Unknown column ${col} on tab ${tabName}`);
    const letter = columnLetter(cIdx);
    data.push({ range: `${quoteTab(tabName)}!${letter}${rowIndex}`, values: [[normalizeCell(val)]] });
  }
  if (data.length === 0) return { updated: 0 };

  try {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: requireSheetId(),
      requestBody: { valueInputOption: 'RAW', data },
    });
    debug('updateRow', tabName, key, keyValue, 'cols', Object.keys(updates).join(','));
    return { updated: data.length, rowIndex };
  } catch (err) {
    throw new Error(`Failed to update ${tabName}: ${err.message}`);
  }
}
