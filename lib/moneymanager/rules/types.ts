// The one finding shape every rule in lib/moneymanager/rules/*.ts must
// return. Deliberately flat and serializable (no class instances, no
// functions) because it is written to mm_findings as-is and is the ONLY
// data shape ever handed to an AI agent - never raw MoneyManager rows.
import type { MoneyManagerSource } from '../client/source';
import type { OfficeRecordsConfigResult } from '../office-records/config';

export type Severity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';

export type Finding = {
  findingType: string;
  severity: Severity;
  entityType: string;
  entityId: string;
  expectedValue: number | null;
  actualValue: number | null;
  variance: number | null;
  businessDate: string;
  evidence: Record<string, unknown>;
  ruleId: string;
};

// A rule is a function of a MoneyManagerSource (not concretely
// SnapshotReader - see lib/moneymanager/client/source.ts) plus the optional
// office-records inputs below. Every rule except
// officeRecordsComparison.ts is a pure, synchronous, no-I/O-beyond-the-
// reader function (same source content in, same Finding[] out - no
// Date.now(), no Math.random()). officeRecordsComparison.ts is the sole
// exception: it needs network I/O (Google Sheets) and is therefore async -
// see its file header for why. `run` returning `Finding[] | Promise<Finding[]>`
// lets one rule be async without forcing the other nine to become
// Promise-returning too; lib/moneymanager/rules/index.ts awaits every
// result uniformly either way.
export type Rule = {
  ruleId: string;
  description: string;
  run: (ctx: RuleContext) => Finding[] | Promise<Finding[]>;
};

export type RuleContext = {
  reader: MoneyManagerSource;
  /** Office Records (Google Sheets) configuration for the one rule that
   * needs it (officeRecordsComparison.ts). Every other rule ignores this.
   * Defaults are applied by lib/moneymanager/run.ts if the caller doesn't
   * supply one - see runMonitoring's officeRecordsConfig option - so a
   * caller that forgets to wire this up gets an explicit "not configured"
   * finding, never a silently skipped rule. */
  officeRecordsConfig?: OfficeRecordsConfigResult;
  /** Injectable fetch implementation, for tests to mock the Google Sheets
   * HTTP calls without a real network request. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Reporting period for officeRecordsComparison.ts. Defaults to the last
   * 7 complete days (today excluded, since today's entries may still be
   * arriving) when not supplied - tests pass a fixed range instead of
   * relying on the real clock, since this rule is already the one
   * documented non-deterministic exception (network I/O) in this engine. */
  officeRecordsDateRange?: { dateFrom: string; dateTo: string };
  /** Retry delays (ms) for officeRecordsComparison.ts's Google Sheets
   * fetches. Defaults to the real [2000, 5000, 10000] schedule ported from
   * moneymanager-standalone-src - tests override this to a short/empty
   * schedule so a deliberately-failing fetch mock doesn't make the test
   * suite slow. */
  officeRecordsRetryDelaysMs?: number[];
};
