// Unit tests for the pure parsing logic ported from moneymanager-standalone-
// src/src/business/reports/compare-office-records.ts - exercised directly
// on synthetic row arrays (matching the reference file's real column
// layout), never against a real network call or xlsx file, per the
// reference file's own testing convention (see its ddmmyyyyToIso comment).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ddmmyyyyToIso,
  parseZoneCsv,
  parseDailySummarySheet,
  parseCashOutSheet,
  matchWithdrawalsForDate,
  normalizeName,
  toMinor,
  requireCol,
  buildHeaderIndex,
  OfficeRecordsColumnError,
} from '../office-records/parse';

describe('ddmmyyyyToIso', () => {
  it('converts dd/mm/yyyy to yyyy-mm-dd', () => {
    assert.strictEqual(ddmmyyyyToIso('05/09/2026'), '2026-09-05');
    assert.strictEqual(ddmmyyyyToIso('5/9/2026'), '2026-09-05');
  });

  it('returns null for anything else', () => {
    assert.strictEqual(ddmmyyyyToIso('not a date'), null);
    assert.strictEqual(ddmmyyyyToIso(''), null);
    assert.strictEqual(ddmmyyyyToIso('2026-09-05'), null);
  });

  it('rejects a month or day outside 1-31/1-12 rather than silently producing an invalid calendar date', () => {
    // Found via real-data testing: Zone E's actual sheet has at least one
    // row entered as MM/DD/YYYY ("04/25/2026", April 25 in US format)
    // instead of the expected DD/MM/YYYY - before this fix, that silently
    // produced "2026-25-04" (month 25, not a real date) instead of being
    // rejected like any other unparseable text.
    assert.strictEqual(ddmmyyyyToIso('04/25/2026'), null); // "month" 25
    assert.strictEqual(ddmmyyyyToIso('32/01/2026'), null); // "day" 32
    assert.strictEqual(ddmmyyyyToIso('00/01/2026'), null); // day 0
    assert.strictEqual(ddmmyyyyToIso('01/00/2026'), null); // month 0
    // Boundary values that ARE valid must still pass.
    assert.strictEqual(ddmmyyyyToIso('31/12/2026'), '2026-12-31');
    assert.strictEqual(ddmmyyyyToIso('01/01/2026'), '2026-01-01');
  });
});

describe('toMinor / currency parsing', () => {
  it('converts a currency string with thousands separators to minor units', () => {
    assert.strictEqual(toMinor('1,234.50'), 123450);
    assert.strictEqual(toMinor('0'), 0);
    assert.strictEqual(toMinor(''), 0);
    assert.strictEqual(toMinor('garbage'), 0);
  });
});

describe('parseZoneCsv', () => {
  it('locates the total column right after COINS and sums within the date range', () => {
    const rows = [
      ['DATE', 'NOTES', 'COINS', 'TOTAL'],
      ['01/09/2026', '100', '5', '105.00'],
      ['02/09/2026', '200', '10', '210.00'],
      ['03/09/2026', '50', '0', '50.00'], // outside range below
    ];
    const result = parseZoneCsv(rows, '2026-09-01', '2026-09-02');
    assert.strictEqual(result.get('2026-09-01'), 10500);
    assert.strictEqual(result.get('2026-09-02'), 21000);
    assert.strictEqual(result.has('2026-09-03'), false);
  });

  it('returns an empty map when there is no COINS column', () => {
    const rows = [['DATE', 'TOTAL'], ['01/09/2026', '100']];
    assert.strictEqual(parseZoneCsv(rows, '2026-09-01', '2026-09-01').size, 0);
  });
});

describe('parseDailySummarySheet', () => {
  it('reads the DAILY SUMMARY columns by header label, not position', () => {
    const rows = [
      ['MASTER WORKBOOK'],
      ['DATE', 'START UP', 'TOTAL MOBILIZIED', 'WITHDRAWALS', 'EXPENDITURE', 'FROM OTHER SOURCE', 'FINAL', 'TOTAL AMOUNT'],
      ['01/09/2026', '1000', '500', '200', '50', '0', '1250', '1250'],
    ];
    const result = parseDailySummarySheet(rows, '2026-09-01', '2026-09-01');
    const day = result.get('2026-09-01');
    assert.ok(day);
    assert.strictEqual(day.opening, 1000);
    assert.strictEqual(day.deposit, 500);
    assert.strictEqual(day.withdraw, 200);
    assert.strictEqual(day.expense, 50);
    assert.strictEqual(day.cashReceived, 0);
    assert.strictEqual(day.closingCashCount, 1250);
    assert.strictEqual(day.bookFinal, 1250);
  });

  it('throws OfficeRecordsColumnError when a required column is missing', () => {
    const rows = [[], ['DATE', 'START UP']]; // missing every other required column
    assert.throws(() => parseDailySummarySheet(rows, '2026-09-01', '2026-09-01'), OfficeRecordsColumnError);
  });
});

