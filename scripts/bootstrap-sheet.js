import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { DISPLAY_HEADERS, _columnsFor } from '../server/sheets.js';

// Populates the EXISTING JobBuddy spreadsheet (GOOGLE_SHEET_ID in .env, created in the user's
// Drive and shared with the service account as Editor). Ensures the Inbox + Applications +
// Rejected + Did Not Apply tabs exist, writes the pretty display headers, imports the user's
// historical applications, and bolds/freezes the header rows. Idempotent-ish (rewrites headers +
// re-imports history). Run:
//   node scripts/bootstrap-sheet.js
//
// PREREQ: the sheet must be shared with the service account email as Editor, or this 403s.

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './secrets/service-account.json';
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function quoteTab(tabName) {
  if (/[^A-Za-z0-9_]/.test(tabName)) return `'${tabName.replace(/'/g, "''")}'`;
  return tabName;
}

function parseHistory(md) {
  const lines = md.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  const rows = lines.map((line) =>
    line.replace(/^\|/, '').replace(/\|$/, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\([|#_!*])/g, '$1')),
  );
  return rows.slice(2).filter((r) => !/^:-:?$/.test(r[0])); // drop header + separator
}

async function main() {
  if (!SHEET_ID) throw new Error('GOOGLE_SHEET_ID not set in .env');
  const auth = new GoogleAuth({ keyFile: KEY_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existing = meta.data.sheets.map((s) => ({ id: s.properties.sheetId, title: s.properties.title }));
  const byTitle = Object.fromEntries(existing.map((s) => [s.title, s.id]));

  const TABS = ['Inbox', 'Applications', 'Rejected', 'Did Not Apply'];

  // Ensure all tabs. Rename the lone placeholder tab to Applications if needed.
  const requests = [];
  if (!byTitle['Applications']) {
    if (existing.length === 1 && !byTitle['Inbox']) {
      requests.push({ updateSheetProperties: { properties: { sheetId: existing[0].id, title: 'Applications' }, fields: 'title' } });
      byTitle['Applications'] = existing[0].id;
    } else {
      requests.push({ addSheet: { properties: { title: 'Applications' } } });
    }
  }
  for (const t of TABS) {
    if (t === 'Applications') continue;
    if (!byTitle[t]) requests.push({ addSheet: { properties: { title: t } } });
  }
  if (requests.length) {
    const res = await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests } });
    for (const r of res.data.replies || []) {
      if (r.addSheet) byTitle[r.addSheet.properties.title] = r.addSheet.properties.sheetId;
    }
  }

  // Headers (pretty display row 1, for every tab)
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: TABS.map((t) => ({ range: `${quoteTab(t)}!A1`, values: [DISPLAY_HEADERS[t]] })),
    },
  });

  // History import into Applications (clear A2:end first so re-runs don't duplicate)
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: 'Applications!A2:O' });
  const md = await readFile(join(__dirname, 'history.md'), 'utf8');
  const hist = parseHistory(md);
  const appCols = _columnsFor('Applications');
  const values = hist.map((cells) => {
    const row = new Array(appCols.length).fill('');
    for (let i = 0; i < 11 && i < cells.length; i++) row[i] = cells[i];
    return row;
  });
  if (values.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Applications!A2',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  }

  // Bold + freeze header rows
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: TABS.flatMap((t) => [
        { repeatCell: { range: { sheetId: byTitle[t], startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
        { updateSheetProperties: { properties: { sheetId: byTitle[t], gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      ]),
    },
  });

  console.log('Bootstrapped JobBuddy sheet', SHEET_ID);
  console.log('Imported', values.length, 'history rows into Applications.');
  console.log('URL: https://docs.google.com/spreadsheets/d/' + SHEET_ID);
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
