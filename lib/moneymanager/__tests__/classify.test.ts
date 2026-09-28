// Tests for the Phase 4A deterministic classification layer
// (lib/moneymanager/classification/classify.ts). No AI, no network, no
// randomness - same Finding[] + RunMetadata in, same ClassifiedFinding[]
// out, always.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyFindings } from '../classification/classify';
import { ALL_CLASSIFICATIONS, type RunMetadata } from '../classification/types';
import type { Finding } from '../rules/types';

function baseFinding(overrides: Partial<Finding>): Finding {
  return {
    findingType: 'BALANCE_MISMATCH',
    severity: 'HIGH',
    entityType: 'customer_account',
    entityId: '1',
    expectedValue: 100,
    actualValue: 200,
    variance: 100,
    businessDate: '2026-09-15',
    evidence: {},
    ruleId: 'mm.test.v1',
    ...overrides,
  };
}

const META_WITH_SEPT22_CUTOFF: RunMetadata = {
  moneyManagerDataAsOf: '2026-09-22',
  officeRecordsConfigured: true,
  officeRecordsReportingPeriod: { dateFrom: '2026-09-11', dateTo: '2026-09-27' },
};

function classifyOne(finding: Finding, meta: RunMetadata = META_WITH_SEPT22_CUTOFF) {
  const [result] = classifyFindings([finding], meta);
  return result!;
}

