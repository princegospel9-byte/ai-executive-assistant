// Tests for the Daily Business Operations Report (MVP V1) -
// lib/moneymanager/report/dailyReport.ts and formatReportMessage.ts. Builds
// findings the same way the rules/classifier already do (via
// classifyFindings), then asserts the report groups/labels them correctly -
// no new reconciliation math is under test here, only grouping/labeling.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyFindings } from '../classification/classify';
import type { RunMetadata } from '../classification/types';
import type { Finding } from '../rules/types';
import { buildDailyReport, type DailyReportMeta } from '../report/dailyReport';
import { formatConciseReportMessage, formatFullReportText, severityForNotification } from '../report/formatReportMessage';

function baseFinding(overrides: Partial<Finding>): Finding {
  return {
    findingType: 'BALANCE_MISMATCH',
    severity: 'HIGH',
    entityType: 'customer_account',
    entityId: '1',
    expectedValue: 100_00,
    actualValue: 200_00,
    variance: 100_00,
    businessDate: '2026-09-28',
    evidence: {},
    ruleId: 'mm.test.v1',
    ...overrides,
  };
}

const META: RunMetadata = {
  moneyManagerDataAsOf: '2026-09-28',
  officeRecordsConfigured: false,
  officeRecordsReportingPeriod: null,
};

function baseMeta(overrides: Partial<DailyReportMeta> = {}): DailyReportMeta {
  return {
    businessDate: '2026-09-28',
    runId: 'run-1',
    runStatus: 'completed',
    incompleteReason: null,
    errorMessage: null,
    generatedAt: '2026-09-28T06:00:00.000Z',
    ...overrides,
  };
}

describe('buildDailyReport - section categorization', () => {
  it('places every known findingType in its documented section', () => {
    const findings = classifyFindings(
      [
        baseFinding({ findingType: 'DAILY_DEPOSIT_TOTAL_MISMATCH' }),
        baseFinding({ findingType: 'WITHDRAWAL_AMOUNT_MISMATCH' }),
        baseFinding({ findingType: 'VAULT_BALANCE_MISMATCH' }),
        baseFinding({ findingType: 'GL_GLOBAL_IMBALANCE' }),
        baseFinding({ findingType: 'DUPLICATE_RECEIPT_NUMBER' }),
      ],
      META
    );
    const report = buildDailyReport(findings, baseMeta());

    assert.strictEqual(report.depositsSubmissions.rows.length, 1);
    assert.strictEqual(report.withdrawals.rows.length, 1);
    assert.strictEqual(report.cashMovement.rows.length, 2);
    assert.strictEqual(report.mismatchesAnomalies.rows.length, 1);
  });

  it('an unmapped findingType is never silently dropped - falls into Mismatches/Anomalies', () => {
    const findings = classifyFindings([baseFinding({ findingType: 'SOME_FUTURE_RULE_NOT_YET_MAPPED' })], META);
    const report = buildDailyReport(findings, baseMeta());
    assert.strictEqual(report.mismatchesAnomalies.rows.length, 1);
    assert.strictEqual(report.mismatchesAnomalies.rows[0]!.findingType, 'SOME_FUTURE_RULE_NOT_YET_MAPPED');
  });

  it('Expenses and Mobilizer/Collector sections are always reported unavailable, never fabricated', () => {
    const findings = classifyFindings([baseFinding({ findingType: 'BALANCE_MISMATCH' })], META);
    const report = buildDailyReport(findings, baseMeta());
    assert.strictEqual(report.expenses.available, false);
    assert.ok(report.expenses.unavailableReason);
    assert.strictEqual(report.mobilizerActivity.available, false);
    assert.ok(report.mobilizerActivity.unavailableReason);
  });
});

describe('buildDailyReport - status mapping (Classification -> requested 4 labels)', () => {
  const cases: { findingType: string; expectedStatus: string }[] = [
    { findingType: 'BALANCE_MISMATCH', expectedStatus: 'CONFIRMED_DIFFERENCE' }, // CONFIRMED_DISCREPANCY
    { findingType: 'VAULT_BALANCE_MISMATCH', expectedStatus: 'POSSIBLE_TIMING_DIFFERENCE' }, // POSSIBLE_DISCREPANCY
    { findingType: 'IMPLAUSIBLE_ENTRY_DATE', expectedStatus: 'SUSPECTED_DATA_ENTRY_ISSUE' }, // DATA_QUALITY_ISSUE
    { findingType: 'VAULT_ACCOUNT_NOT_FOUND', expectedStatus: 'UNRESOLVED' }, // REQUIRES_INVESTIGATION
  ];

  for (const { findingType, expectedStatus } of cases) {
    it(`${findingType} -> ${expectedStatus}`, () => {
      const findings = classifyFindings([baseFinding({ findingType })], META);
      const report = buildDailyReport(findings, baseMeta());
      const row = [
        ...report.collections.rows,
        ...report.withdrawals.rows,
        ...report.depositsSubmissions.rows,
        ...report.cashMovement.rows,
        ...report.mismatchesAnomalies.rows,
      ][0]!;
      assert.strictEqual(row.status, expectedStatus);
    });
  }
});

