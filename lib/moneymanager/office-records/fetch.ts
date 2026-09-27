// Network layer for "Compare with Office Records", ported faithfully from
// moneymanager-standalone-src/src/business/reports/compare-office-records.ts
// (fetchCsvRows/fetchWorkbook/withRetry/toExportUrl) - same sign-in-page and
// malformed-response detection, same retry schedule. The only real change:
// `fetch` is injected (defaults to global fetch) so tests can supply
// realistic mocked responses instead of hitting Google Sheets for real -
// this module never makes a network call in a test.
//
// Hard constraint: this is the ONLY network-calling code in
// lib/moneymanager - it calls Google's docs.google.com export endpoints for
// a URL a human configured (lib/moneymanager/office-records/config.ts), and
// nothing else. It never calls moneymanager.kbrisks.com or any MoneyManager
// server, desktop or web.
import * as XLSX from 'xlsx';

export class OfficeRecordsFetchError extends Error {}

function spreadsheetIdFromUrl(url: string): string {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const id = match?.[1];
  if (!id) throw new OfficeRecordsFetchError(`"${url}" doesn't look like a Google Sheets link.`);
  return id;
}

export function toExportUrl(sheetUrl: string, format: 'csv' | 'xlsx'): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetIdFromUrl(sheetUrl)}/export?format=${format}`;
}

const SHARING_HINT =
  'This is usually either the sheet not being shared with "Anyone with the link" (with viewers allowed to download it), or Google briefly rate-limiting repeated downloads. If sharing settings are correct, wait a minute and try again.';
const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Google occasionally serves an HTML sign-in/interstitial page (often with
 * HTTP 200) even when sharing is genuinely open - retries a few times with
 * increasing pauses before giving up, per the reference file's own
 * confirmed-in-production finding that a single retry isn't always enough. */
async function withRetry<T>(attempt: () => Promise<T>, delaysMs: number[] = [2000, 5000, 10000]): Promise<T> {
  for (let i = 0; i < delaysMs.length; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (!(err instanceof OfficeRecordsFetchError) || !/sign-in\/permission page/.test(err.message)) throw err;
      await sleep(delaysMs[i]!);
    }
  }
  return attempt();
}

export async function fetchCsvRows(
  url: string,
  label: string,
  fetchImpl: typeof fetch,
  retryDelaysMs?: number[]
): Promise<string[][]> {
  return withRetry(async () => {
    const response = await fetchImpl(url, { headers: FETCH_HEADERS });
    if (!response.ok) {
      throw new OfficeRecordsFetchError(`Couldn't download the ${label} sheet (HTTP ${response.status}). ${SHARING_HINT}`);
    }
    const text = await response.text();
    // Google serves an HTML sign-in/permission page (often HTTP 200)
    // instead of the real CSV when sharing isn't actually open - catch
    // that instead of silently parsing garbage.
    if (/^\s*<(!doctype|html)/i.test(text)) {
      throw new OfficeRecordsFetchError(
        `The ${label} link didn't return the actual sheet (it looks like a Google sign-in/permission page instead). ${SHARING_HINT}`
      );
    }
    const wb = XLSX.read(text, { type: 'string', raw: true });
    const firstSheetName = wb.SheetNames[0];
    const sheet = firstSheetName ? wb.Sheets[firstSheetName] : undefined;
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as string[][];
  }, retryDelaysMs);
}

export async function fetchWorkbook(
  url: string,
  fetchImpl: typeof fetch,
  retryDelaysMs?: number[]
): Promise<XLSX.WorkBook> {
  return withRetry(async () => {
    const response = await fetchImpl(url, { headers: FETCH_HEADERS });
    if (!response.ok) {
      throw new OfficeRecordsFetchError(`Couldn't download the office records workbook (HTTP ${response.status}). ${SHARING_HINT}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    // A real .xlsx is a zip archive and always starts with the "PK"
    // signature - anything else (typically an HTML sign-in page, served
    // with HTTP 200) means access isn't actually open.
    if (buffer.length < 2 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new OfficeRecordsFetchError(
        `The Master Workbook link didn't return the actual file (it looks like a Google sign-in/permission page instead). ${SHARING_HINT}`
      );
    }
    return XLSX.read(buffer, { type: 'buffer' });
  }, retryDelaysMs);
}
