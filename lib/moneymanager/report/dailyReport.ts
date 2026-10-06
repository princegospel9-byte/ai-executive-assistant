// Daily Business Operations Report (MVP V1) - builds a structured report
// straight from a completed runMonitoring() result. No new reconciliation
// math: every number here is expectedValue/actualValue/variance/evidence
// already computed by the 11 deterministic rules (lib/moneymanager/rules/)
// and every discrepancy label is already computed by the deterministic
// classifier (lib/moneymanager/classification/classify.ts). This module
// only groups, labels and formats what already exists - it never
// recomputes a reconciliation, never calls an LLM, and never invents an
// explanation beyond what a finding's own evidence already states.
//
// Column contract requested for every comparison row: System/MoneyManager
// value | Office Record value | Difference | % Difference | Status |
// Affected record(s) | Evidence | Recommended follow-up. That contract only
// makes literal sense for rows that ARE a MoneyManager-vs-Office-Records
// comparison (officeRecordsComparison.ts's ZONE_DIFF/WITHDRAWAL_MISMATCH
// findings). Every other rule is an internal MoneyManager consistency check
// (e.g. a GL account's stored balance vs its own computed ledger movement) -
// there is no Office Record on the other side of that comparison. Rather
// than fabricate an Office Record value for those, each row keeps an
// honest `referenceLabel` ('Office Record' vs 'Expected (internal check)')
// so nobody mistakes an internal MoneyManager check for a cross-source
// comparison against Office Records - see the module header rule "do not
// assume either source is correct" and "do not invent explanations".
import type { Classification, ClassifiedFinding } from '../classification/types';
import type { Severity } from '../rules/types';

/** The four discrepancy labels requested for this report, deterministically
 * derived from the 9-value Classification the existing classifier already
 * computes (lib/moneymanager/classification/types.ts) - never a 10th value,
 * never inferred from anything the classifier didn't already decide. */
export type ReportStatus =
  | 'CONFIRMED_DIFFERENCE'
  | 'POSSIBLE_TIMING_DIFFERENCE'
  | 'SUSPECTED_DATA_ENTRY_ISSUE'
  | 'UNRESOLVED';

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  CONFIRMED_DIFFERENCE: 'CONFIRMED DIFFERENCE',
  POSSIBLE_TIMING_DIFFERENCE: 'POSSIBLE/TIMING DIFFERENCE',
  SUSPECTED_DATA_ENTRY_ISSUE: 'SUSPECTED DATA-ENTRY ISSUE',
  UNRESOLVED: 'UNRESOLVED',
};

/** This mapping is the only place a Classification is turned into one of
 * the four requested labels - documented here, not scattered, so it stays
 * auditable against classify.ts's own reasoning for each Classification. */
const CLASSIFICATION_TO_STATUS: Record<Classification, ReportStatus> = {
  CONFIRMED_DISCREPANCY: 'CONFIRMED_DIFFERENCE',
  POSSIBLE_DISCREPANCY: 'POSSIBLE_TIMING_DIFFERENCE',
  SNAPSHOT_LIMITATION: 'POSSIBLE_TIMING_DIFFERENCE',
  DATA_QUALITY_ISSUE: 'SUSPECTED_DATA_ENTRY_ISSUE',
  COMMISSION_MISMATCH: 'SUSPECTED_DATA_ENTRY_ISSUE',
  OFFICE_DATA_MISSING: 'UNRESOLVED',
  MONEYMANAGER_DATA_MISSING: 'UNRESOLVED',
  SOURCE_UNAVAILABLE: 'UNRESOLVED',
  REQUIRES_INVESTIGATION: 'UNRESOLVED',
};

/** Generic, non-fabricated follow-up text per status - used only when a
 * finding's own evidence doesn't already carry a specific recommendation
 * (e.g. officeRecordsComparison.ts's _SUMMARY.recommendedInvestigation,
 * reused verbatim when present - see followUpFor() below). Never a guess at
 * *why* something differs, only *what kind of action* that status implies. */
