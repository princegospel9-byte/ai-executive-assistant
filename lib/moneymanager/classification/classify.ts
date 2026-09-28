// Phase 4A: deterministic classification layer. Sits between the rule
// engine (lib/moneymanager/rules/) and persistence/AI in
// lib/moneymanager/run.ts - runs AFTER runAllRules(), BEFORE any AI step.
//
// Hard rule, the entire point of this phase: classification is 100%
// deterministic. No LLM call happens anywhere in this file. The AI
// (downstream, via the existing agent_transaction_integrity/
// agent_reconciliation/agent_business_performance personas) only ever
// annotates/explains a classification it is given - it never assigns or
// overrides one. See documentation/moneymanager-monitoring.md's
// "Finding classification" section for the anti-fabrication rules this
// file exists to enforce:
//   - never classify using information not present in the finding's own
//     deterministic fields (findingType/businessDate/evidence) plus
//     RunMetadata - no guessing beyond what's actually there;
//   - never infer a missing transaction merely because an office value is
//     larger than the app value (see classifyZoneDiff: a larger office
//     value within coverage is CONFIRMED_DISCREPANCY, not an inferred
//     "missing transaction" claim - the finding just says the numbers
//     disagree, it does not accuse anyone of losing money);
//   - never call a post-snapshot-cutoff difference a confirmed
//     discrepancy (see the moneyManagerDataAsOf checks below);
//   - never treat an unavailable Office Records fetch as a clean/
//     no-discrepancy comparison (SOURCE_UNAVAILABLE is a distinct,
//     unmistakable value - never silently mapped to "no findings").
import type { Finding } from '../rules/types';
import type { Classification, ClassifiedFinding, RunMetadata } from './types';

const OFFICE_RECORDS_SUMMARY = 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_SUMMARY';
const OFFICE_RECORDS_ZONE_DIFF = 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_ZONE_DIFF';
const OFFICE_RECORDS_WITHDRAWAL_MISMATCH = 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_WITHDRAWAL_MISMATCH';

/** Static (rule-level) classification for every finding type whose
 * classification never depends on run metadata or evidence content - one
 * entry per non-conditional row of the Phase 4A design's mapping table.
 * Kept as an explicit map (not a fallback default) so a finding type this
 * file doesn't know about is visibly unclassified-by-default (see
 * classifyFinding's final fallback) rather than silently miscategorized. */
