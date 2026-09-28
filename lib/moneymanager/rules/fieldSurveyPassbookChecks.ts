// Field survey + passbook-check monitoring. NOTE: this rule was originally
// named/branded "Compare with Office Records" (findingType
// SAVINGS_COMPARE_WITH_OFFICE_RECORDS_*) based on an earlier investigation
// of mm-server-actual, which does not contain the real feature at all - the
// real "Compare with Office Records" (Google Sheets vs local ledger) lives
// in moneymanager-standalone-src and is implemented separately in
// lib/moneymanager/rules/officeRecordsComparison.ts. field_survey_checks/
// passbook_checks are real, legitimate MoneyManager data in their own
// right (a genuine field-verification signal, 150 real MISMATCH rows in
// the reference snapshot) - renamed and re-scoped here under honest
// findingTypes rather than deleted, since the underlying monitoring value
// doesn't depend on which name it was filed under. Unlike
// officeRecordsComparison.ts, this rule follows the SAME "silent when
// clean" convention as the other 8 non-office-records rules - the
// always-emit-a-summary requirement was specific to the real "Compare with
// Office Records" product ask, not to this data.
//
// field_survey_checks: a systematic, portfolio-wide survey. Per
// mm-server-actual/src/data/field-survey-checks.repository.ts:
//   differenceMinor = systemBalanceMinor - passbookBalanceMinor
//   status = differenceMinor === 0 ? 'MATCHED' : 'MISMATCH'
// errorAmountMinor there is deliberately one-directional (only nonzero when
// the system shows MORE than the passbook) - this rule scores large OVER
// mismatches CRITICAL and everything else HIGH for the same reason.
//
// passbook_checks: a withdrawal-time spot check with its own resolution
// workflow (mm-server-actual/src/business/passbook-checks/). Only 'OPEN'
// (unresolved) mismatches are actionable.
import type { Finding, Rule } from './types';

const CRITICAL_OVERAGE_THRESHOLD_MINOR = 500_00; // GHS 500

export const fieldSurveyPassbookChecksRule: Rule = {
  ruleId: 'mm.field_survey_passbook_checks.v1',
  description:
    'field_survey_checks (systematic survey) and open passbook_checks (withdrawal-time spot checks) - ' +
    "passbook (field-verified) balance vs system balance. NOT MoneyManager's real 'Compare with Office " +
    "Records' feature - see officeRecordsComparison.ts for that.",
  run: async ({ reader }) => {
    const findings: Finding[] = [];

    for (const check of await reader.fieldSurveyChecks()) {
      if (check.status !== 'MISMATCH') continue;

      const isOverage = check.differenceMinor > 0; // system claims MORE than the passbook
      findings.push({
        findingType: 'FIELD_SURVEY_MISMATCH',
        severity:
          isOverage && Math.abs(check.differenceMinor) >= CRITICAL_OVERAGE_THRESHOLD_MINOR ? 'CRITICAL' : 'HIGH',
        entityType: 'customer_account',
        entityId: String(check.customerAccountId),
        expectedValue: check.passbookBalanceMinor,
        actualValue: check.systemBalanceMinor,
        variance: check.differenceMinor,
        businessDate: check.surveyedAt.slice(0, 10),
        evidence: {
          fieldSurveyCheckId: check.id,
          workerId: check.workerId,
          direction: isOverage ? 'OVER' : 'UNDER',
          note: isOverage
            ? "System balance exceeds the field-verified passbook balance - MoneyManager's own schema treats this direction as the one worth a dedicated error amount."
            : 'Field-verified passbook balance exceeds the system balance.',
        },
        ruleId: 'mm.field_survey_passbook_checks.v1',
      });
    }

    for (const check of await reader.passbookChecks()) {
      if (check.status !== 'OPEN' || check.differenceMinor === 0) continue;

      findings.push({
        findingType: 'PASSBOOK_CHECK_OPEN',
        severity: 'HIGH',
        entityType: 'customer_account',
        entityId: String(check.customerAccountId),
        expectedValue: check.passbookBalanceMinor,
        actualValue: check.systemBalanceMinor,
        variance: check.differenceMinor,
        businessDate: check.checkedAt.slice(0, 10),
        evidence: {
          passbookCheckId: check.id,
          direction: check.differenceMinor > 0 ? 'OVER' : 'UNDER',
          note: 'Unresolved withdrawal-time passbook spot check - staff have not yet resolved this mismatch.',
        },
        ruleId: 'mm.field_survey_passbook_checks.v1',
      });
    }

    return findings;
  },
};
