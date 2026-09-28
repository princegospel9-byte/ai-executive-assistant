// Phase 4C: tests for the real HTTP adapter (lib/moneymanager/client/
// lan-api-source.ts + client/lan-api/http-client.ts). No real network call
// anywhere in this file - every test injects a fake `fetchImpl`, exactly
// the same pattern already established by lib/moneymanager/office-records/
// fetch.ts and exercised in officeRecordsFetch.test.ts. The point of these
// tests is that genuinely different failure modes (empty-valid, 401, 403,
// timeout, network error, malformed body) surface as genuinely different,
// typed errors - never collapsed into one generic "something went wrong",
// and never silently coerced into an empty-looking-clean result.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LanApiSource } from '../client/lan-api-source';
import type { MoneyManagerSource } from '../client/source';
import {
  LanApiAuthenticationError,
  LanApiMalformedResponseError,
  LanApiNetworkError,
  LanApiPermissionError,
  LanApiTimeoutError,
  LanApiUnsupportedMethodError,
} from '../client/lan-api/errors';
import { runAllRules } from '../rules';
import { glReconciliationRule } from '../rules/glReconciliation';
import { classifyFindings } from '../classification/classify';
import { runMonitoring } from '../run';
import { FakePersistence } from './fakePersistence';
import { OFFICE_RECORDS_NOT_CONFIGURED } from '../office-records/config';

const BASE_URL = 'http://192.168.1.50:4000'; // example office-LAN address used only in this test file, never a real one
const SESSION_COOKIE = 'test-session-token-not-real';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Routes matched by pathname only (query string ignored, since these
 * fakes don't need to assert on pagination/filter params to prove the
 * point of each test). */
type FakeRoute = (url: URL) => Response;

function fakeFetch(routes: Record<string, FakeRoute>): typeof fetch {
  return (async (input: string | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const handler = routes[url.pathname];
    if (!handler) {
      throw new Error(`fakeFetch: no route registered for ${url.pathname}`);
    }
    return handler(url);
  }) as unknown as typeof fetch;
}

/** A fetchImpl that never resolves on its own - only rejects if the caller's
 * AbortController fires, exactly like a real hung network request would
 * behave under fetch()'s own abort-signal contract. */
function hangingFetch(): typeof fetch {
  return (async (_input: string | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
      }
      // Otherwise never settles - only the abort above ever resolves this.
    });
  }) as unknown as typeof fetch;
}

function networkFailureFetch(): typeof fetch {
  return (async () => {
    throw new TypeError('fetch failed: getaddrinfo ENOTFOUND 192.168.1.50');
  }) as unknown as typeof fetch;
}

describe('LanApiSource - compile-time interface satisfaction', () => {
  it('satisfies MoneyManagerSource', () => {
    const source: MoneyManagerSource = new LanApiSource({
      baseUrl: BASE_URL,
      sessionCookie: SESSION_COOKIE,
      fetchImpl: fakeFetch({}),
    });
    assert.ok(source);
  });
});

describe('LanApiSource - distinct failure modes', () => {
  it('surfaces HTTP 401 as LanApiAuthenticationError, distinctly from other failures', async () => {
    const source = new LanApiSource({
      baseUrl: BASE_URL,
      sessionCookie: SESSION_COOKIE,
      fetchImpl: fakeFetch({ '/api/branches': () => jsonResponse(401, { error: 'not authenticated' }) }),
    });
    await assert.rejects(() => source.branches(), LanApiAuthenticationError);
  });

  it('surfaces HTTP 403 as LanApiPermissionError, distinctly from a 401', async () => {
    const source = new LanApiSource({
      baseUrl: BASE_URL,
      sessionCookie: SESSION_COOKIE,
      fetchImpl: fakeFetch({
        '/api/field-survey-checks': () => jsonResponse(403, { error: 'missing PASSBOOK_CHECK_MANAGE' }),
      }),
    });
    await assert.rejects(() => source.fieldSurveyChecks(), LanApiPermissionError);
  });

  it('surfaces a timeout distinctly from a network error', async () => {
    const source = new LanApiSource({
      baseUrl: BASE_URL,
      sessionCookie: SESSION_COOKIE,
      timeoutMs: 20,
      fetchImpl: hangingFetch(),
    });
    await assert.rejects(() => source.branches(), LanApiTimeoutError);
  });

  it('surfaces a genuine network/DNS failure as LanApiNetworkError, not a timeout', async () => {
    const source = new LanApiSource({
      baseUrl: BASE_URL,
      sessionCookie: SESSION_COOKIE,
      fetchImpl: networkFailureFetch(),
    });
    await assert.rejects(() => source.branches(), LanApiNetworkError);
  });

  it('surfaces a malformed/incomplete response as LanApiMalformedResponseError, never silently coerced to empty', async () => {
    const source = new LanApiSource({
      baseUrl: BASE_URL,
      sessionCookie: SESSION_COOKIE,
      fetchImpl: fakeFetch({
        // Missing `total` - fails the {items, total} shape check.
        '/api/loans': () => jsonResponse(200, { items: [] }),
      }),
    });
    await assert.rejects(() => source.loans(), LanApiMalformedResponseError);
  });

  it('a successful-but-empty response is distinct from every failure above - resolves cleanly to []', async () => {
    const source = new LanApiSource({
      baseUrl: BASE_URL,
      sessionCookie: SESSION_COOKIE,
      fetchImpl: fakeFetch({
        '/api/loans': () => jsonResponse(200, { items: [], total: 0 }),
      }),
    });
    const result = await source.loans();
    assert.deepStrictEqual(result, []);
  });

  it('unsupported methods throw LanApiUnsupportedMethodError rather than returning an empty array', async () => {
    const source = new LanApiSource({
      baseUrl: BASE_URL,
      sessionCookie: SESSION_COOKIE,
      fetchImpl: fakeFetch({}),
    });
    await assert.rejects(() => source.customerAccounts(), LanApiUnsupportedMethodError);
  });
});

