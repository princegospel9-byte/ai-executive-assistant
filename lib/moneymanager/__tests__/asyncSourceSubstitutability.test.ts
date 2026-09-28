// Phase 4B: the key architectural test. A completely separate,
// hand-written fake MoneyManagerSource - NOT SnapshotReader, no sqlite
// anywhere in it - whose every method genuinely awaits a real macrotask
// delay (`setTimeout`, not `Promise.resolve()`) before returning canned
// data. If any part of the rule engine or the Phase 4A classification
// layer secretly still assumed synchronous access (e.g. called a source
// method without awaiting it, or read a property off the returned Promise
// instead of its resolved value), this test would fail with a type error
// at best and a broken/garbage result at worst - it does not merely
// typecheck substitutability, it exercises it end to end: all 11 rules run
// against this fake source, then their findings are classified, proving
// the whole pipeline (source -> rules -> classification) depends only on
// the MoneyManagerSource interface, never on SnapshotReader concretely.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runAllRules } from '../rules';
import { classifyFindings } from '../classification/classify';
import type { MoneyManagerSource } from '../client/source';
import type { OfficeRecordsConfigResult } from '../office-records/config';

const REAL_DELAY_MS = 5;

/** Every method genuinely suspends via a real timer, not a microtask
 * shortcut - proves the engine doesn't rely on Promise resolution being
 * "immediate" the way Promise.resolve()/async-without-await would be. */
function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), REAL_DELAY_MS));
}

/** A from-scratch fake source - deliberately NOT extending or wrapping
 * SnapshotReader in any way, so passing typecheck here is only possible if
 * every rule genuinely depends on the MoneyManagerSource interface. Seeded
 * with data that should produce a real finding from several different
 * rules, so this isn't just "runs without crashing" but "produces the
 * expected findings from genuinely async data". */
class FakeAsyncMoneyManagerSource implements MoneyManagerSource {
  async tableCounts() {
    return delay({ customer_accounts: 1, customer_ledger_entries: 1 });
  }
  async branches() {
    return delay([{ id: 1, code: 'FAKE', name: 'Fake Branch' }]);
  }
  async glAccounts() {
    return delay([
      { id: 1, branchId: 1, accountCode: '10001', accountName: 'Vault', category: 'ASSET', balanceMinor: 12345 },
    ]);
  }
  async customerAccounts() {
    return delay([
      {
        id: 1,
        branchId: 1,
        customerId: 1,
        accountNo: '1000000001',
        accountName: 'Fake Customer',
        accountType: 'Random',
        currentBalanceMinor: 999, // deliberately wrong vs. latestLedgerBalancePerAccount below
        accountStatus: 'ACTIVE',
        dormant: false,
      },
    ]);
  }
  async latestLedgerBalancePerAccount() {
    return delay(new Map([[1, { entryId: 1, balanceMinor: 500, entryDate: '2026-09-15' }]]));
  }
  async duplicateCustomerLedgerGroups() {
    return delay([]);
  }
  async duplicateReceiptNumbers() {
    return delay([]);
  }
  async orphanedCustomerLedgerEntries() {
    return delay([{ id: 42, customerAccountId: 999, entryDate: '2026-09-10' }]);
  }
  async orphanedLedgerEntries() {
    return delay([]);
  }
  async orphanedWithdrawalRecords() {
    return delay([]);
  }
  async withdrawalRecordsWithLedgerEntry() {
    return delay([]);
  }
  async glAccountMovementTotals() {
    return delay(new Map([[1, { drMinor: 500, crMinor: 0 }]]));
  }
  async ledgerBatchTotals() {
    return delay([]);
  }
  async ledgerTotals() {
    return delay({ drMinor: 500, crMinor: 500 });
  }
  async dailyDepositTotals() {
    return delay([]);
  }
  async allEntryDates() {
    return delay([{ table: 'customer_ledger_entries', id: 1, entryDate: '2026-09-15' }]);
  }
  async zeroAmountEntries() {
    return delay([]);
  }
  async loans() {
    return delay([]);
  }
  async investments() {
    return delay([]);
  }
  async fieldSurveyChecks() {
    return delay([]);
  }
  async passbookChecks() {
    return delay([]);
  }
  async zoneCollectionsByDate() {
    return delay([]);
  }
  async withdrawalsForMatching() {
    return delay([]);
  }
  async dataAsOfDate() {
    return delay('2026-09-15');
  }
  close(): void {
    // Synchronous by design (see source.ts) - nothing to release for this fake.
  }
}

