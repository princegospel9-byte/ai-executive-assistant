// MoneyManager's REAL "Compare with Office Records" feature, ported from
// moneymanager-standalone-src/src/business/reports/compare-office-records.ts
// (~500 lines, treated as the authoritative spec here - not mm-server-actual,
// which predates this feature entirely and does not contain it). An earlier
// investigation of this codebase mistook field_survey_checks/passbook_checks
// for this feature - that was wrong and has been corrected; those tables now
// back the separately-named lib/moneymanager/rules/fieldSurveyPassbookChecks.ts
// instead, honestly relabeled, not deleted.
//
// What the real feature actually compares:
//   - Five zone Google Sheets ("cash received in hand" totals, one per
//     zone) vs MoneyManager's own zone-and-day deposit+card-sale totals
//     (reader.zoneCollectionsByDate).
//   - A Master Workbook's "CASH OUT" sheet (per-withdrawal NAME/AMNT/
//     COMMISSON rows) vs MoneyManager's own withdrawal records
//     (reader.withdrawalsForMatching), using the reference file's exact
//     multi-strategy name+amount matcher (lib/moneymanager/office-records/
//     parse.ts's matchWithdrawalsForDate).
//
// DELIBERATELY NOT IMPLEMENTED IN THIS PHASE: the reference file's third
// facet, "closing balance structure" / day verdicts (opening/deposit/
// withdraw/expense/cashReceived/closing reconciliation per day). That
// requires faithfully porting MoneyManager's full Cash Book opening-balance
// algorithm (cash-book.ts): a 3-tier fallback (period-closing anchor ->
// live Vault balance worked backward -> full-history sum) plus every
// non-customer-ledger Vault posting (salary, vouchers, bank transfers,
// journal corrections). Porting that with real fidelity - rather than a
// number that LOOKS like a closing balance but isn't provably the same
// algorithm - was judged out of scope for this phase; building a
// plausible-looking but unverified closing-balance check would violate
// this project's core "never fabricate a result" rule as much as
// inventing a URL would. Documented as a named Phase 4 gap in
// documentation/moneymanager-monitoring.md, not silently skipped.
//
// UNLIKE every rule except fieldSurveyPassbookChecks.ts's sibling
// office-records ancestor, this rule is:
//  1. ASYNC - it makes real network calls (Google Sheets CSV/XLSX export
//     endpoints only, for a URL a human configured - never MoneyManager,
//     desktop or web).
//  2. NOT deterministic in the usual sense - a Google Sheet can change
//     between runs. Same discipline still applies to everything it computes
//     from data already in hand (the matching/diffing logic itself is pure).
//  3. Always emits a summary finding, clean or not (real product
//     requirement) - see SAVINGS_COMPARE_WITH_OFFICE_RECORDS_SUMMARY below.
//
// "New vs recurring": same answer as documented previously - not
// implemented inside the rule (RuleContext has no run history), already
// answerable after persistence via mm_findings.first_seen_run_id vs
// last_seen_run_id.
import { runOfficeRecordsComparison } from '../office-records/compare';
import { OfficeRecordsFetchError } from '../office-records/fetch';
import { OfficeRecordsColumnError } from '../office-records/parse';
import type { Finding, Rule } from './types';

const RULE_ID = 'mm.office_records_comparison.v1';
const ZONE_DIFF_CRITICAL_THRESHOLD_MINOR = 500_00; // GHS 500

function defaultDateRange(): { dateFrom: string; dateTo: string } {
  // Last 7 complete days, today excluded (today's entries may still be
  // arriving). Real wall-clock use is fine here - this rule is already the
  // one documented non-deterministic exception in this engine.
  const today = new Date();
  const dateTo = new Date(today);
  dateTo.setUTCDate(dateTo.getUTCDate() - 1);
  const dateFrom = new Date(dateTo);
  dateFrom.setUTCDate(dateFrom.getUTCDate() - 6);
  return { dateFrom: dateFrom.toISOString().slice(0, 10), dateTo: dateTo.toISOString().slice(0, 10) };
}

