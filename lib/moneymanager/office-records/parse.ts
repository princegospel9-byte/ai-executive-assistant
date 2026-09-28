// Pure parsing logic ported faithfully from moneymanager-standalone-src/
// src/business/reports/compare-office-records.ts - same column-finding,
// date-range slicing, forward-fill, and currency conversion, unchanged in
// meaning. Kept dependency-free (no fetch, no DatabaseSync) so it can be
// unit-tested against synthetic row arrays exactly like the reference
// file's own tests do, without a real network call or xlsx round-trip.
import { nextIsoDate } from '../shared/dates';

const ZONE_NAMES = ['ZONE A', 'ZONE B', 'ZONE C', 'ZONE D', 'ZONE E'] as const;
export type ZoneName = (typeof ZONE_NAMES)[number];
export { ZONE_NAMES };

/** Safe row/cell access - an out-of-range or ragged row just reads as blank
 * (ported from the reference file's rowAt/cellAt). */
function rowAt(rows: string[][], i: number): string[] {
  return rows[i] ?? [];
}
function cellAt(row: string[], i: number): string {
  return row[i] ?? '';
}

export function parseCurrency(value: unknown): number {
  const n = parseFloat(String(value ?? '').replace(/,/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

export function toMinor(value: unknown): number {
  return Math.round(parseCurrency(value) * 100);
}

/** Scans the given header rows top-to-bottom for each cell's trimmed,
 * uppercased text, mapping label -> column index. Keeps the FIRST
 * occurrence of a label, not the last - the CASH OUT header repeats "AMNT"
 * for every denomination breakdown column after the real withdrawal AMNT
 * column; see the reference file's own comment on this exact bug it once
 * hit in production. */
export function buildHeaderIndex(rows: string[][], headerRowCount: number): Map<string, number> {
  const index = new Map<string, number>();
  for (let r = 0; r < Math.min(headerRowCount, rows.length); r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const label = String(row[c] ?? '').trim().toUpperCase();
      if (label && !index.has(label)) index.set(label, c);
    }
  }
  return index;
}

export class OfficeRecordsColumnError extends Error {}

export function requireCol(index: Map<string, number>, label: string, sheetName: string): number {
  const col = index.get(label);
  if (col === undefined) {
    throw new OfficeRecordsColumnError(`The "${sheetName}" sheet is missing an expected "${label}" column.`);
  }
  return col;
}

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** dd/mm/yyyy -> yyyy-mm-dd, or null if it doesn't match.
 *
 * Validates day 1-31 and month 1-12 before accepting - added after real-
 * data testing against the actual zone sheets found at least one row
 * entered as MM/DD/YYYY instead of DD/MM/YYYY (a manual data-entry
 * inconsistency in the office's own sheet, e.g. "04/25/2026" meaning
 * April 25 in US format). The reference file's original regex has no such
 * check, so a mis-formatted date like that silently produced an invalid
 * calendar string ("2026-25-04", month 25) that would still round-trip
 * through string comparisons without ever throwing - a real correctness
 * gap, not just a data-quality issue, since MoneyManager's own comparison
 * logic offers no signal that anything went wrong. Rejecting it (returning
 * null, same as any other unparseable text) is strictly safer: it excludes
 * the bad row from that date's total rather than silently attributing it
 * to a calendar date that doesn't exist. It does not change behavior for
 * any well-formed DD/MM/YYYY date. */
export function ddmmyyyyToIso(text: string): string | null {
  const m = String(text).trim().match(DATE_RE);
  const ddStr = m?.[1];
  const mmStr = m?.[2];
  const yyyy = m?.[3];
  if (!ddStr || !mmStr || !yyyy) return null;
  const dd = Number(ddStr);
  const mm = Number(mmStr);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yyyy}-${mmStr.padStart(2, '0')}-${ddStr.padStart(2, '0')}`;
}

/** A zone's own "total" column sits right after the COINS column - that's
 * how MoneyManager itself locates it (verified against real sheets per the
 * reference file's comment). */
export function parseZoneCsv(rows: string[][], dateFrom: string, dateTo: string): Map<string, number> {
  const header = rowAt(rows, 0).map((h) => String(h).trim().toUpperCase());
  const coinsIdx = header.findIndex((h) => h === 'COINS');
  if (coinsIdx === -1) return new Map();
  const totalIdx = coinsIdx + 1;
  const out = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const row = rowAt(rows, i);
    const iso = ddmmyyyyToIso(cellAt(row, 0));
    if (!iso || iso < dateFrom || iso >= nextIsoDate(dateTo)) continue;
    out.set(iso, toMinor(cellAt(row, totalIdx)));
  }
  return out;
}

export type OfficeDailySummaryDay = {
  opening: number;
  deposit: number;
  withdraw: number;
  expense: number;
  cashReceived: number;
  closingCashCount: number;
  bookFinal: number;
};

/** Column layout: START UP = opening, TOTAL MOBILIZIED = deposits (already
 * includes card-sale cash), WITHDRAWALS, EXPENDITURE, FROM OTHER SOURCE,
 * FINAL vs TOTAL AMOUNT (the physically-counted cash - the one that
 * actually carries forward as next day's opening; both kept so a
 * disagreement between them can be surfaced rather than silently picking
 * one) - all per the reference file's own comment, confirmed against a
 * real sheet. */
export function parseDailySummarySheet(
  rows: string[][],
  dateFrom: string,
  dateTo: string
): Map<string, OfficeDailySummaryDay> {
  const index = buildHeaderIndex(rows, 2);
  const openingCol = requireCol(index, 'START UP', 'DAILY SUMMARY');
  const withdrawCol = requireCol(index, 'WITHDRAWALS', 'DAILY SUMMARY');
  const depositCol = requireCol(index, 'TOTAL MOBILIZIED', 'DAILY SUMMARY');
  const finalCol = requireCol(index, 'FINAL', 'DAILY SUMMARY');
  const totalAmountCol = requireCol(index, 'TOTAL AMOUNT', 'DAILY SUMMARY');
  const otherSourceCol = requireCol(index, 'FROM OTHER SOURCE', 'DAILY SUMMARY');
  const expenseCol = requireCol(index, 'EXPENDITURE', 'DAILY SUMMARY');

  const out = new Map<string, OfficeDailySummaryDay>();
  for (let i = 2; i < rows.length; i++) {
    const row = rowAt(rows, i);
    const iso = ddmmyyyyToIso(cellAt(row, 0));
    if (!iso || iso < dateFrom || iso >= nextIsoDate(dateTo)) continue;
    out.set(iso, {
      opening: parseCurrency(cellAt(row, openingCol)),
      deposit: parseCurrency(cellAt(row, depositCol)),
      withdraw: parseCurrency(cellAt(row, withdrawCol)),
      expense: parseCurrency(cellAt(row, expenseCol)),
      cashReceived: parseCurrency(cellAt(row, otherSourceCol)),
      closingCashCount: parseCurrency(cellAt(row, totalAmountCol)),
      bookFinal: parseCurrency(cellAt(row, finalCol)),
    });
  }
  return out;
}

export type OfficeWithdrawalRow = {
  name: string;
  amountMinor: number;
  commissionMinor: number;
};

/** The office only writes the date on each day's first CASH OUT row - later
 * same-day rows leave it blank, so the date must be forward-filled. Each
 * day's block ends at a row with a blank name (the day's own subtotal
 * row), excluded from individual matching. */
export function parseCashOutSheet(
  rows: string[][],
  dateFrom: string,
  dateTo: string
): Map<string, OfficeWithdrawalRow[]> {
  const index = buildHeaderIndex(rows, 1);
  const nameCol = requireCol(index, 'NAME', 'CASH OUT');
  const amntCol = requireCol(index, 'AMNT', 'CASH OUT');
  const commissionCol = requireCol(index, 'COMMISSON', 'CASH OUT');

  const out = new Map<string, OfficeWithdrawalRow[]>();
  let currentIso: string | null = null;
  for (let i = 1; i < rows.length; i++) {
    const row = rowAt(rows, i);
    const dateCell = cellAt(row, 0).trim();
    if (dateCell) {
      const iso = ddmmyyyyToIso(dateCell);
      currentIso = iso && iso >= dateFrom && iso < nextIsoDate(dateTo) ? iso : null;
    }
    if (!currentIso) continue;
    const name = cellAt(row, nameCol).trim();
    if (!name) {
      currentIso = null; // the day's own subtotal row - ends this block
      continue;
    }
    if (!out.has(currentIso)) out.set(currentIso, []);
    out.get(currentIso)!.push({
      name,
      amountMinor: toMinor(cellAt(row, amntCol)),
      commissionMinor: toMinor(cellAt(row, commissionCol)),
    });
  }
  return out;
}

export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z ]/g, '')
    .trim()
    .split(/\s+/)
    .sort()
    .join(' ');
}

export function everyIsoDateInRange(dateFrom: string, dateTo: string): string[] {
  const dates: string[] = [];
  let cursor = dateFrom;
  while (cursor < nextIsoDate(dateTo)) {
    dates.push(cursor);
    cursor = nextIsoDate(cursor);
  }
  return dates;
}

export type AppWithdrawalForMatching = {
  customerName: string;
  amountMinor: number;
  commissionMinor: number;
  hasStructuredRecord: boolean;
};

export type WithdrawalMatchResult = {
  date: string;
  officeName: string | null;
  officeAmountMinor: number | null;
  officeCommissionMinor: number | null;
  appName: string | null;
  appAmountMinor: number | null;
  appCommissionMinor: number | null;
  status: string;
};

/** The multi-strategy matcher, ported verbatim from compare-office-records.ts:
 * try exact amount+name, then a "pre-structured record" gross-amount+name
 * fallback (commission wasn't tracked separately before that feature
 * existed), then amount-only, then gross-amount-only, then name-only. */
export function matchWithdrawalsForDate(
  officeRows: OfficeWithdrawalRow[],
  appRowsIn: AppWithdrawalForMatching[]
): WithdrawalMatchResult[] {
  const appRows = appRowsIn.map((r) => ({ ...r, used: false }));
  const results: WithdrawalMatchResult[] = [];

  for (const off of officeRows) {
    const offGrossMinor = off.amountMinor + off.commissionMinor;
    let match = appRows.find((a) => !a.used && a.amountMinor === off.amountMinor && normalizeName(a.customerName) === normalizeName(off.name));
    if (!match) match = appRows.find((a) => !a.used && !a.hasStructuredRecord && a.amountMinor === offGrossMinor && normalizeName(a.customerName) === normalizeName(off.name));
    if (!match) match = appRows.find((a) => !a.used && a.amountMinor === off.amountMinor);
    if (!match) match = appRows.find((a) => !a.used && !a.hasStructuredRecord && a.amountMinor === offGrossMinor);
    if (!match) match = appRows.find((a) => !a.used && normalizeName(a.customerName) === normalizeName(off.name));
    if (match) match.used = true;

    let status: string;
    if (!match) {
      status = 'IN OFFICE SHEET ONLY - no matching app withdrawal found';
    } else if (!match.hasStructuredRecord) {
      status =
        match.amountMinor === offGrossMinor
          ? 'Matches (pre-structured record: app deducted principal+commission as one gross amount)'
          : match.amountMinor === off.amountMinor
            ? 'Matches (pre-structured record: commission not separately tracked in the app for this date)'
            : `AMOUNT MISMATCH - office ${(off.amountMinor / 100).toFixed(2)} (or +commission ${(offGrossMinor / 100).toFixed(2)}) vs app ${(match.amountMinor / 100).toFixed(2)}`;
    } else {
      status =
        match.amountMinor !== off.amountMinor
          ? `AMOUNT MISMATCH - office ${(off.amountMinor / 100).toFixed(2)} vs app ${(match.amountMinor / 100).toFixed(2)}`
          : match.commissionMinor !== off.commissionMinor
            ? `COMMISSION MISMATCH - office ${(off.commissionMinor / 100).toFixed(2)} vs app ${(match.commissionMinor / 100).toFixed(2)}`
            : 'Matches';
    }

    results.push({
      date: '', // filled in by the caller, which knows the date this batch is for
      officeName: off.name,
      officeAmountMinor: off.amountMinor,
      officeCommissionMinor: off.commissionMinor,
      appName: match ? match.customerName : null,
      appAmountMinor: match ? match.amountMinor : null,
      appCommissionMinor: match ? match.commissionMinor : null,
      status,
    });
  }

  for (const app of appRows) {
    if (app.used) continue;
    results.push({
      date: '',
      officeName: null,
      officeAmountMinor: null,
      officeCommissionMinor: null,
      appName: app.customerName,
      appAmountMinor: app.amountMinor,
      appCommissionMinor: app.commissionMinor,
      status: 'IN APP ONLY - no matching office cash-out row found',
    });
  }

  return results;
}