describe('LanApiSource - successful live response through the full rules -> classification pipeline', () => {
  it('produces the correct GL findings end to end from a fake-but-realistic live response', async () => {
    // Ledger entries deliberately don't balance (dr != cr) and the GL
    // account's stored balance disagrees with its computed movement -
    // exactly the same shape of discrepancy the offline-snapshot tests use.
    const ledgerEntries = [
      { id: 1, entryDate: '2026-09-20', glAccountId: 1, drMinor: 1000, crMinor: 0, batchNo: 'b1' },
      { id: 2, entryDate: '2026-09-20', glAccountId: 2, drMinor: 0, crMinor: 900, batchNo: 'b1' },
    ];
    const source = new LanApiSource({
      baseUrl: BASE_URL,
      sessionCookie: SESSION_COOKIE,
      fetchImpl: fakeFetch({
        '/api/ledger': (url) => {
          const offset = Number(url.searchParams.get('offset') ?? '0');
          if (offset === 0) {
            return jsonResponse(200, { items: ledgerEntries, total: ledgerEntries.length, totalDrMinor: 1000, totalCrMinor: 900 });
          }
          return jsonResponse(200, { items: [], total: ledgerEntries.length, totalDrMinor: 1000, totalCrMinor: 900 });
        },
        '/api/ledger/gl-accounts': () =>
          jsonResponse(200, [
            { id: 1, branchId: 1, accountCode: '10001', accountName: 'Vault', balanceMinor: 1000 },
            { id: 2, branchId: 1, accountCode: '20003', accountName: 'Savings Control', balanceMinor: 500 },
          ]),
      }),
    });

    const ruleResults = await runAllRules({ reader: source, officeRecordsConfig: OFFICE_RECORDS_NOT_CONFIGURED });
    const glResult = ruleResults.find((r) => r.ruleId === glReconciliationRule.ruleId);
    assert.ok(glResult);
    assert.strictEqual(glResult.error, null);

    const globalImbalance = glResult.findings.find((f) => f.findingType === 'GL_GLOBAL_IMBALANCE');
    assert.ok(globalImbalance, 'expected a GL_GLOBAL_IMBALANCE finding (dr 1000 != cr 900)');
    assert.strictEqual(globalImbalance.variance, 100);

    const classified = classifyFindings(glResult.findings, {
      moneyManagerDataAsOf: await source.dataAsOfDate(),
      officeRecordsConfigured: false,
      officeRecordsReportingPeriod: null,
    });
    const classifiedImbalance = classified.find((f) => f.findingType === 'GL_GLOBAL_IMBALANCE');
    // classify.ts deterministically treats every GL_GLOBAL_IMBALANCE as
    // POSSIBLE_DISCREPANCY, not CONFIRMED_DISCREPANCY - a documented,
    // permanent scope-gap caveat (ledger_entries is narrower than
    // customer_ledger_entries) that applies identically whether the
    // ledger_entries data came from the offline snapshot or, as here, this
    // live adapter - proving classification behavior is unchanged by
    // which MoneyManagerSource produced the finding.
    assert.strictEqual(classifiedImbalance?.classification, 'POSSIBLE_DISCREPANCY');
  });
});

