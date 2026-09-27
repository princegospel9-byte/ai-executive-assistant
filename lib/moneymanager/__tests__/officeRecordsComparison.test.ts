// Integration tests for officeRecordsComparisonRule (lib/moneymanager/
// rules/officeRecordsComparison.ts). Network calls are always mocked via an
// injected fetchImpl - this file never makes a real request to Google
// Sheets or anywhere else, per the task's hard constraint.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as XLSX from 'xlsx';
import { runAllRules } from '../rules';
import { SnapshotReader } from '../client/snapshot';
import { buildFixtureDb, type FixtureDb } from './fixtureDb';
import type { OfficeRecordsConfigResult } from '../office-records/config';

let fixture: FixtureDb | undefined;

afterEach(() => {
  fixture?.close();
  fixture = undefined;
});

const CONFIGURED: OfficeRecordsConfigResult = {
  configured: true,
  urls: {
    zoneA: 'https://docs.google.com/spreadsheets/d/ZONEA_ID/edit',
    zoneB: 'https://docs.google.com/spreadsheets/d/ZONEB_ID/edit',
    zoneC: 'https://docs.google.com/spreadsheets/d/ZONEC_ID/edit',
    zoneD: 'https://docs.google.com/spreadsheets/d/ZONED_ID/edit',
    zoneE: 'https://docs.google.com/spreadsheets/d/ZONEE_ID/edit',
    masterWorkbook: 'https://docs.google.com/spreadsheets/d/MASTER_ID/edit',
  },
};

const DATE_RANGE = { dateFrom: '2026-09-01', dateTo: '2026-09-01' };

function csvResponse(rows: string[][]): Response {
  const text = rows.map((r) => r.join(',')).join('\n');
  return {
    ok: true,
    status: 200,
    text: async () => text,
  } as Response;
}

function workbookResponse(dailySummaryRows: string[][], cashOutRows: string[][]): Response {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dailySummaryRows), 'DAILY SUMMARY');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cashOutRows), 'CASH OUT');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  } as Response;
}

function signInPageResponse(): Response {
  return {
    ok: true,
    status: 200,
    text: async () => '<!doctype html><html><body>Sign in</body></html>',
    arrayBuffer: async () => new TextEncoder().encode('<!doctype html>').buffer,
  } as Response;
}

/** Empty zone sheet (no data rows for the date under test) - used for the
 * four zones we're not exercising a real diff against, so parseZoneCsv
 * returns an empty map and those zone/date pairs stay officeMinor: null
 * (skipped, no finding). */
function emptyZoneCsv(): Response {
  return csvResponse([['DATE', 'NOTES', 'COINS', 'TOTAL']]);
}