export const officeRecordsComparisonRule: Rule = {
  ruleId: RULE_ID,
  description:
    "MoneyManager's real Compare with Office Records: Google Sheets zone totals + Master Workbook CASH OUT " +
    'vs local zone collections + withdrawals. Always emits a summary finding, clean or not.',
  run: async (ctx) => {
    const { officeRecordsConfig, reader } = ctx;
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const { dateFrom, dateTo } = ctx.officeRecordsDateRange ?? defaultDateRange();

    if (!officeRecordsConfig || !officeRecordsConfig.configured) {
      const missing = officeRecordsConfig?.missing ?? [
        'Zone A',
        'Zone B',
        'Zone C',
        'Zone D',
        'Zone E',
        'Master Workbook',
      ];
      return [
        {
          findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_NOT_CONFIGURED',
          severity: 'WARNING',
          entityType: 'savings_portfolio',
          entityId: 'all',
          expectedValue: null,
          actualValue: null,
          variance: null,
          businessDate: 'summary',
          evidence: {
            missingUrls: missing,
            message: `Office Records comparison is not configured - missing: ${missing.join(', ')}. Set the Google Sheets links in Office Records config first.`,
            reportingPeriod: { dateFrom, dateTo },
          },
          ruleId: RULE_ID,
        },
      ];
    }

    let result;
    try {
      result = await runOfficeRecordsComparison(
        reader,
        officeRecordsConfig.urls,
        dateFrom,
        dateTo,
        fetchImpl,
        ctx.officeRecordsRetryDelaysMs
      );
    } catch (err) {
      const isKnownFetchOrColumnIssue = err instanceof OfficeRecordsFetchError || err instanceof OfficeRecordsColumnError;
      return [
        {
          findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_UNAVAILABLE',
          severity: 'WARNING',
          entityType: 'savings_portfolio',
          entityId: 'all',
          expectedValue: null,
          actualValue: null,
          variance: null,
          businessDate: 'summary',
          evidence: {
            message:
              'Office Records comparison could not be completed because the external office-record source was unavailable.',
            errorDetail: (err as Error).message,
            errorKind: isKnownFetchOrColumnIssue ? (err as Error).constructor.name : 'Unknown',
            reportingPeriod: { dateFrom, dateTo },
          },
          ruleId: RULE_ID,
        },
      ];
    }

    const findings: Finding[] = [];

    for (const row of result.zoneDetail) {
      if (row.officeMinor === null || row.diffMinor === null || row.diffMinor === 0) continue;
      findings.push({
        findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_ZONE_DIFF',
        severity: Math.abs(row.diffMinor) >= ZONE_DIFF_CRITICAL_THRESHOLD_MINOR ? 'CRITICAL' : 'HIGH',
        entityType: 'zone',
        entityId: row.zone,
        expectedValue: row.officeMinor,
        actualValue: row.appMinor,
        variance: row.diffMinor,
        businessDate: row.date,
        evidence: { zone: row.zone },
        ruleId: RULE_ID,
      });
    }

    let unmatchedCount = 0;
    for (const row of result.withdrawalMatching) {
      if (row.status.startsWith('Matches')) continue;
      unmatchedCount++;
      const officeAmountMinor = row.officeAmountMinor;
      const appAmountMinor = row.appAmountMinor;
      findings.push({
        findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_WITHDRAWAL_MISMATCH',
        severity:
          officeAmountMinor !== null &&
          appAmountMinor !== null &&
          Math.abs(officeAmountMinor - appAmountMinor) >= ZONE_DIFF_CRITICAL_THRESHOLD_MINOR
            ? 'CRITICAL'
            : 'HIGH',
        entityType: 'withdrawal',
        entityId: `${row.date}:${row.officeName ?? row.appName ?? 'unknown'}`,
        expectedValue: officeAmountMinor,
        actualValue: appAmountMinor,
        variance: officeAmountMinor !== null && appAmountMinor !== null ? appAmountMinor - officeAmountMinor : null,
        businessDate: row.date,
        evidence: {
          officeName: row.officeName,
          officeCommissionMinor: row.officeCommissionMinor,
          appName: row.appName,
          appCommissionMinor: row.appCommissionMinor,
          status: row.status,
        },
        ruleId: RULE_ID,
      });
    }

    const zoneDiffCount = findings.filter((f) => f.findingType === 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_ZONE_DIFF').length;
    const discrepancyCount = findings.length;
    const varianceTotalMinor = findings.reduce((sum, f) => sum + Math.abs(f.variance ?? 0), 0);
    const zonesChecked = new Set(result.zoneDetail.filter((r) => r.officeMinor !== null).map((r) => r.zone)).size;

    findings.push({
      findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_SUMMARY',
      severity: discrepancyCount === 0 ? 'INFO' : 'WARNING',
      entityType: 'savings_portfolio',
      entityId: 'all',
      expectedValue: null,
      actualValue: null,
      variance: varianceTotalMinor,
      businessDate: 'summary',
      evidence: {
        reportingPeriod: { dateFrom, dateTo },
        zonesChecked,
        recordsCompared: result.zoneDetail.length + result.withdrawalMatching.length,
        matching: {
          withdrawalRowsTotal: result.withdrawalMatching.length,
          withdrawalRowsMatched: result.withdrawalMatching.length - unmatchedCount,
          withdrawalRowsUnmatched: unmatchedCount,
        },
        discrepancies: { zoneDiffCount, withdrawalMismatchCount: unmatchedCount, total: discrepancyCount },
        varianceTotalMinor,
        newVsRecurringIssues:
          'Not determinable within this rule (no prior-run history available to a single rule function) - ' +
          'see mm_findings.first_seen_run_id vs last_seen_run_id after persistence instead.',
        recommendedInvestigation:
          discrepancyCount === 0
            ? 'No discrepancies detected for this period.'
            : 'Review SAVINGS_COMPARE_WITH_OFFICE_RECORDS_ZONE_DIFF and _WITHDRAWAL_MISMATCH findings for this period, starting with the largest variance.',
        closingBalanceStructure:
          'Not implemented in this phase - see officeRecordsComparison.ts header comment and documentation/moneymanager-monitoring.md.',
        message:
          discrepancyCount === 0
            ? 'Compare with Office Records: no discrepancies detected.'
            : `Compare with Office Records: ${discrepancyCount} discrepancy(ies) detected across ${zonesChecked} zone(s).`,
      },
      ruleId: RULE_ID,
    });

    return findings;
  },
};