const GENERIC_FOLLOW_UP: Record<ReportStatus, string> = {
  CONFIRMED_DIFFERENCE:
    'Investigate and correct the confirmed variance. Verify against source documents before adjusting either record.',
  POSSIBLE_TIMING_DIFFERENCE:
    'Re-check after the next report - may resolve once both sources cover the same date range. Do not treat as confirmed yet.',
  SUSPECTED_DATA_ENTRY_ISSUE:
    'Review the underlying record for a data-entry or referential-integrity error and correct it at the source.',
  UNRESOLVED: 'Manual review required - the comparison could not be completed or needs human judgment.',
};

type ReportSectionKey =
  | 'collections'
  | 'withdrawals'
  | 'depositsSubmissions'
  | 'cashMovement'
  | 'mismatchesAnomalies';

/** Static findingType -> section map. Every rule's findingType is listed
 * explicitly (see lib/moneymanager/rules/*.ts) so a finding type this file
 * doesn't know about is visibly caught by the fallback in categorize()
 * below, never silently dropped. Office Records findings are handled
 * separately (buildOfficeRecordsSection) except for the two row-producing
 * types (ZONE_DIFF -> Collections, WITHDRAWAL_MISMATCH -> Withdrawals),
 * which also appear in their natural business section per the request's
 * section list. */
const SECTION_BY_FINDING_TYPE: Record<string, ReportSectionKey> = {
  SAVINGS_COMPARE_WITH_OFFICE_RECORDS_ZONE_DIFF: 'collections',

  WITHDRAWAL_AMOUNT_MISMATCH: 'withdrawals',
  WITHDRAWAL_BALANCE_AFTER_MISMATCH: 'withdrawals',
  WITHDRAWAL_PASSBOOK_DIFFERENCE_RECOMPUTE_MISMATCH: 'withdrawals',
  WITHDRAWAL_PASSBOOK_MISMATCH: 'withdrawals',
  SAVINGS_COMPARE_WITH_OFFICE_RECORDS_WITHDRAWAL_MISMATCH: 'withdrawals',

  DAILY_DEPOSIT_TOTAL_MISMATCH: 'depositsSubmissions',

  VAULT_BALANCE_MISMATCH: 'cashMovement',
  VAULT_ACCOUNT_NOT_FOUND: 'cashMovement',
  GL_GLOBAL_IMBALANCE: 'cashMovement',
  GL_BATCH_IMBALANCE: 'cashMovement',
  GL_ACCOUNT_BALANCE_MISMATCH: 'cashMovement',

  BALANCE_MISMATCH: 'mismatchesAnomalies',
  BALANCE_NO_LEDGER_HISTORY: 'mismatchesAnomalies',
  DUPLICATE_LEDGER_ENTRY_GROUP: 'mismatchesAnomalies',
  DUPLICATE_RECEIPT_NUMBER: 'mismatchesAnomalies',
  ORPHANED_CUSTOMER_LEDGER_ENTRY: 'mismatchesAnomalies',
  ORPHANED_GL_LEDGER_ENTRY: 'mismatchesAnomalies',
  ORPHANED_WITHDRAWAL_RECORD: 'mismatchesAnomalies',
  IMPLAUSIBLE_ENTRY_DATE: 'mismatchesAnomalies',
  ZERO_AMOUNT_LEDGER_ENTRY: 'mismatchesAnomalies',
  LOAN_ORPHANED_CUSTOMER_ACCOUNT: 'mismatchesAnomalies',
  INVESTMENT_ORPHANED_CUSTOMER_ACCOUNT: 'mismatchesAnomalies',
  FIELD_SURVEY_MISMATCH: 'mismatchesAnomalies',
  PASSBOOK_CHECK_OPEN: 'mismatchesAnomalies',
};

const OFFICE_COMPARISON_FINDING_TYPES = new Set([
  'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_ZONE_DIFF',
  'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_WITHDRAWAL_MISMATCH',
]);

const OFFICE_RECORDS_SUMMARY_TYPE = 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_SUMMARY';
const OFFICE_RECORDS_NOT_CONFIGURED_TYPE = 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_NOT_CONFIGURED';
const OFFICE_RECORDS_UNAVAILABLE_TYPE = 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_UNAVAILABLE';

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 4, HIGH: 3, WARNING: 2, INFO: 1 };