describe('officeRecordsComparisonRule - fetch failure (sign-in page)', () => {
  it('emits SAVINGS_COMPARE_WITH_OFFICE_RECORDS_UNAVAILABLE with the required message, never "no discrepancies"', async () => {
    fixture = buildFixtureDb((db) => {
      db.exec(`insert into branches values (1, 'JACOL', 'Jacol')`);
    });
    const reader = SnapshotReader.open(fixture.path);

    const fetchImpl = (async () => signInPageResponse()) as unknown as typeof fetch;

    const results = await runAllRules({
      reader,
      officeRecordsConfig: CONFIGURED,
      fetchImpl,
      officeRecordsDateRange: DATE_RANGE,
      officeRecordsRetryDelaysMs: [], // no retry delay in tests
    });
    reader.close();

    const findings = results.flatMap((r) => r.findings);
    const officeFindings = findings.filter((f) => f.ruleId === 'mm.office_records_comparison.v1');

    // The single most important correctness property in this rule: when the
    // source is unreachable, EXACTLY ONE finding comes out of this rule -
    // the UNAVAILABLE one - and there is no coexisting SUMMARY/INFO "clean"
    // finding alongside it. This is guaranteed structurally by
    // officeRecordsComparisonRule's catch block doing a hard `return [...]`
    // before the summary-building code is ever reached, not just by this
    // assertion - but asserting it here makes that guarantee a permanent,
    // enforced regression test rather than something only visible by
    // reading the source.
    assert.strictEqual(officeFindings.length, 1);
    const unavailable = officeFindings[0];
    assert.strictEqual(unavailable.findingType, 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_UNAVAILABLE');
    assert.notStrictEqual(unavailable.findingType, 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_SUMMARY');
    assert.strictEqual(unavailable.severity, 'WARNING');
    assert.strictEqual(
      (unavailable.evidence as { message: string }).message,
      'Office Records comparison could not be completed because the external office-record source was unavailable.'
    );
    // Never claim "no discrepancies" when the source was unavailable.
    assert.ok(!JSON.stringify(unavailable.evidence).toLowerCase().includes('no discrepancies'));
  });
});

describe('officeRecordsComparisonRule - fetch failure (plain network error)', () => {
  it('also emits UNAVAILABLE (never a clean result) when fetch itself rejects, not just on a bad response', async () => {
    fixture = buildFixtureDb((db) => {
      db.exec(`insert into branches values (1, 'JACOL', 'Jacol')`);
    });
    const reader = SnapshotReader.open(fixture.path);

    const fetchImpl = (async () => {
      throw new Error('getaddrinfo ENOTFOUND docs.google.com');
    }) as unknown as typeof fetch;

    const results = await runAllRules({
      reader,
      officeRecordsConfig: CONFIGURED,
      fetchImpl,
      officeRecordsDateRange: DATE_RANGE,
      officeRecordsRetryDelaysMs: [],
    });
    reader.close();

    const officeFindings = results.flatMap((r) => r.findings).filter((f) => f.ruleId === 'mm.office_records_comparison.v1');
    assert.strictEqual(officeFindings.length, 1);
    assert.strictEqual(officeFindings[0].findingType, 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_UNAVAILABLE');
    assert.ok(!JSON.stringify(officeFindings[0].evidence).toLowerCase().includes('no discrepancies'));
  });
});

describe('officeRecordsComparisonRule - fetch failure (non-OK HTTP status)', () => {
  it('emits UNAVAILABLE, not a clean result, when a zone sheet returns HTTP 403', async () => {
    fixture = buildFixtureDb((db) => {
      db.exec(`insert into branches values (1, 'JACOL', 'Jacol')`);
    });
    const reader = SnapshotReader.open(fixture.path);

    const fetchImpl = (async () =>
      ({ ok: false, status: 403, text: async () => '' }) as unknown as Response) as unknown as typeof fetch;

    const results = await runAllRules({
      reader,
      officeRecordsConfig: CONFIGURED,
      fetchImpl,
      officeRecordsDateRange: DATE_RANGE,
      officeRecordsRetryDelaysMs: [],
    });
    reader.close();

    const officeFindings = results.flatMap((r) => r.findings).filter((f) => f.ruleId === 'mm.office_records_comparison.v1');
    assert.strictEqual(officeFindings.length, 1);
    assert.strictEqual(officeFindings[0].findingType, 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_UNAVAILABLE');
  });
});

describe('officeRecordsComparisonRule - successful comparison', () => {
  it('flags a zone diff and a withdrawal mismatch from realistic mocked Sheets data', async () => {
    fixture = buildFixtureDb((db) => {
      db.exec(`insert into branches values (1, 'JACOL', 'Jacol')`);
      db.exec(`insert into zones values (1, 1, 'ZONE A')`);
      db.exec(`insert into customers values (1, 1, 'Kwame Mensah', 1)`);
      db.exec(
        `insert into customer_accounts values (1, 1, 1, '1000000001', 'Kwame Mensah', 'Random', 10000, 'ACTIVE', 0)`
      );
      // App-side zone collection: GHS 100.00 deposit on 2026-09-01.
      db.exec(
        `insert into customer_ledger_entries values
         (1, 1, 1, '2026-09-01', 'RCT-0001', 'r1', 'DEPOSIT', 0, 10000, 10000, 'DEPOSIT', 'b1', null)`
      );
      // App-side withdrawal: GHS 50.00 + GHS 1.50 commission on 2026-09-01.
      db.exec(
        `insert into customer_ledger_entries values
         (2, 1, 1, '2026-09-01', 'RCT-0002', 'r2', 'Withdrawal', 5150, 0, 4850, 'Withdrawal', 'b2', null)`
      );
      db.exec(
        `insert into withdrawal_records values
         (2, 1, 1, 10000, 5000, 150, 4850, null, null, '2026-09-01T10:00:00.000Z')`
      );
    });
    const reader = SnapshotReader.open(fixture.path);

    // Office-side ZONE A total: GHS 90.00 (app says 100.00 -> diff 10.00).
    const zoneACsv = csvResponse([
      ['DATE', 'NOTES', 'COINS', 'TOTAL'],
      ['01/09/2026', '5', '2', '90.00'],
    ]);
    // Office-side CASH OUT: GHS 40.00 + GHS 1.00 commission for Kwame Mensah
    // (app says 50.00 + 1.50 -> AMOUNT MISMATCH, since the app row IS a
    // structured record here - withdrawal_records exists for it).
    const dailySummaryRows = [
      ['MASTER WORKBOOK'],
      ['DATE', 'START UP', 'TOTAL MOBILIZIED', 'WITHDRAWALS', 'EXPENDITURE', 'FROM OTHER SOURCE', 'FINAL', 'TOTAL AMOUNT'],
      ['01/09/2026', '0', '90', '40', '0', '0', '50', '50'],
    ];
    const cashOutRows = [
      ['DATE', 'NAME', 'AMNT', 'COMMISSON'],
      ['01/09/2026', 'Kwame Mensah', '40.00', '1.00'],
    ];
    const masterResponse = workbookResponse(dailySummaryRows, cashOutRows);

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('ZONEA_ID')) return zoneACsv;
      if (url.includes('MASTER_ID')) return masterResponse;
      // ZONE B-E: no data for this date.
      return emptyZoneCsv();
    }) as unknown as typeof fetch;

    const results = await runAllRules({
      reader,
      officeRecordsConfig: CONFIGURED,
      fetchImpl,
      officeRecordsDateRange: DATE_RANGE,
      officeRecordsRetryDelaysMs: [],
    });
    reader.close();

    const findings = results.flatMap((r) => r.findings);
    const officeFindings = findings.filter((f) => f.ruleId === 'mm.office_records_comparison.v1');

    const zoneDiff = officeFindings.find((f) => f.findingType === 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_ZONE_DIFF');
    assert.ok(zoneDiff, 'expected a zone diff finding');
    assert.strictEqual(zoneDiff.entityId, 'ZONE A');
    assert.strictEqual(zoneDiff.expectedValue, 9000); // office: GHS 90.00
    assert.strictEqual(zoneDiff.actualValue, 10000); // app: GHS 100.00
    assert.strictEqual(zoneDiff.variance, 1000);

    const withdrawalMismatch = officeFindings.find(
      (f) => f.findingType === 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_WITHDRAWAL_MISMATCH'
    );
    assert.ok(withdrawalMismatch, 'expected a withdrawal mismatch finding');

    const summary = officeFindings.find((f) => f.findingType === 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_SUMMARY');
    assert.ok(summary);
    assert.strictEqual(summary.severity, 'WARNING');
    const evidence = summary.evidence as { discrepancies: { total: number } };
    assert.strictEqual(evidence.discrepancies.total, 2);
  });

  it('emits only the INFO summary when office and app agree exactly', async () => {
    fixture = buildFixtureDb((db) => {
      db.exec(`insert into branches values (1, 'JACOL', 'Jacol')`);
      db.exec(`insert into zones values (1, 1, 'ZONE A')`);
      db.exec(`insert into customers values (1, 1, 'Kwame Mensah', 1)`);
      db.exec(
        `insert into customer_accounts values (1, 1, 1, '1000000001', 'Kwame Mensah', 'Random', 10000, 'ACTIVE', 0)`
      );
      db.exec(
        `insert into customer_ledger_entries values
         (1, 1, 1, '2026-09-01', 'RCT-0001', 'r1', 'DEPOSIT', 0, 9000, 9000, 'DEPOSIT', 'b1', null)`
      );
    });
    const reader = SnapshotReader.open(fixture.path);

    const zoneACsv = csvResponse([
      ['DATE', 'NOTES', 'COINS', 'TOTAL'],
      ['01/09/2026', '5', '2', '90.00'], // matches the app's GHS 90.00 exactly
    ]);
    const dailySummaryRows = [
      ['MASTER WORKBOOK'],
      ['DATE', 'START UP', 'TOTAL MOBILIZIED', 'WITHDRAWALS', 'EXPENDITURE', 'FROM OTHER SOURCE', 'FINAL', 'TOTAL AMOUNT'],
      ['01/09/2026', '0', '90', '0', '0', '0', '90', '90'],
    ];
    const cashOutRows = [['DATE', 'NAME', 'AMNT', 'COMMISSON']]; // no withdrawals either side
    const masterResponse = workbookResponse(dailySummaryRows, cashOutRows);

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('ZONEA_ID')) return zoneACsv;
      if (url.includes('MASTER_ID')) return masterResponse;
      return emptyZoneCsv();
    }) as unknown as typeof fetch;

    const results = await runAllRules({
      reader,
      officeRecordsConfig: CONFIGURED,
      fetchImpl,
      officeRecordsDateRange: DATE_RANGE,
      officeRecordsRetryDelaysMs: [],
    });
    reader.close();

    const officeFindings = results.flatMap((r) => r.findings).filter((f) => f.ruleId === 'mm.office_records_comparison.v1');
    assert.strictEqual(officeFindings.length, 1);
    assert.strictEqual(officeFindings[0].findingType, 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_SUMMARY');
    assert.strictEqual(officeFindings[0].severity, 'INFO');
  });
});