const STATIC_CLASSIFICATION: Record<string, { classification: Classification; reason: string }> = {
  BALANCE_MISMATCH: {
    classification: 'CONFIRMED_DISCREPANCY',
    reason: "Same-snapshot internal inconsistency between an account's stored balance and its own ledger history - both read from the same source at the same instant, no cross-source staleness is possible.",
  },
  BALANCE_NO_LEDGER_HISTORY: {
    classification: 'REQUIRES_INVESTIGATION',
    reason: 'A structural gap (non-zero balance with no ledger history at all), not a numeric disagreement between two values - needs a human to look at why the history is missing.',
  },
  DUPLICATE_LEDGER_ENTRY_GROUP: {
    classification: 'CONFIRMED_DISCREPANCY',
    reason: 'Same-snapshot, deterministically detected duplicate posting.',
  },
  DUPLICATE_RECEIPT_NUMBER: {
    classification: 'CONFIRMED_DISCREPANCY',
    reason: 'Same-snapshot, deterministically detected receipt-number reuse.',
  },
  ORPHANED_CUSTOMER_LEDGER_ENTRY: {
    classification: 'DATA_QUALITY_ISSUE',
    reason: 'Referential-integrity break (points at a customer_account_id that does not exist) - a records-quality problem, not a value disagreement.',
  },
  ORPHANED_GL_LEDGER_ENTRY: {
    classification: 'DATA_QUALITY_ISSUE',
    reason: 'Referential-integrity break (points at a gl_account_id that does not exist).',
  },
  ORPHANED_WITHDRAWAL_RECORD: {
    classification: 'DATA_QUALITY_ISSUE',
    reason: 'Referential-integrity break (no backing customer_ledger_entries row).',
  },
  VAULT_ACCOUNT_NOT_FOUND: {
    classification: 'REQUIRES_INVESTIGATION',
    reason: 'Blocks Vault reconciliation entirely - needs a human to review the chart of accounts, not a numeric classification.',
  },
  VAULT_BALANCE_MISMATCH: {
    classification: 'POSSIBLE_DISCREPANCY',
    reason: "This finding's own evidence documents that ledger_entries is a narrower posting stream than customer_ledger_entries for some transaction types - a variance here may reflect that scope gap rather than a real error, so it is not presented as confirmed.",
  },
  GL_GLOBAL_IMBALANCE: {
    classification: 'POSSIBLE_DISCREPANCY',
    reason: 'Same documented ledger_entries scope-gap caveat as VAULT_BALANCE_MISMATCH.',
  },
  GL_BATCH_IMBALANCE: {
    classification: 'POSSIBLE_DISCREPANCY',
    reason: 'Same documented ledger_entries scope-gap caveat.',
  },
  GL_ACCOUNT_BALANCE_MISMATCH: {
    classification: 'POSSIBLE_DISCREPANCY',
    reason: 'Same documented ledger_entries scope-gap caveat.',
  },
  DAILY_DEPOSIT_TOTAL_MISMATCH: {
    classification: 'POSSIBLE_DISCREPANCY',
    reason: 'Same documented ledger_entries-vs-customer_ledger_entries scope-gap caveat (see the rule\'s own evidence.note).',
  },
  WITHDRAWAL_AMOUNT_MISMATCH: {
    classification: 'CONFIRMED_DISCREPANCY',
    reason: "Same-snapshot comparison between a withdrawal record and its own backing ledger entry - no scope-gap caveat documented for this rule.",
  },
  WITHDRAWAL_BALANCE_AFTER_MISMATCH: {
    classification: 'CONFIRMED_DISCREPANCY',
    reason: 'Same-snapshot comparison between a withdrawal record and its own backing ledger entry.',
  },
  WITHDRAWAL_PASSBOOK_DIFFERENCE_RECOMPUTE_MISMATCH: {
    classification: 'DATA_QUALITY_ISSUE',
    reason: "The stored passbook-difference field disagrees with recomputing it from the record's own other fields - a data-integrity issue in the stored value, not a live financial discrepancy.",
  },
  WITHDRAWAL_PASSBOOK_MISMATCH: {
    classification: 'CONFIRMED_DISCREPANCY',
    reason: 'MoneyManager itself recorded a nonzero physical passbook difference at withdrawal time - already ground-truth-confirmed by MoneyManager, not inferred here.',
  },
  IMPLAUSIBLE_ENTRY_DATE: {
    classification: 'DATA_QUALITY_ISSUE',
    reason: 'A malformed/out-of-range date value - a records-quality problem by definition.',
  },
  ZERO_AMOUNT_LEDGER_ENTRY: {
    classification: 'DATA_QUALITY_ISSUE',
    reason: 'A ledger posting that moved no money at all - a records-quality flag, not a financial discrepancy.',
  },
  LOAN_ORPHANED_CUSTOMER_ACCOUNT: {
    classification: 'DATA_QUALITY_ISSUE',
    reason: 'Referential-integrity break.',
  },
  INVESTMENT_ORPHANED_CUSTOMER_ACCOUNT: {
    classification: 'DATA_QUALITY_ISSUE',
    reason: 'Referential-integrity break.',
  },
  FIELD_SURVEY_MISMATCH: {
    classification: 'CONFIRMED_DISCREPANCY',
    reason: 'A field worker physically verified the passbook against the system at a specific moment - as close to ground truth as MoneyManager data gets, not cross-source-staleness-sensitive.',
  },
  PASSBOOK_CHECK_OPEN: {
    classification: 'REQUIRES_INVESTIGATION',
    reason: 'Already explicitly unresolved by staff in MoneyManager itself - already a known pending item awaiting human resolution, not a fresh discrepancy claim.',
  },
  SAVINGS_COMPARE_WITH_OFFICE_RECORDS_NOT_CONFIGURED: {
    classification: 'SOURCE_UNAVAILABLE',
    reason: 'No comparison could be made because Office Records has not been configured yet - functionally the same "nothing to compare" state as a fetch failure.',
  },
  SAVINGS_COMPARE_WITH_OFFICE_RECORDS_UNAVAILABLE: {
    classification: 'SOURCE_UNAVAILABLE',
    reason: 'The external Office Records source (Google Sheets) could not be reached or parsed - explicitly not a clean/no-discrepancy result.',
  },
};

