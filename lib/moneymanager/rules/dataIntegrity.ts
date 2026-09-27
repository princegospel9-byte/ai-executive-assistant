// Basic data-integrity sweep: malformed dates and zero-amount postings.
// entry_date is stored as free-form text in the snapshot (not a strict
// sqlite DATE type), so a corrupted value like "0202-03-06" - which the
// reference snapshot genuinely contains - parses as a Date object without
// throwing, so it has to be caught by range-checking instead.
import type { Finding, Rule } from './types';

const MIN_PLAUSIBLE_YEAR = 2000;
const MAX_PLAUSIBLE_YEAR = 2100;

function isImplausibleDate(raw: string): boolean {
  const yearMatch = /^(\d{1,4})-/.exec(raw);
  if (!yearMatch) return true;
  const year = Number(yearMatch[1]);
  if (!Number.isFinite(year)) return true;
  if (year < MIN_PLAUSIBLE_YEAR || year > MAX_PLAUSIBLE_YEAR) return true;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime());
}

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
