// Phase 4A: the closed set of classification values a Finding can be
// assigned, and the run-level metadata the classifier needs to tell a real
// discrepancy apart from an artifact of source staleness/unavailability.
// Deliberately closed (exactly these 9, no more) per explicit product
// decision - lib/moneymanager/classification/classify.ts must never invent
// a 10th value.
import type { Finding } from '../rules/types';

export type Classification =
  | 'CONFIRMED_DISCREPANCY'
  | 'POSSIBLE_DISCREPANCY'
  | 'SNAPSHOT_LIMITATION'
  | 'OFFICE_DATA_MISSING'
  | 'MONEYMANAGER_DATA_MISSING'
  | 'COMMISSION_MISMATCH'
  | 'DATA_QUALITY_ISSUE'
  | 'SOURCE_UNAVAILABLE'
  | 'REQUIRES_INVESTIGATION';

export const ALL_CLASSIFICATIONS: readonly Classification[] = [
  'CONFIRMED_DISCREPANCY',
  'POSSIBLE_DISCREPANCY',
  'SNAPSHOT_LIMITATION',
  'OFFICE_DATA_MISSING',
  'MONEYMANAGER_DATA_MISSING',
  'COMMISSION_MISMATCH',
  'DATA_QUALITY_ISSUE',
  'SOURCE_UNAVAILABLE',
  'REQUIRES_INVESTIGATION',
];

/** Run-level facts the classifier needs, computed once per monitoring run
 * (lib/moneymanager/run.ts) - independent of which concrete
 * MoneyManagerSource produced the findings (see dataAsOfDate()'s doc
 * comment on the interface for why). */
export type RunMetadata = {
  /** MoneyManagerSource.dataAsOfDate() for this run's source - null only
   * when no plausible business date could be determined at all. */
  moneyManagerDataAsOf: string | null;
  officeRecordsConfigured: boolean;
  officeRecordsReportingPeriod: { dateFrom: string; dateTo: string } | null;
};

/** A Finding (lib/moneymanager/rules/types.ts) plus its deterministic
 * classification. `classification` is null ONLY for the always-emit
 * SAVINGS_COMPARE_WITH_OFFICE_RECORDS_SUMMARY rollup finding, which
 * summarizes its sibling findings rather than representing a discrepancy
 * itself - see evidence.classificationBreakdown on that one instead. */
export type ClassifiedFinding = Finding & {
  classification: Classification | null;
  classificationReason: string;
};
