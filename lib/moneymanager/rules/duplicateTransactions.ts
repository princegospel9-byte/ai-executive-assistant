// Two independent duplicate signals against customer_ledger_entries:
//  1. Same account/date/amount/details posted more than once (a collector
//     entering the same collection twice).
//  2. Same receipt_no reused across more than one entry (receipts should be
//     one-to-one with a physical/printed receipt).
import type { Finding, Rule } from './types';

export const duplicateTransactionsRule: Rule = {
  ruleId: 'mm.duplicate_transactions.v1',
  description: 'Detects repeated customer ledger postings and reused receipt numbers.',
  run: ({ reader }) => {
    const findings: Finding[] = [];

    for (const group of reader.duplicateCustomerLedgerGroups()) {
      findings.push({
        findingType: 'DUPLICATE_LEDGER_ENTRY_GROUP',
        severity: group.count > 2 ? 'CRITICAL' : 'HIGH',
        entityType: 'customer_account',
        entityId: String(group.customerAccountId),
        expectedValue: 1,
        actualValue: group.count,
        variance: group.count - 1,
        businessDate: group.entryDate.slice(0, 10),
        evidence: {
          drMinor: group.drMinor,
          crMinor: group.crMinor,
          details: group.details,
          entryIds: group.entryIds,
        },
        ruleId: 'mm.duplicate_transactions.v1',
      });
    }

    for (const dup of reader.duplicateReceiptNumbers()) {
      findings.push({
        findingType: 'DUPLICATE_RECEIPT_NUMBER',
        severity: 'HIGH',
        entityType: 'receipt',
        entityId: dup.receiptNo,
        expectedValue: 1,
        actualValue: dup.count,
        variance: dup.count - 1,
        businessDate: 'unknown',
        evidence: { entryIds: dup.entryIds },
        ruleId: 'mm.duplicate_transactions.v1',
      });
    }

    return findings;
  },
};