describe('classify.ts - static (rule-level) mapping, one case per findingType', () => {
  const cases: { findingType: string; expected: string }[] = [
    { findingType: 'BALANCE_MISMATCH', expected: 'CONFIRMED_DISCREPANCY' },
    { findingType: 'BALANCE_NO_LEDGER_HISTORY', expected: 'REQUIRES_INVESTIGATION' },
    { findingType: 'DUPLICATE_LEDGER_ENTRY_GROUP', expected: 'CONFIRMED_DISCREPANCY' },
    { findingType: 'DUPLICATE_RECEIPT_NUMBER', expected: 'CONFIRMED_DISCREPANCY' },
    { findingType: 'ORPHANED_CUSTOMER_LEDGER_ENTRY', expected: 'DATA_QUALITY_ISSUE' },
    { findingType: 'ORPHANED_GL_LEDGER_ENTRY', expected: 'DATA_QUALITY_ISSUE' },
    { findingType: 'ORPHANED_WITHDRAWAL_RECORD', expected: 'DATA_QUALITY_ISSUE' },
    { findingType: 'VAULT_ACCOUNT_NOT_FOUND', expected: 'REQUIRES_INVESTIGATION' },
    { findingType: 'VAULT_BALANCE_MISMATCH', expected: 'POSSIBLE_DISCREPANCY' },
    { findingType: 'GL_GLOBAL_IMBALANCE', expected: 'POSSIBLE_DISCREPANCY' },
    { findingType: 'GL_BATCH_IMBALANCE', expected: 'POSSIBLE_DISCREPANCY' },
    { findingType: 'GL_ACCOUNT_BALANCE_MISMATCH', expected: 'POSSIBLE_DISCREPANCY' },
    { findingType: 'DAILY_DEPOSIT_TOTAL_MISMATCH', expected: 'POSSIBLE_DISCREPANCY' },
    { findingType: 'WITHDRAWAL_AMOUNT_MISMATCH', expected: 'CONFIRMED_DISCREPANCY' },
    { findingType: 'WITHDRAWAL_BALANCE_AFTER_MISMATCH', expected: 'CONFIRMED_DISCREPANCY' },
    { findingType: 'WITHDRAWAL_PASSBOOK_DIFFERENCE_RECOMPUTE_MISMATCH', expected: 'DATA_QUALITY_ISSUE' },
    { findingType: 'WITHDRAWAL_PASSBOOK_MISMATCH', expected: 'CONFIRMED_DISCREPANCY' },
    { findingType: 'IMPLAUSIBLE_ENTRY_DATE', expected: 'DATA_QUALITY_ISSUE' },
    { findingType: 'ZERO_AMOUNT_LEDGER_ENTRY', expected: 'DATA_QUALITY_ISSUE' },
    { findingType: 'LOAN_ORPHANED_CUSTOMER_ACCOUNT', expected: 'DATA_QUALITY_ISSUE' },
    { findingType: 'INVESTMENT_ORPHANED_CUSTOMER_ACCOUNT', expected: 'DATA_QUALITY_ISSUE' },
    { findingType: 'FIELD_SURVEY_MISMATCH', expected: 'CONFIRMED_DISCREPANCY' },
    { findingType: 'PASSBOOK_CHECK_OPEN', expected: 'REQUIRES_INVESTIGATION' },
    { findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_NOT_CONFIGURED', expected: 'SOURCE_UNAVAILABLE' },
    { findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_UNAVAILABLE', expected: 'SOURCE_UNAVAILABLE' },
  ];

  for (const { findingType, expected } of cases) {
    it(`${findingType} -> ${expected}`, () => {
      const result = classifyOne(baseFinding({ findingType }));
      assert.strictEqual(result.classification, expected);
      assert.ok(result.classificationReason.length > 0, 'must carry a non-empty reason');
    });
  }

  it('an unknown findingType is never silently guessed - defaults to REQUIRES_INVESTIGATION with a visible reason', () => {
    const result = classifyOne(baseFinding({ findingType: 'SOME_FUTURE_FINDING_TYPE_NOT_YET_MAPPED' }));
    assert.strictEqual(result.classification, 'REQUIRES_INVESTIGATION');
    assert.ok(result.classificationReason.includes('No classification rule exists yet'));
  });
});

describe('classify.ts - office-records summary rollup gets no single classification', () => {
  it('SAVINGS_COMPARE_WITH_OFFICE_RECORDS_SUMMARY has classification: null and a classificationBreakdown in evidence', () => {
    const summary = baseFinding({ findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_SUMMARY', businessDate: 'summary' });
    const commission = baseFinding({
      findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_WITHDRAWAL_MISMATCH',
      businessDate: '2026-09-15',
      evidence: { status: 'COMMISSION MISMATCH - office 12.00 vs app 3.00' },
    });
    const [summaryResult, commissionResult] = classifyFindings([summary, commission], META_WITH_SEPT22_CUTOFF);

    assert.strictEqual(summaryResult!.classification, null);
    const breakdown = (summaryResult!.evidence as { classificationBreakdown: Record<string, number> }).classificationBreakdown;
    assert.strictEqual(breakdown.COMMISSION_MISMATCH, 1);
    assert.strictEqual(commissionResult!.classification, 'COMMISSION_MISMATCH');
  });
});

describe('classify.ts - the concrete real-world case: Sept 23-27 Office Records differences against a Sept 22 snapshot', () => {
  const META_SEPT22 = META_WITH_SEPT22_CUTOFF;

  it('a zone diff dated AFTER the snapshot cutoff is SNAPSHOT_LIMITATION, never a confirmed discrepancy', () => {
    for (const date of ['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']) {
      const finding = baseFinding({
        findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_ZONE_DIFF',
        businessDate: date,
        expectedValue: 1265000, // real office total from the live-validation run
        actualValue: 0, // app=0, exactly the real pattern observed live
        variance: -1265000,
      });
      const result = classifyOne(finding, META_SEPT22);
      assert.strictEqual(result.classification, 'SNAPSHOT_LIMITATION', `date ${date} must be SNAPSHOT_LIMITATION`);
      assert.notStrictEqual(result.classification, 'CONFIRMED_DISCREPANCY');
    }
  });

  it('a zone diff dated ON the cutoff date itself, or before it, is within coverage - not a snapshot limitation', () => {
    const onCutoff = classifyOne(
      baseFinding({
        findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_ZONE_DIFF',
        businessDate: '2026-09-22',
        expectedValue: 100000,
        actualValue: 95000,
        variance: -5000,
      }),
      META_SEPT22
    );
    assert.strictEqual(onCutoff.classification, 'CONFIRMED_DISCREPANCY');

    const beforeCutoff = classifyOne(
      baseFinding({
        findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_ZONE_DIFF',
        businessDate: '2026-09-15',
        expectedValue: 100000,
        actualValue: 93000,
        variance: -7000,
      }),
      META_SEPT22
    );
    assert.strictEqual(beforeCutoff.classification, 'CONFIRMED_DISCREPANCY');
  });

  it('a zone diff within coverage where the app side is genuinely zero is MONEYMANAGER_DATA_MISSING, not a generic confirmed discrepancy', () => {
    const result = classifyOne(
      baseFinding({
        findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_ZONE_DIFF',
        businessDate: '2026-09-15',
        expectedValue: 50000,
        actualValue: 0,
        variance: -50000,
      }),
      META_SEPT22
    );
    assert.strictEqual(result.classification, 'MONEYMANAGER_DATA_MISSING');
  });

  it('withdrawal AMOUNT MISMATCH dated after the cutoff is SNAPSHOT_LIMITATION too', () => {
    const result = classifyOne(
      baseFinding({
        findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_WITHDRAWAL_MISMATCH',
        businessDate: '2026-09-25',
        evidence: { status: 'AMOUNT MISMATCH - office 100.00 vs app 90.00' },
      }),
      META_SEPT22
    );
    assert.strictEqual(result.classification, 'SNAPSHOT_LIMITATION');
  });

  it('when moneyManagerDataAsOf is unknown (null), a date-dependent finding is REQUIRES_INVESTIGATION, never assumed confirmed', () => {
    const unknownCutoffMeta: RunMetadata = { ...META_SEPT22, moneyManagerDataAsOf: null };
    const zoneDiff = classifyOne(
      baseFinding({ findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_ZONE_DIFF', businessDate: '2026-09-25', expectedValue: 100, actualValue: 50, variance: -50 }),
      unknownCutoffMeta
    );
    assert.strictEqual(zoneDiff.classification, 'REQUIRES_INVESTIGATION');
    assert.notStrictEqual(zoneDiff.classification, 'CONFIRMED_DISCREPANCY');
  });
});

describe('classify.ts - commission mismatches, using the real pattern from live-validation testing', () => {
  it('COMMISSION MISMATCH status text -> COMMISSION_MISMATCH, always, regardless of date', () => {
    // The live run against the real 6 Google Sheets (2026-09-11..09-27)
    // produced 8 real commission mismatches with status text in exactly
    // this shape (matchWithdrawalsForDate in office-records/parse.ts).
    for (const date of ['2026-09-12', '2026-09-22', '2026-09-25']) {
      const result = classifyOne(
        baseFinding({
          findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_WITHDRAWAL_MISMATCH',
          businessDate: date,
          evidence: { status: 'COMMISSION MISMATCH - office 12.00 vs app 3.00' },
        }),
        META_WITH_SEPT22_CUTOFF
      );
      assert.strictEqual(result.classification, 'COMMISSION_MISMATCH', `date ${date}`);
    }
  });

  it('is never downgraded to POSSIBLE_DISCREPANCY or hidden - stays its own distinct category', () => {
    const result = classifyOne(
      baseFinding({
        findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_WITHDRAWAL_MISMATCH',
        businessDate: '2026-09-20',
        evidence: { status: 'COMMISSION MISMATCH - office 25.00 vs app 20.00' },
      })
    );
    assert.strictEqual(result.classification, 'COMMISSION_MISMATCH');
    assert.notStrictEqual(result.classification, 'POSSIBLE_DISCREPANCY');
    assert.notStrictEqual(result.classification, null);
  });
});

describe('classify.ts - unavailable/not-configured Office Records is SOURCE_UNAVAILABLE, structurally distinct from clean', () => {
  it('NOT_CONFIGURED -> SOURCE_UNAVAILABLE', () => {
    const result = classifyOne(baseFinding({ findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_NOT_CONFIGURED', businessDate: 'summary' }));
    assert.strictEqual(result.classification, 'SOURCE_UNAVAILABLE');
  });

  it('UNAVAILABLE -> SOURCE_UNAVAILABLE, and its evidence.message is preserved through classification unchanged', () => {
    const finding = baseFinding({
      findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_UNAVAILABLE',
      businessDate: 'summary',
      evidence: { message: 'Office Records comparison could not be completed because the external office-record source was unavailable.' },
    });
    const result = classifyOne(finding);
    assert.strictEqual(result.classification, 'SOURCE_UNAVAILABLE');
    assert.strictEqual(
      (result.evidence as { message: string }).message,
      'Office Records comparison could not be completed because the external office-record source was unavailable.'
    );
    // Never collapsed into anything that could be read as "no discrepancy".
    assert.notStrictEqual(result.classification, null);
  });
});

describe('classify.ts - genuine confirmed transaction/data-integrity issues', () => {
  it('a same-snapshot balance mismatch is CONFIRMED_DISCREPANCY', () => {
    const result = classifyOne(baseFinding({ findingType: 'BALANCE_MISMATCH', businessDate: '2026-09-10' }));
    assert.strictEqual(result.classification, 'CONFIRMED_DISCREPANCY');
  });

  it('an orphaned ledger entry is DATA_QUALITY_ISSUE, not framed as a live financial discrepancy', () => {
    const result = classifyOne(baseFinding({ findingType: 'ORPHANED_CUSTOMER_LEDGER_ENTRY', businessDate: '2026-09-10' }));
    assert.strictEqual(result.classification, 'DATA_QUALITY_ISSUE');
  });
});

describe('classify.ts - source-adapter substitutability (proves classification does not depend on which MoneyManagerSource produced the finding)', () => {
  it('identical findings + a differently-sourced RunMetadata.moneyManagerDataAsOf produce different (correct) classifications purely from the date, not from any adapter-specific branching', () => {
    const finding = baseFinding({
      findingType: 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_ZONE_DIFF',
      businessDate: '2026-09-25',
      expectedValue: 100000,
      actualValue: 40000,
      variance: -60000,
    });

    // "Offline snapshot" adapter: data as-of Sept 22 (stale) -> the date is
    // past coverage -> SNAPSHOT_LIMITATION.
    const asIfFromOfflineSnapshot = classifyOne(finding, { moneyManagerDataAsOf: '2026-09-22', officeRecordsConfigured: true, officeRecordsReportingPeriod: null });
    assert.strictEqual(asIfFromOfflineSnapshot.classification, 'SNAPSHOT_LIMITATION');

    // "Live" adapter (hypothetical future desktop-LAN/web adapter, not
    // built in this phase - simulated here purely as a different
    // RunMetadata value, proving classify.ts never branches on adapter
    // identity, only on the data properties it's handed): data as-of is
    // effectively "today", well past 2026-09-25 -> within coverage ->
    // CONFIRMED_DISCREPANCY instead, same classification code path.
    const asIfFromLiveAdapter = classifyOne(finding, { moneyManagerDataAsOf: '2026-09-30', officeRecordsConfigured: true, officeRecordsReportingPeriod: null });
    assert.strictEqual(asIfFromLiveAdapter.classification, 'CONFIRMED_DISCREPANCY');
  });
});

describe('classify.ts - evidence and source context are preserved through classification', () => {
  it('every classified finding carries evidence.sourceContext with the run metadata used to classify it', () => {
    const result = classifyOne(baseFinding({ findingType: 'BALANCE_MISMATCH' }), META_WITH_SEPT22_CUTOFF);
    const sourceContext = (result.evidence as { sourceContext: RunMetadata }).sourceContext;
    assert.deepStrictEqual(sourceContext, META_WITH_SEPT22_CUTOFF);
  });
});

describe('classify.ts - determinism', () => {
  it('the same findings + metadata classified twice produce identical output', () => {
    const findings = [
      baseFinding({ findingType: 'BALANCE_MISMATCH' }),
      baseFinding({ findingType: 'VAULT_BALANCE_MISMATCH', entityId: '2' }),
    ];
    const run1 = classifyFindings(findings, META_WITH_SEPT22_CUTOFF);
    const run2 = classifyFindings(findings, META_WITH_SEPT22_CUTOFF);
    assert.deepStrictEqual(run2, run1);
  });
});

describe('classify.ts - the closed 9-value set is exactly what ALL_CLASSIFICATIONS lists', () => {
  it('has exactly 9 values, no more, no fewer', () => {
    assert.strictEqual(ALL_CLASSIFICATIONS.length, 9);
    assert.deepStrictEqual(
      [...ALL_CLASSIFICATIONS].sort(),
      [
        'COMMISSION_MISMATCH',
        'CONFIRMED_DISCREPANCY',
        'DATA_QUALITY_ISSUE',
        'MONEYMANAGER_DATA_MISSING',
        'OFFICE_DATA_MISSING',
        'POSSIBLE_DISCREPANCY',
        'REQUIRES_INVESTIGATION',
        'SNAPSHOT_LIMITATION',
        'SOURCE_UNAVAILABLE',
      ].sort()
    );
  });
});