function classifyZoneDiff(finding: Finding, meta: RunMetadata): { classification: Classification; reason: string } {
  if (meta.moneyManagerDataAsOf === null) {
    return {
      classification: 'REQUIRES_INVESTIGATION',
      reason: 'MoneyManager data-as-of date is unknown for this run, so this finding cannot be safely classified as either confirmed or a snapshot limitation.',
    };
  }
  if (finding.businessDate > meta.moneyManagerDataAsOf) {
    return {
      classification: 'SNAPSHOT_LIMITATION',
      reason: `businessDate ${finding.businessDate} is after this MoneyManager source's data coverage (as of ${meta.moneyManagerDataAsOf}) - the source simply has no local data that far yet, not a real discrepancy.`,
    };
  }
  if (finding.actualValue === 0) {
    return {
      classification: 'MONEYMANAGER_DATA_MISSING',
      reason: `App-side (MoneyManager) total is zero for ${finding.businessDate}, a date within the source's known coverage (as of ${meta.moneyManagerDataAsOf}) - local data appears genuinely absent for this zone/date rather than simply differing in amount.`,
    };
  }
  return {
    classification: 'CONFIRMED_DISCREPANCY',
    reason: `Both Office Records and MoneyManager have data for ${finding.businessDate} (within known coverage) and the totals disagree - no documented scope-gap caveat applies to zone collections.`,
  };
}

function classifyWithdrawalMismatch(finding: Finding, meta: RunMetadata): { classification: Classification; reason: string } {
  const status = String((finding.evidence as { status?: unknown }).status ?? '');

  if (status.startsWith('COMMISSION MISMATCH')) {
    return {
      classification: 'COMMISSION_MISMATCH',
      reason: 'The principal amount matched between Office Records and MoneyManager; only the recorded commission differs - kept visible as its own investigation category, never downgraded or hidden.',
    };
  }
  if (status.startsWith('IN APP ONLY')) {
    return {
      classification: 'OFFICE_DATA_MISSING',
      reason: "MoneyManager has this withdrawal recorded; the office's own manual CASH OUT sheet has no matching row for it.",
    };
  }
  if (status.startsWith('IN OFFICE SHEET ONLY')) {
    if (meta.moneyManagerDataAsOf === null) {
      return {
        classification: 'REQUIRES_INVESTIGATION',
        reason: 'MoneyManager data-as-of date is unknown for this run, so this finding cannot be safely classified.',
      };
    }
    if (finding.businessDate > meta.moneyManagerDataAsOf) {
      return {
        classification: 'SNAPSHOT_LIMITATION',
        reason: `businessDate ${finding.businessDate} is after this MoneyManager source's data coverage (as of ${meta.moneyManagerDataAsOf}) - the office sheet may simply be ahead of what this source has synced.`,
      };
    }
    return {
      classification: 'MONEYMANAGER_DATA_MISSING',
      reason: `Office Records has this withdrawal for ${finding.businessDate}, a date within MoneyManager's known coverage (as of ${meta.moneyManagerDataAsOf}) - MoneyManager's own record of it appears genuinely absent.`,
    };
  }
  if (status.startsWith('AMOUNT MISMATCH')) {
    if (meta.moneyManagerDataAsOf === null) {
      return {
        classification: 'REQUIRES_INVESTIGATION',
        reason: 'MoneyManager data-as-of date is unknown for this run, so this finding cannot be safely classified.',
      };
    }
    if (finding.businessDate > meta.moneyManagerDataAsOf) {
      return {
        classification: 'SNAPSHOT_LIMITATION',
        reason: `businessDate ${finding.businessDate} is after this MoneyManager source's data coverage (as of ${meta.moneyManagerDataAsOf}).`,
      };
    }
    return {
      classification: 'CONFIRMED_DISCREPANCY',
      reason: `Both sides have a matched withdrawal for ${finding.businessDate} (within known coverage) but the amounts disagree.`,
    };
  }

  // Every status this finding type can actually carry is handled above
  // (matchWithdrawalsForDate in lib/moneymanager/office-records/parse.ts
  // only ever produces these four non-"Matches" prefixes - a "Matches..."
  // status never reaches a finding at all, filtered out by
  // officeRecordsComparison.ts itself). This is a safety net for an
  // unrecognized string, not an expected path - never silently guess.
  return {
    classification: 'REQUIRES_INVESTIGATION',
    reason: `Unrecognized withdrawal-match status text ("${status}") - could not be safely classified by the known patterns.`,
  };
}