describe('parseCashOutSheet - forward-fill', () => {
  it('forward-fills the date across rows until a blank-name subtotal row', () => {
    const rows = [
      ['DATE', 'NAME', 'AMNT', 'COMMISSON'],
      ['01/09/2026', 'Kwame Mensah', '100.00', '3.00'],
      ['', 'Ama Serwaa', '200.00', '6.00'],
      ['', '', '300.00', '9.00'], // blank name -> day's subtotal row, ends the block
      ['02/09/2026', 'Yaw Boateng', '50.00', '1.50'],
    ];
    const result = parseCashOutSheet(rows, '2026-09-01', '2026-09-02');
    assert.strictEqual(result.get('2026-09-01')?.length, 2);
    assert.strictEqual(result.get('2026-09-01')?.[0]?.name, 'Kwame Mensah');
    assert.strictEqual(result.get('2026-09-01')?.[1]?.name, 'Ama Serwaa');
    assert.strictEqual(result.get('2026-09-02')?.length, 1);
  });

  it('keeps the first AMNT column, not a later denomination-breakdown repeat of the same label', () => {
    const rows = [
      ['DATE', 'NAME', 'AMNT', '200 K', 'AMNT', 'COMMISSON'],
      ['01/09/2026', 'Kwame Mensah', '100.00', '2', '2.00', '3.00'],
    ];
    const result = parseCashOutSheet(rows, '2026-09-01', '2026-09-01');
    assert.strictEqual(result.get('2026-09-01')?.[0]?.amountMinor, 10000); // not 200 (the second AMNT column)
  });
});

describe('normalizeName', () => {
  it('makes name comparison order/case insensitive and strips non-letter characters (hyphens included, not turned into spaces)', () => {
    // Ported verbatim from the reference file: non-[A-Z ] characters are
    // deleted outright, so "Mensah-Osei" collapses to "MENSAHOSEI" (the
    // hyphen just vanishes) rather than becoming two words - this test
    // documents that real, ported behavior rather than an idealized one.
    assert.strictEqual(normalizeName('Kwame Mensah-Osei'), normalizeName('KWAME MENSAHOSEI'));
    assert.strictEqual(normalizeName('Osei Kwame'), normalizeName('Kwame Osei'));
  });
});

describe('matchWithdrawalsForDate', () => {
  it('matches exact amount + name first', () => {
    const office = [{ name: 'Kwame Mensah', amountMinor: 10000, commissionMinor: 300 }];
    const app = [{ customerName: 'Kwame Mensah', amountMinor: 10000, commissionMinor: 300, hasStructuredRecord: true }];
    const result = matchWithdrawalsForDate(office, app);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]?.status, 'Matches');
  });

  it('flags an office-only row when nothing matches', () => {
    const office = [{ name: 'Nobody Registered', amountMinor: 5000, commissionMinor: 100 }];
    const result = matchWithdrawalsForDate(office, []);
    assert.strictEqual(result.length, 1);
    assert.ok(result[0]?.status.startsWith('IN OFFICE SHEET ONLY'));
  });

  it('flags an app-only row when the office sheet has nothing for it', () => {
    const app = [{ customerName: 'Only In App', amountMinor: 5000, commissionMinor: 100, hasStructuredRecord: true }];
    const result = matchWithdrawalsForDate([], app);
    assert.strictEqual(result.length, 1);
    assert.ok(result[0]?.status.startsWith('IN APP ONLY'));
  });

  it('matches a pre-structured-record row on the gross (principal+commission) amount', () => {
    // Before the app tracked commission separately, dr_minor was the gross amount.
    const office = [{ name: 'Ama Serwaa', amountMinor: 10000, commissionMinor: 300 }];
    const app = [{ customerName: 'Ama Serwaa', amountMinor: 10300, commissionMinor: 0, hasStructuredRecord: false }];
    const result = matchWithdrawalsForDate(office, app);
    assert.strictEqual(result.length, 1);
    assert.ok(result[0]?.status.startsWith('Matches (pre-structured record'));
  });

  it('flags a real amount mismatch between office and app for a structured record', () => {
    const office = [{ name: 'Kwame Mensah', amountMinor: 10000, commissionMinor: 300 }];
    const app = [{ customerName: 'Kwame Mensah', amountMinor: 9000, commissionMinor: 300, hasStructuredRecord: true }];
    const result = matchWithdrawalsForDate(office, app);
    assert.strictEqual(result.length, 1);
    assert.ok(result[0]?.status.startsWith('AMOUNT MISMATCH'));
  });
});

describe('buildHeaderIndex / requireCol', () => {
  it('keeps the first occurrence of a repeated label', () => {
    const index = buildHeaderIndex([['A', 'B', 'A']], 1);
    assert.strictEqual(index.get('A'), 0);
  });

  it('requireCol throws OfficeRecordsColumnError for a missing label', () => {
    const index = buildHeaderIndex([['A']], 1);
    assert.throws(() => requireCol(index, 'B', 'TEST SHEET'), OfficeRecordsColumnError);
  });
});