/** Every rule's expectedValue/actualValue/variance is in minor currency
 * units EXCEPT these two - duplicateTransactions.ts's group/receipt-reuse
 * counts (expectedValue: 1, actualValue: occurrence count). Rendering a
 * count as if it were money (e.g. dividing by 100) would silently turn "3
 * duplicate postings" into a fabricated-looking "GHS 0.03" - this list
 * exists so the formatter never does that. */
const COUNT_METRIC_FINDING_TYPES = new Set(['DUPLICATE_LEDGER_ENTRY_GROUP', 'DUPLICATE_RECEIPT_NUMBER']);

export type ComparisonRow = {
  section: ReportSectionKey;
  label: string;
  businessDate: string;
  /** The MoneyManager/System-side value (always actualValue - see the rule
   * contract note above: rules already put the "value being checked" in
   * actualValue and the "reference it's checked against" in expectedValue,
   * whether that reference is an Office Record or an internal recomputation). */
  systemValue: number | null;
  /** The reference value this row was checked against. `referenceLabel`
   * says honestly whether that reference is a real Office Record or just
   * this rule's own internal recomputation - never presented as an Office
   * Record when it isn't one. */
  referenceValue: number | null;
  referenceLabel: 'Office Record' | 'Expected (internal check)';
  difference: number | null;
  percentDifference: number | null;
  severity: Severity;
  status: ReportStatus | 'INFO';
  findingType: string;
  ruleId: string;
  evidence: Record<string, unknown>;
  recommendedFollowUp: string;
  /** 'count' for the two occurrence-count finding types (see
   * COUNT_METRIC_FINDING_TYPES above) - everything else is minor-unit
   * currency. The formatter must render these differently, never as money. */
  valueKind: 'money_minor' | 'count';
};

export type ReportSection = {
  available: boolean;
  /** Populated only when available is false - why this section has no
   * data, never fabricated ("no rule/data source exists yet" or "Office
   * Records not configured"), matching documentation/moneymanager-
   * monitoring.md's own documented limitations. */
  unavailableReason?: string;
  rows: ComparisonRow[];
};

export type OfficeRecordsSection = ReportSection & {
  /** The always-emit _SUMMARY finding's own message, reused verbatim - see
   * officeRecordsComparison.ts. Present only when available is true. */
  summaryMessage?: string;
};

export type DailyReportMeta = {
  businessDate: string;
  runId: string;
  runStatus: 'completed' | 'incomplete' | 'failed';
  incompleteReason: string | null;
  errorMessage: string | null;
  generatedAt: string;
};

export type ExecutiveSummary = {
  totalFindings: number;
  bySeverity: Record<Severity, number>;
  byStatus: Record<ReportStatus, number>;
  moneyManagerDataAsOf: string | null;
  officeRecordsConfigured: boolean;
  officeRecordsStatus: 'configured_compared' | 'configured_unavailable' | 'not_configured';
};

export type DailyBusinessReport = {
  meta: DailyReportMeta;
  executiveSummary: ExecutiveSummary;
  collections: ReportSection;
  withdrawals: ReportSection;
  depositsSubmissions: ReportSection;
  expenses: ReportSection;
  cashMovement: ReportSection;
  mobilizerActivity: ReportSection;
  officeRecords: OfficeRecordsSection;
  mismatchesAnomalies: ReportSection;
  managerAttention: ComparisonRow[];
  recommendedFollowUp: string[];
};

function percentDifference(referenceValue: number | null, difference: number | null): number | null {
  if (referenceValue === null || difference === null || referenceValue === 0) return null;
  return (difference / Math.abs(referenceValue)) * 100;
}

/** Reuses a finding's own stated recommendation when one already exists
 * (officeRecordsComparison.ts's _SUMMARY.recommendedInvestigation) rather
 * than inventing a per-row explanation; otherwise a generic, status-scoped
 * action, with the rule's own `evidence.note` (a documented scope-gap
 * caveat, when present) appended verbatim for context - never paraphrased
 * or reinterpreted. */