function classifyFinding(finding: Finding, meta: RunMetadata): ClassifiedFinding {
  if (finding.findingType === OFFICE_RECORDS_SUMMARY) {
    // Rollup only - never itself a discrepancy claim. classifyFindings()
    // below attaches evidence.classificationBreakdown after every other
    // finding in the batch has been classified.
    return {
      ...finding,
      classification: null,
      classificationReason: 'Rollup finding summarizing this run\'s Office Records comparison - see evidence.classificationBreakdown for the classification counts of its sibling findings, not a classification of its own.',
    };
  }

  if (finding.findingType === OFFICE_RECORDS_ZONE_DIFF) {
    const { classification, reason } = classifyZoneDiff(finding, meta);
    return { ...finding, classification, classificationReason: reason };
  }

  if (finding.findingType === OFFICE_RECORDS_WITHDRAWAL_MISMATCH) {
    const { classification, reason } = classifyWithdrawalMismatch(finding, meta);
    return { ...finding, classification, classificationReason: reason };
  }

  const staticEntry = STATIC_CLASSIFICATION[finding.findingType];
  if (staticEntry) {
    return { ...finding, classification: staticEntry.classification, classificationReason: staticEntry.reason };
  }

  // A finding type this classifier doesn't know about (e.g. a new rule
  // added without updating this file) is never silently guessed at -
  // forced to REQUIRES_INVESTIGATION so the gap is visible, not hidden.
  return {
    ...finding,
    classification: 'REQUIRES_INVESTIGATION',
    classificationReason: `No classification rule exists yet for findingType "${finding.findingType}" - defaulting to REQUIRES_INVESTIGATION rather than guessing.`,
  };
}

/** Classifies every finding from one monitoring run. Deterministic and
 * synchronous - no AI call, no network I/O, no randomness. Also attaches
 * evidence.sourceContext (the run metadata itself) and, on the always-emit
 * office-records summary finding, evidence.classificationBreakdown - so
 * evidence and source dates are preserved all the way through to whatever
 * structured input eventually reaches the AI, per the anti-fabrication
 * requirement that the AI must never have to infer source context that
 * already exists deterministically. */
export function classifyFindings(findings: Finding[], meta: RunMetadata): ClassifiedFinding[] {
  const withSourceContext = findings.map((f) => ({
    ...f,
    evidence: { ...f.evidence, sourceContext: { ...meta } },
  }));

  const classified = withSourceContext.map((f) => classifyFinding(f, meta));

  const breakdown: Partial<Record<Classification, number>> = {};
  for (const f of classified) {
    if (f.classification === null) continue;
    breakdown[f.classification] = (breakdown[f.classification] ?? 0) + 1;
  }

  return classified.map((f) => {
    if (f.findingType !== OFFICE_RECORDS_SUMMARY) return f;
    return { ...f, evidence: { ...f.evidence, classificationBreakdown: breakdown } };
  });
}
