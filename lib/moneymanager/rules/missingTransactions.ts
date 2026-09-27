// "Missing/orphaned transaction" = a row that references another row which
// doesn't exist. Genuinely missing transactions (a collection that was
// never recorded at all) can't be detected from a single snapshot with no
// external source of truth to compare against - that's a Phase 4 concern
// (comparing consecutive snapshots or a live read). What we CAN detect here
// is broken referential integrity within the snapshot itself.
import type { Finding, Rule } from './types';

export const missingTransactionsRule: Rule = {
  ruleId: 'mm.missing_transactions.v1',
  description:
    'Orphaned foreign keys: customer_ledger_entries/ledger_entries/withdrawal_records pointing at rows that no longer exist.',
  run: ({ reader }) => {
    const findings: Finding[] = [];

    for (const orphan of reader.orphanedCustomerLedgerEntries()) {
      findings.push({
        findingType: 'ORPHANED_CUSTOMER_LEDGER_ENTRY',
        severity: 'CRITICAL',
        entityType: 'customer_ledger_entry',
        entityId: String(orphan.id),
        expectedValue: null,
        actualValue: null,
        variance: null,
        businessDate: orphan.entryDate.slice(0, 10),
        evidence: { missingCustomerAccountId: orphan.customerAccountId },
        ruleId: 'mm.missing_transactions.v1',
      });
    }

    for (const orphan of reader.orphanedLedgerEntries()) {
      findings.push({
        findingType: 'ORPHANED_GL_LEDGER_ENTRY',
        severity: 'CRITICAL',
        entityType: 'ledger_entry',
        entityId: String(orphan.id),
        expectedValue: null,
        actualValue: null,
        variance: null,
        businessDate: orphan.entryDate.slice(0, 10),
        evidence: { missingGlAccountId: orphan.glAccountId },
        ruleId: 'mm.missing_transactions.v1',
      });
    }

    for (const orphan of reader.orphanedWithdrawalRecords()) {
      findings.push({
        findingType: 'ORPHANED_WITHDRAWAL_RECORD',
        severity: 'CRITICAL',
        entityType: 'withdrawal_record',
        entityId: String(orphan.customerLedgerEntryId),
        expectedValue: null,
        actualValue: null,
        variance: null,
        businessDate: 'unknown',
        evidence: { customerAccountId: orphan.customerAccountId },
        ruleId: 'mm.missing_transactions.v1',
      });
    }

    return findings;
  },
};
