// Regression coverage for lib/moneymanager/office-records/fetch.ts's retry
// logic, specifically the broadening found necessary by real-data testing
// against the actual Master Workbook: a plain transport-level failure
// (`TypeError: terminated`, confirmed live on an 11.6MB .xlsx download)
// must be retried even though it isn't the reference file's originally-
// ported "sign-in/permission page" OfficeRecordsFetchError condition.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as XLSX from 'xlsx';
import { fetchCsvRows, fetchWorkbook, OfficeRecordsFetchError } from '../office-records/fetch';

function minimalXlsxBuffer(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['A1']]), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function csvOkResponse(text: string): Response {
  return { ok: true, status: 200, text: async () => text } as Response;
}

describe('fetchCsvRows retry behavior', () => {
  it('retries a generic transport-level error (not just the sign-in-page case) and succeeds on a later attempt', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls < 3) throw new TypeError('terminated');
      return csvOkResponse('DATE,COINS,TOTAL\n01/09/2026,5,100.00');
    }) as unknown as typeof fetch;

    const rows = await fetchCsvRows('https://docs.google.com/spreadsheets/d/FAKE/export?format=csv', 'ZONE A', fetchImpl, [1, 1, 1]);
    assert.strictEqual(calls, 3);
    assert.strictEqual(rows.length, 2);
  });

  it('still fails (after exhausting retries) when every attempt is a transport-level error', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('terminated');
    }) as unknown as typeof fetch;

    await assert.rejects(
      () => fetchCsvRows('https://docs.google.com/spreadsheets/d/FAKE/export?format=csv', 'ZONE A', fetchImpl, [1, 1]),
      TypeError
    );
  });

  it('does NOT retry a genuine non-sign-in-page HTTP status error (fails fast)', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return { ok: false, status: 403, text: async () => '' } as Response;
    }) as unknown as typeof fetch;

    await assert.rejects(
      () => fetchCsvRows('https://docs.google.com/spreadsheets/d/FAKE/export?format=csv', 'ZONE A', fetchImpl, [1, 1, 1]),
      OfficeRecordsFetchError
    );
    assert.strictEqual(calls, 1, 'a genuine HTTP 403 should not be retried - retrying wastes time on a non-transient problem');
  });

  it('still retries the original sign-in-page detection case', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls < 2) return csvOkResponse('<!doctype html><html>sign in</html>');
      return csvOkResponse('DATE,COINS,TOTAL\n01/09/2026,5,100.00');
    }) as unknown as typeof fetch;

    const rows = await fetchCsvRows('https://docs.google.com/spreadsheets/d/FAKE/export?format=csv', 'ZONE A', fetchImpl, [1, 1]);
    assert.strictEqual(calls, 2);
    assert.strictEqual(rows.length, 2);
  });
});

describe('fetchWorkbook retry behavior', () => {
  it('retries a generic transport-level error on the workbook fetch too', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls < 2) throw new TypeError('terminated');
      // A real, minimal valid .xlsx buffer (built via the xlsx library
      // itself) so fetchWorkbook's PK-signature check and XLSX.read both
      // succeed - only the retry behavior matters here, not the contents.
      const buffer = minimalXlsxBuffer();
      return { ok: true, status: 200, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) } as Response;
    }) as unknown as typeof fetch;

    const wb = await fetchWorkbook('https://docs.google.com/spreadsheets/d/FAKE/export?format=xlsx', fetchImpl, [1, 1]);
    assert.strictEqual(calls, 2);
    assert.ok(wb);
  });
});