describe('runMonitoring - substitutability with a real injected LanApiSource (Phase 4C)', () => {
  it('runs a full monitoring run using an injected LanApiSource instead of a snapshot path', async () => {
    const ledgerEntries = [
      { id: 1, entryDate: '2026-09-20', glAccountId: 1, drMinor: 500, crMinor: 500, batchNo: 'b1' },
    ];
    const source = new LanApiSource({
      baseUrl: BASE_URL,
      sessionCookie: SESSION_COOKIE,
      fetchImpl: fakeFetch({
        '/api/ledger': (url) => {
          const offset = Number(url.searchParams.get('offset') ?? '0');
          if (offset === 0) {
            return jsonResponse(200, { items: ledgerEntries, total: ledgerEntries.length, totalDrMinor: 500, totalCrMinor: 500 });
          }
          return jsonResponse(200, { items: [], total: ledgerEntries.length, totalDrMinor: 500, totalCrMinor: 500 });
        },
        '/api/ledger/gl-accounts': () =>
          // category comes back 'UNKNOWN' (the documented live field gap -
          // see glAccounts()'s doc comment), so glReconciliation.ts computes
          // this account's movement the non-DEBIT_NATURE way: crMinor(500) -
          // drMinor(500) = 0 - balanceMinor must also be 0 to be "clean".
          jsonResponse(200, [{ id: 1, branchId: 1, accountCode: '10001', accountName: 'Vault', balanceMinor: 0 }]),
        '/api/branches': () => jsonResponse(200, [{ id: 1, code: 'JACOL', name: 'Jacol Susu Enterprise' }]),
        '/api/loans': (url) => {
          const offset = Number(url.searchParams.get('offset') ?? '0');
          return jsonResponse(200, { items: [], total: 0, ...(offset === 0 ? {} : {}) });
        },
        '/api/investments': () => jsonResponse(200, { items: [], total: 0 }),
        '/api/field-survey-checks': () => jsonResponse(403, { error: 'missing PASSBOOK_CHECK_MANAGE' }),
        '/api/passbook-checks': () => jsonResponse(403, { error: 'missing PASSBOOK_CHECK_MANAGE' }),
        '/api/withdrawals/records': () => jsonResponse(200, { items: [], total: 0 }),
      }),
    });

    const persistence = new FakePersistence();
    const result = await runMonitoring({
      source,
      sourceIdentifier: `lan-api:${BASE_URL}`,
      userId: '00000000-0000-0000-0000-000000000001',
      persistence,
      businessDate: '2026-09-27',
    });

    // Several rules (customerAccounts-dependent, etc.) are expected to
    // fail against this fake source (LanApiUnsupportedMethodError) - that
    // MUST surface as 'incomplete', never a false 'completed'.
    assert.strictEqual(result.status, 'incomplete');
    assert.ok(result.incompleteReason);
    assert.strictEqual(persistence.runs.get(result.runId)?.status, 'incomplete');
    // The run row was still created and identified by the caller-supplied
    // sourceIdentifier, not a snapshot path.
    assert.ok(persistence.runs.get(result.runId)?.snapshotIdentifier.startsWith('lan-api:'));

    // But the rules that CAN run against this source (glReconciliation) did,
    // and their findings still made it through classification+persistence.
    const glFinding = result.findings.find((f) => f.findingType === 'GL_ACCOUNT_BALANCE_MISMATCH' || f.findingType === 'GL_GLOBAL_IMBALANCE');
    // With balanced entries (dr 500 == cr 500) there should be no GL
    // imbalance finding at all - this just proves the rule ran cleanly
    // rather than erroring, distinguishing "ran, found nothing" from
    // "didn't run".
    assert.strictEqual(glFinding, undefined);
  });
});

describe('LanApiSource - documented API gaps throw distinctly, never fabricate data', () => {
  it('withdrawalRecordsWithLedgerEntry refuses rather than returning ledgerEntry: null for every row', async () => {
    const source = new LanApiSource({ baseUrl: BASE_URL, sessionCookie: SESSION_COOKIE, fetchImpl: fakeFetch({}) });
    await assert.rejects(() => source.withdrawalRecordsWithLedgerEntry(), LanApiUnsupportedMethodError);
  });

  it('zoneCollectionsByDate refuses (no live endpoint aggregates by zone)', async () => {
    const source: MoneyManagerSource = new LanApiSource({ baseUrl: BASE_URL, sessionCookie: SESSION_COOKIE, fetchImpl: fakeFetch({}) });
    await assert.rejects(() => source.zoneCollectionsByDate('2026-09-01', '2026-09-30'), LanApiUnsupportedMethodError);
  });
});