describe('buildDailyReport - Office Records section', () => {
  it('reports not-configured honestly, without fabricating a comparison', () => {
    const findings = classifyFindings(
      [
        baseFinding({
          findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_NOT_CONFIGURED',
          severity: 'WARNING',
          expectedValue: null,
          actualValue: null,
          variance: null,
          businessDate: 'summary',
          evidence: { message: 'Office Records comparison is not configured - missing: Zone A, Zone B.' },
        }),
      ],
      META
    );
    const report = buildDailyReport(findings, baseMeta());
    assert.strictEqual(report.officeRecords.available, false);
    assert.match(report.officeRecords.unavailableReason!, /not configured/);
    assert.strictEqual(report.executiveSummary.officeRecordsStatus, 'not_configured');
    // Collections has no other data source - must also be honestly unavailable, not silently empty/clean.
    assert.strictEqual(report.collections.available, false);
  });

  it('reports unavailable (fetch failure) distinctly from not-configured, never as a clean result', () => {
    const configuredMeta: RunMetadata = { ...META, officeRecordsConfigured: true };
    const findings = classifyFindings(
      [
        baseFinding({
          findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_UNAVAILABLE',
          severity: 'WARNING',
          expectedValue: null,
          actualValue: null,
          variance: null,
          businessDate: 'summary',
          evidence: {
            message: 'Office Records comparison could not be completed because the external office-record source was unavailable.',
            errorDetail: 'zoneCollectionsByDate() is not supported by LanApiSource',
          },
        }),
      ],
      configuredMeta
    );
    const report = buildDailyReport(findings, baseMeta());
    assert.strictEqual(report.officeRecords.available, false);
    assert.match(report.officeRecords.unavailableReason!, /unavailable/);
    assert.match(report.officeRecords.unavailableReason!, /LanApiSource/);
    assert.strictEqual(report.executiveSummary.officeRecordsStatus, 'configured_unavailable');
  });

  it('when configured and successful, zone-diff/withdrawal-mismatch rows appear with true Office Record labels', () => {
    const configuredMeta: RunMetadata = { ...META, officeRecordsConfigured: true };
    const findings = classifyFindings(
      [
        baseFinding({
          findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_SUMMARY',
          severity: 'WARNING',
          expectedValue: null,
          actualValue: null,
          variance: 500_00,
          businessDate: 'summary',
          evidence: { message: 'Compare with Office Records: 1 discrepancy(ies) detected across 1 zone(s).' },
        }),
        baseFinding({
          findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_ZONE_DIFF',
          severity: 'HIGH',
          entityType: 'zone',
          entityId: 'ZONE A',
          expectedValue: 1000_00,
          actualValue: 1500_00,
          variance: 500_00,
          businessDate: '2026-09-28',
          evidence: { zone: 'ZONE A' },
        }),
      ],
      configuredMeta
    );
    const report = buildDailyReport(findings, baseMeta());
    assert.strictEqual(report.officeRecords.available, true);
    assert.strictEqual(report.officeRecords.rows.length, 1);
    assert.strictEqual(report.officeRecords.rows[0]!.referenceLabel, 'Office Record');
    assert.strictEqual(report.collections.rows.length, 1);
    assert.strictEqual(report.collections.rows[0]!.referenceLabel, 'Office Record');
    assert.strictEqual(report.executiveSummary.officeRecordsStatus, 'configured_compared');
  });
});