function followUpFor(status: ReportStatus, evidence: Record<string, unknown>): string {
  if (typeof evidence.recommendedInvestigation === 'string') return evidence.recommendedInvestigation;
  const generic = GENERIC_FOLLOW_UP[status];
  if (typeof evidence.note === 'string') return `${generic} Note: ${evidence.note}`;
  return generic;
}

function toComparisonRow(f: ClassifiedFinding, section: ReportSectionKey): ComparisonRow {
  const isOfficeComparison = OFFICE_COMPARISON_FINDING_TYPES.has(f.findingType);
  const status: ReportStatus | 'INFO' = f.classification ? CLASSIFICATION_TO_STATUS[f.classification] : 'INFO';
  return {
    section,
    label: `${f.entityType} ${f.entityId}`,
    businessDate: f.businessDate,
    systemValue: f.actualValue,
    referenceValue: f.expectedValue,
    referenceLabel: isOfficeComparison ? 'Office Record' : 'Expected (internal check)',
    difference: f.variance,
    percentDifference: percentDifference(f.expectedValue, f.variance),
    severity: f.severity,
    status,
    findingType: f.findingType,
    ruleId: f.ruleId,
    evidence: f.evidence,
    recommendedFollowUp: status === 'INFO' ? 'None - informational only.' : followUpFor(status, f.evidence),
    valueKind: COUNT_METRIC_FINDING_TYPES.has(f.findingType) ? 'count' : 'money_minor',
  };
}

function categorize(f: ClassifiedFinding): ReportSectionKey | null {
  if (
    f.findingType === OFFICE_RECORDS_SUMMARY_TYPE ||
    f.findingType === OFFICE_RECORDS_NOT_CONFIGURED_TYPE ||
    f.findingType === OFFICE_RECORDS_UNAVAILABLE_TYPE
  ) {
    return null; // handled by buildOfficeRecordsSection, not a row in any of the five business sections
  }
  // Any findingType this map doesn't know about (e.g. a new rule added
  // later without updating this file) is never silently dropped - it lands
  // in Mismatches/Anomalies, matching classify.ts's own "never silently
  // guess/hide" convention for unmapped finding types.
  return SECTION_BY_FINDING_TYPE[f.findingType] ?? 'mismatchesAnomalies';
}

function buildOfficeRecordsSection(findings: ClassifiedFinding[]): OfficeRecordsSection {
  const notConfigured = findings.find((f) => f.findingType === OFFICE_RECORDS_NOT_CONFIGURED_TYPE);
  if (notConfigured) {
    return {
      available: false,
      unavailableReason: String((notConfigured.evidence as { message?: unknown }).message ?? 'Office Records is not configured.'),
      rows: [],
    };
  }

  const unavailable = findings.find((f) => f.findingType === OFFICE_RECORDS_UNAVAILABLE_TYPE);
  if (unavailable) {
    const evidence = unavailable.evidence as { message?: unknown; errorDetail?: unknown };
    const detail = typeof evidence.errorDetail === 'string' ? ` Detail: ${evidence.errorDetail}` : '';
    return {
      available: false,
      unavailableReason: `${String(evidence.message ?? 'Office Records comparison was unavailable.')}${detail}`,
      rows: [],
    };
  }

  const summary = findings.find((f) => f.findingType === OFFICE_RECORDS_SUMMARY_TYPE);
  const rows = findings
    .filter((f) => OFFICE_COMPARISON_FINDING_TYPES.has(f.findingType))
    .map((f) => toComparisonRow(f, categorize(f) as ReportSectionKey));

  return {
    available: true,
    summaryMessage: summary ? String((summary.evidence as { message?: unknown }).message ?? '') : undefined,
    rows,
  };
}

function emptySection(): ReportSection {
  return { available: true, rows: [] };
}

/** Builds the Daily Business Operations Report from one runMonitoring()
 * result's already-classified findings. Pure and synchronous - no I/O, no
 * AI call, no reconciliation math beyond grouping/labeling numbers the
 * rules and classifier already produced. */