describe('MoneyManagerSource substitutability (Phase 4B) - a genuinely async, non-SnapshotReader source', () => {
  it('runs the full rule engine end to end against a fake async source and produces the expected findings', async () => {
    const fakeSource = new FakeAsyncMoneyManagerSource();
    const officeRecordsConfig: OfficeRecordsConfigResult = { configured: false, missing: ['Zone A'] };

    const start = Date.now();
    const ruleResults = await runAllRules({ reader: fakeSource, officeRecordsConfig });
    const elapsedMs = Date.now() - start;

    // Sanity: this genuinely took real wall-clock time (each of the ~20
    // distinct source calls across the 11 rules awaited a real timer) -
    // proves the engine actually suspended on these awaits rather than the
    // fake being bypassed or the calls being skipped entirely.
    assert.ok(elapsedMs >= REAL_DELAY_MS, `expected at least one real await to have occurred (took ${elapsedMs}ms)`);

    const errors = ruleResults.filter((r) => r.error !== null);
    assert.deepStrictEqual(errors, [], 'no rule should throw against a well-formed fake source');

    const findings = ruleResults.flatMap((r) => r.findings);

    // BALANCE_MISMATCH: currentBalanceMinor (999) vs latest ledger balance (500).
    const balanceMismatch = findings.find((f) => f.findingType === 'BALANCE_MISMATCH');
    assert.ok(balanceMismatch, 'expected a BALANCE_MISMATCH finding from the fake source data');
    assert.strictEqual(balanceMismatch.expectedValue, 500);
    assert.strictEqual(balanceMismatch.actualValue, 999);

    // ORPHANED_CUSTOMER_LEDGER_ENTRY from missingTransactions.ts.
    const orphan = findings.find((f) => f.findingType === 'ORPHANED_CUSTOMER_LEDGER_ENTRY');
    assert.ok(orphan, 'expected an ORPHANED_CUSTOMER_LEDGER_ENTRY finding from the fake source data');
    assert.strictEqual(orphan.entityId, '42');

    // Not configured Office Records still produces its always-emit finding.
    const notConfigured = findings.find((f) => f.findingType === 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_NOT_CONFIGURED');
    assert.ok(notConfigured);

    // Feed straight into Phase 4A classification (unchanged decision logic)
    // to prove the whole source -> rules -> classification pipeline works
    // against this fake, not just the rule-execution step in isolation.
    const classified = classifyFindings(findings, {
      moneyManagerDataAsOf: await fakeSource.dataAsOfDate(),
      officeRecordsConfigured: false,
      officeRecordsReportingPeriod: null,
    });
    const classifiedBalanceMismatch = classified.find((f) => f.findingType === 'BALANCE_MISMATCH');
    assert.strictEqual(classifiedBalanceMismatch?.classification, 'CONFIRMED_DISCREPANCY');
    const classifiedNotConfigured = classified.find((f) => f.findingType === 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_NOT_CONFIGURED');
    assert.strictEqual(classifiedNotConfigured?.classification, 'SOURCE_UNAVAILABLE');
  });

  it('is deterministic against the fake source too: running twice produces identical findings', async () => {
    const run1 = (await runAllRules({ reader: new FakeAsyncMoneyManagerSource() })).flatMap((r) => r.findings);
    const run2 = (await runAllRules({ reader: new FakeAsyncMoneyManagerSource() })).flatMap((r) => r.findings);
    assert.deepStrictEqual(run2, run1);
  });
});