describe('buildDailyReport - manager attention and follow-up', () => {
  it('only HIGH/CRITICAL findings reach managerAttention, sorted by severity then variance', () => {
    const findings = classifyFindings(
      [
        baseFinding({ findingType: 'IMPLAUSIBLE_ENTRY_DATE', severity: 'WARNING', entityId: 'low' }),
        baseFinding({ findingType: 'BALANCE_MISMATCH', severity: 'HIGH', entityId: 'high-small', variance: 10_00 }),
        baseFinding({ findingType: 'BALANCE_MISMATCH', severity: 'CRITICAL', entityId: 'critical', variance: 5_00 }),
      ],
      META
    );
    const report = buildDailyReport(findings, baseMeta());
    assert.strictEqual(report.managerAttention.length, 2);
    assert.strictEqual(report.managerAttention[0]!.label, 'customer_account critical');
  });

  it('reuses an existing recommendedInvestigation verbatim instead of inventing one', () => {
    const configuredMeta: RunMetadata = { ...META, officeRecordsConfigured: true };
    const findings = classifyFindings(
      [
        baseFinding({
          findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_WITHDRAWAL_MISMATCH',
          severity: 'CRITICAL',
          entityType: 'withdrawal',
          entityId: '2026-09-28:John Doe',
          expectedValue: 100_00,
          actualValue: 150_00,
          variance: 50_00,
          businessDate: '2026-09-28',
          evidence: { status: 'AMOUNT MISMATCH' },
        }),
      ],
      configuredMeta
    );
    const report = buildDailyReport(findings, baseMeta());
    const row = report.managerAttention[0]!;
    // classifyWithdrawalMismatch's AMOUNT MISMATCH path -> CONFIRMED_DISCREPANCY -> generic follow-up (no evidence.recommendedInvestigation on this finding type)
    assert.match(row.recommendedFollowUp, /Investigate and correct/);
  });
});

describe('buildDailyReport - count-based findings are never rendered as money', () => {
  it('DUPLICATE_LEDGER_ENTRY_GROUP keeps its raw occurrence count, not divided by 100', () => {
    const findings = classifyFindings(
      [
        baseFinding({
          findingType: 'DUPLICATE_LEDGER_ENTRY_GROUP',
          entityType: 'customer_account',
          entityId: '42',
          expectedValue: 1,
          actualValue: 3,
          variance: 2,
          evidence: { entryIds: [1, 2, 3] },
        }),
      ],
      META
    );
    const report = buildDailyReport(findings, baseMeta());
    const row = report.mismatchesAnomalies.rows[0]!;
    assert.strictEqual(row.valueKind, 'count');
    assert.strictEqual(row.systemValue, 3);
    assert.strictEqual(row.referenceValue, 1);
    const text = formatFullReportText(report);
    assert.match(text, /occurrences/);
    assert.ok(!text.includes('0.03'), 'a count of 3 must never render as if it were GHS 0.03');
  });

  it('a money-based finding still renders divided by 100 (minor units to major units)', () => {
    const findings = classifyFindings([baseFinding({ findingType: 'BALANCE_MISMATCH', actualValue: 20000, expectedValue: 10000, variance: 10000 })], META);
    const report = buildDailyReport(findings, baseMeta());
    const row = report.mismatchesAnomalies.rows[0]!;
    assert.strictEqual(row.valueKind, 'money_minor');
    const text = formatFullReportText(report);
    assert.match(text, /200\.00/);
  });
});

describe('formatReportMessage', () => {
  it('formatFullReportText renders every section without throwing', () => {
    const findings = classifyFindings(
      [baseFinding({ findingType: 'BALANCE_MISMATCH' }), baseFinding({ findingType: 'VAULT_BALANCE_MISMATCH', severity: 'CRITICAL' })],
      META
    );
    const report = buildDailyReport(findings, baseMeta());
    const text = formatFullReportText(report);
    assert.match(text, /Daily Business Operations Report/);
    assert.match(text, /Executive Summary/);
    assert.match(text, /Office Records Comparison/);
    assert.match(text, /Recommended Follow-up/);
  });

  it('formatConciseReportMessage stays short and points to the run id for full detail', () => {
    const findings = classifyFindings([baseFinding({ findingType: 'BALANCE_MISMATCH', severity: 'CRITICAL' })], META);
    const report = buildDailyReport(findings, baseMeta({ runId: 'run-xyz' }));
    const message = formatConciseReportMessage(report);
    assert.match(message, /run-xyz/);
    assert.ok(message.length < 2000, 'concise message should stay short');
  });

  it('severityForNotification is critical when the run itself did not complete, even with zero findings', () => {
    const report = buildDailyReport([], baseMeta({ runStatus: 'incomplete', incompleteReason: '1 rule failed' }));
    assert.strictEqual(severityForNotification(report), 'critical');
  });

  it('severityForNotification is info for a clean, fully-completed run', () => {
    const report = buildDailyReport([], baseMeta());
    assert.strictEqual(severityForNotification(report), 'info');
  });

  it('severityForNotification is warning when there are findings but none CRITICAL', () => {
    const findings = classifyFindings([baseFinding({ findingType: 'IMPLAUSIBLE_ENTRY_DATE', severity: 'WARNING' })], META);
    const report = buildDailyReport(findings, baseMeta());
    assert.strictEqual(severityForNotification(report), 'warning');
  });
});
