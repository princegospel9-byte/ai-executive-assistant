// withdrawal_records is a narrow, purpose-built audit table (52 rows in the
// reference snapshot) pairing each withdrawal with its backing ledger entry
// and, when available, a physical passbook figure. Three checks:
//  1. amount_minor must equal the backing ledger entry's dr_minor (a
//     withdrawal debits the customer's ledger).
//  2. balance_after_minor must equal the backing ledger entry's balance_minor.
//  3. passbook_difference_minor must actually equal passbook - after
//     balance (MoneyManager already computed this once; recomputing catches
//     a stored value that has drifted from its own inputs), and a nonzero
//     stored difference is itself surfaced as a WARNING physical-record
//     mismatch worth staff attention.
import type { Finding, Rule } from './types';

export const withdrawalConsistencyRule: Rule = {
  ruleId: 'mm.withdrawal_consistency.v1',
  description: 'withdrawal_records amounts/balances vs their backing ledger entry and passbook figure.',
  run: ({ reader }) => {
    const findings: Finding[] = [];

    for (const { record, ledgerEntry } of reader.withdrawalRecordsWithLedgerEntry()) {
      if (!ledgerEntry) {
        // Already reported as ORPHANED_WITHDRAWAL_RECORD by
        // mm.missing_transactions.v1 - skip to avoid a duplicate finding
        // for the same underlying problem.
        continue;
      }

      const businessDate = record.recordedAt.slice(0, 10);

      if (record.amountMinor !== ledgerEntry.drMinor) {
        findings.push({
          findingType: 'WITHDRAWAL_AMOUNT_MISMATCH',
          severity: 'HIGH',
          entityType: 'withdrawal_record',
          entityId: String(record.customerLedgerEntryId),
          expectedValue: ledgerEntry.drMinor,
          actualValue: record.amountMinor,
          variance: record.amountMinor - ledgerEntry.drMinor,
          businessDate,
          evidence: { customerAccountId: record.customerAccountId },
          ruleId: 'mm.withdrawal_consistency.v1',
        });
      }

      if (record.balanceAfterMinor !== ledgerEntry.balanceMinor) {
        findings.push({
          findingType: 'WITHDRAWAL_BALANCE_AFTER_MISMATCH',
          severity: 'HIGH',
          entityType: 'withdrawal_record',
          entityId: String(record.customerLedgerEntryId),
          expectedValue: ledgerEntry.balanceMinor,
          actualValue: record.balanceAfterMinor,
          variance: record.balanceAfterMinor - ledgerEntry.balanceMinor,
          businessDate,
          evidence: { customerAccountId: record.customerAccountId },
          ruleId: 'mm.withdrawal_consistency.v1',
        });
      }

      if (record.passbookBalanceMinor !== null && record.passbookDifferenceMinor !== null) {
        const recomputedDiff = record.passbookBalanceMinor - record.balanceAfterMinor;
        if (recomputedDiff !== record.passbookDifferenceMinor) {
          findings.push({
            findingType: 'WITHDRAWAL_PASSBOOK_DIFFERENCE_RECOMPUTE_MISMATCH',
            severity: 'WARNING',
            entityType: 'withdrawal_record',
            entityId: String(record.customerLedgerEntryId),
            expectedValue: recomputedDiff,
            actualValue: record.passbookDifferenceMinor,
            variance: record.passbookDifferenceMinor - recomputedDiff,
            businessDate,
            evidence: { customerAccountId: record.customerAccountId },
            ruleId: 'mm.withdrawal_consistency.v1',
          });
        }

        if (record.passbookDifferenceMinor !== 0) {
          findings.push({
            findingType: 'WITHDRAWAL_PASSBOOK_MISMATCH',
            severity: 'WARNING',
            entityType: 'withdrawal_record',
            entityId: String(record.customerLedgerEntryId),
            expectedValue: record.passbookBalanceMinor,
            actualValue: record.balanceAfterMinor,
            variance: record.passbookDifferenceMinor,
            businessDate,
            evidence: {
              customerAccountId: record.customerAccountId,
              note: 'MoneyManager itself recorded a nonzero physical passbook difference at withdrawal time.',
            },
            ruleId: 'mm.withdrawal_consistency.v1',
          });
        }
      }
    }

    return findings;
  },
};
