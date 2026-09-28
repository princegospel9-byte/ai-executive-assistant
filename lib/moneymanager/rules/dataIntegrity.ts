// Basic data-integrity sweep: malformed dates and zero-amount postings.
// entry_date is stored as free-form text in the snapshot (not a strict
// sqlite DATE type), so a corrupted value like "0202-03-06" - which the
// reference snapshot genuinely contains - parses as a Date object without
// throwing, so it has to be caught by range-checking instead.
import { isImplausibleDate } from '../shared/dates';
import type { Finding, Rule } from './types';

export const dataIntegrityRule: Rule = {
  ruleId: 'mm.data_integrity.v1',
  description: 'Implausible entry dates and zero-amount ledger postings.',
  run: ({ reader }) => {
    const findings: Finding[] = [];

    for (const row of reader.allEntryDates()) {
      if (isImplausibleDate(row.entryDate)) {
        findings.push({
          findingType: 'IMPLAUSIBLE_ENTRY_DATE',
          severity: 'WARNING',
          entityType: row.table,
          entityId: String(row.id),
          expectedValue: null,
          actualValue: null,
          variance: null,
          businessDate: 'unknown',
          evidence: { rawEntryDate: row.entryDate },
          ruleId: 'mm.data_integrity.v1',
        });
      }
    }

    for (const row of reader.zeroAmountEntries()) {
      findings.push({
        findingType: 'ZERO_AMOUNT_LEDGER_ENTRY',
        severity: 'INFO',
        entityType: 'customer_ledger_entry',
        entityId: String(row.id),
        expectedValue: null,
        actualValue: 0,
        variance: null,
        businessDate: isImplausibleDate(row.entryDate) ? 'unknown' : row.entryDate.slice(0, 10),
        evidence: { customerAccountId: row.customerAccountId },
        ruleId: 'mm.data_integrity.v1',
      });
    }

    return findings;
  },
};