export function buildDailyReport(findings: ClassifiedFinding[], meta: DailyReportMeta): DailyBusinessReport {
  // classify.ts always attaches evidence.sourceContext (the RunMetadata) to
  // every finding, regardless of type - read it back from any finding
  // rather than re-deriving/re-fetching moneyManagerDataAsOf or
  // officeRecordsConfigured a second time.
  const sourceContext = findings[0]?.evidence.sourceContext as
    | { moneyManagerDataAsOf: string | null; officeRecordsConfigured: boolean }
    | undefined;

  const bySeverity: Record<Severity, number> = { INFO: 0, WARNING: 0, HIGH: 0, CRITICAL: 0 };
  const byStatus: Record<ReportStatus, number> = {
    CONFIRMED_DIFFERENCE: 0,
    POSSIBLE_TIMING_DIFFERENCE: 0,
    SUSPECTED_DATA_ENTRY_ISSUE: 0,
    UNRESOLVED: 0,
  };
  for (const f of findings) {
    bySeverity[f.severity]++;
    if (f.classification) byStatus[CLASSIFICATION_TO_STATUS[f.classification]]++;
  }

  const officeRecords = buildOfficeRecordsSection(findings);
  const officeRecordsStatus: ExecutiveSummary['officeRecordsStatus'] = !sourceContext?.officeRecordsConfigured
    ? 'not_configured'
    : officeRecords.available
      ? 'configured_compared'
      : 'configured_unavailable';

  const sections: Record<ReportSectionKey, ReportSection> = {
    collections: emptySection(),
    withdrawals: emptySection(),
    depositsSubmissions: emptySection(),
    cashMovement: emptySection(),
    mismatchesAnomalies: emptySection(),
  };

  for (const f of findings) {
    const key = categorize(f);
    if (key === null) continue;
    sections[key].rows.push(toComparisonRow(f, key));
  }

  // Collections has exactly one contributing rule (officeRecordsComparison's
  // zone diff) - if Office Records isn't configured/available there is
  // genuinely no collections comparison to show, not a clean result.
  if (sections.collections.rows.length === 0 && officeRecordsStatus !== 'configured_compared') {
    sections.collections = {
      available: false,
      unavailableReason:
        'The only collections comparison this engine produces (zone cash-received vs MoneyManager zone collections) comes from Office Records - ' +
        officeRecords.unavailableReason,
      rows: [],
    };
  }

  const managerAttention = findings
    .filter((f) => f.severity === 'HIGH' || f.severity === 'CRITICAL')
    .map((f) => toComparisonRow(f, categorize(f) ?? 'mismatchesAnomalies'))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || Math.abs(b.difference ?? 0) - Math.abs(a.difference ?? 0))
    .slice(0, 15);

  const recommendedFollowUp = Array.from(new Set(managerAttention.map((r) => r.recommendedFollowUp))).slice(0, 10);

  return {
    meta,
    executiveSummary: {
      totalFindings: findings.length,
      bySeverity,
      byStatus,
      moneyManagerDataAsOf: sourceContext?.moneyManagerDataAsOf ?? null,
      officeRecordsConfigured: sourceContext?.officeRecordsConfigured ?? false,
      officeRecordsStatus,
    },
    collections: sections.collections,
    withdrawals: sections.withdrawals,
    depositsSubmissions: sections.depositsSubmissions,
    expenses: {
      available: false,
      unavailableReason:
        'No expense-tracking rule or data source exists in the MoneyManager monitoring engine yet - not fabricated.',
      rows: [],
    },
    cashMovement: sections.cashMovement,
    mobilizerActivity: {
      available: false,
      unavailableReason:
        'Mobilizer/Collector activity monitoring is not built - MoneyManager currently has no way to grant read-only access to this data without also granting write/manage permissions (documented limitation).',
      rows: [],
    },
    officeRecords,
    mismatchesAnomalies: sections.mismatchesAnomalies,
    managerAttention,
    recommendedFollowUp,
  };
}
