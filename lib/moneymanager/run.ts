// Monitoring run orchestration. Runnable directly from a script or test
// with no n8n involved - see scripts/mm-monitor.ts for the CLI entry point.
//
// Fail-safe contract (hard requirement, see documentation/moneymanager-
// monitoring.md): a run that cannot read the snapshot, or whose rules
// collectively fail to complete, is marked 'incomplete' or 'failed' with a
// recorded reason. It NEVER reports 'completed' with zero findings as a
// stand-in for "we don't actually know". Missing data must never look like
// a clean bill of health.
import { findingDedupeKey } from './dedupe';
import { SnapshotIncompleteError, SnapshotReader } from './client/snapshot';
import type { MoneyManagerSource } from './client/source';
import { runAllRules } from './rules';
import { classifyFindings } from './classification/classify';
import type { ClassifiedFinding, RunMetadata } from './classification/types';
import type { MonitoringPersistence } from './persistence/types';
import { OFFICE_RECORDS_NOT_CONFIGURED, type OfficeRecordsConfigResult } from './office-records/config';

type CommonRunMonitoringOptions = {
  userId: string;
  persistence: MonitoringPersistence;
  /** Business date this run represents, e.g. '2026-09-22'. Defaults to the
   * current UTC date - callers running against a specific historical
   * snapshot should pass this explicitly instead of relying on "today". */
  businessDate?: string;
  /** Now-function, overridable for deterministic tests. */
  now?: () => Date;
  /** Office Records (Google Sheets) config for officeRecordsComparison.ts.
   * Defaults to "not configured" when omitted - callers that haven't wired
   * up loading it from Supabase (lib/moneymanager/office-records/
   * config.ts's loadOfficeRecordsConfig) still get an explicit
   * SAVINGS_COMPARE_WITH_OFFICE_RECORDS_NOT_CONFIGURED finding rather than
   * the rule silently being skipped. This is a partial-incomplete concern,
   * not a whole-run one: officeRecordsComparisonRule never throws (it
   * turns "not configured" and fetch failures into findings itself), so an
   * unconfigured/unavailable office-records source does not stop the other
   * ten rules from completing normally - the run still finishes
   * 'completed' overall, with the office-records finding surfacing the gap. */
  officeRecordsConfig?: OfficeRecordsConfigResult;
  /** Injectable fetch, threaded to officeRecordsComparisonRule for tests. */
  fetchImpl?: typeof fetch;
  /** Reporting period for officeRecordsComparisonRule. See RuleContext's
   * doc comment (lib/moneymanager/rules/types.ts) for the default. */
  officeRecordsDateRange?: { dateFrom: string; dateTo: string };
};

// Phase 4C: runMonitoring() now accepts EITHER of two ways to get a
// MoneyManagerSource, sharing one identical rules -> classification ->
// persistence pipeline below - no branching after the source is obtained.
// This is deliberately a discriminated union, not two optional fields: it's
// a compile-time error to pass both or neither, so a caller can never end
// up in the ambiguous state of "which source did this run actually use?".
//
//  - `snapshotPath` (unchanged, exact original signature/behavior): opens a
//    read-only offline sqlite snapshot via SnapshotReader.open(), exactly as
//    every existing Phase 3/4A caller and test already does.
//  - `source` + `sourceIdentifier`: an already-constructed MoneyManagerSource
//    (e.g. a live LanApiSource, see lib/moneymanager/client/lan-api-source.ts,
//    or a fake/test double) plus a caller-supplied string identifying it for
//    the run row's snapshotIdentifier column (there is no file to derive
//    size/mtime from, so those columns are recorded as 0 / "now" - the same
//    placeholder convention already used a few lines below for the
//    "snapshot failed to even open" case).
export type RunMonitoringOptions = CommonRunMonitoringOptions &
  (
    | { snapshotPath: string; source?: undefined; sourceIdentifier?: undefined }
    | { source: MoneyManagerSource; sourceIdentifier: string; snapshotPath?: undefined }
  );

export type RunMonitoringResult = {
  runId: string;
  status: 'completed' | 'incomplete' | 'failed';
  /** Classified findings (Phase 4A) - every finding carries a deterministic
   * `classification` (null only for the office-records summary rollup) and
   * `classificationReason`, computed by lib/moneymanager/classification/
   * classify.ts BEFORE any AI step ever sees them. */
  findings: ClassifiedFinding[];
  incompleteReason: string | null;
  errorMessage: string | null;
  findingCounts: Record<string, number>;
};

export async function runMonitoring(opts: RunMonitoringOptions): Promise<RunMonitoringResult> {
  const now = opts.now ?? (() => new Date());
  const businessDate = opts.businessDate ?? now().toISOString().slice(0, 10);

  // Resolve `opts` (a snapshotPath or a pre-built source) down to a single
  // `MoneyManagerSource` + identifier pair. Past this point, the rest of
  // this function has no idea which branch it came from - one pipeline,
  // no duplicated rule/classification/persistence logic between them.
  let source: MoneyManagerSource;
  let snapshotIdentifier: string;
  let snapshotFileSizeBytes: number;
  let snapshotFileModifiedAt: string;

  if (opts.source) {
    // Pre-built source (e.g. a live LanApiSource, or a test double) - there
    // is no underlying file to derive size/mtime from, so those columns get
    // the same 0 / "now" placeholder already used a few lines below for the
    // "snapshot failed to even open" case.
    source = opts.source;
    snapshotIdentifier = opts.sourceIdentifier;
    snapshotFileSizeBytes = 0;
    snapshotFileModifiedAt = now().toISOString();
  } else {
    // Snapshot must open and pass schema validation BEFORE we create the
    // run row, so we always have a size/mtime identifier to record. If it
    // can't even open, there is nothing to create a run row against except
    // a 'failed' one with no snapshot identifier available.
    let reader: SnapshotReader;
    try {
      reader = SnapshotReader.open(opts.snapshotPath);
    } catch (err) {
      if (err instanceof SnapshotIncompleteError) {
        // Best-effort: still create a run row so the failure is visible in
        // mm_monitoring_runs, using the path itself as the identifier since
        // we couldn't read file stats.
        const { runId } = await opts.persistence.createRun({
          userId: opts.userId,
          businessDate,
          snapshotIdentifier: opts.snapshotPath,
          snapshotFileSizeBytes: 0,
          snapshotFileModifiedAt: now().toISOString(),
        });
        await opts.persistence.finishRun({
          runId,
          status: 'incomplete',
          finishedAt: now().toISOString(),
          incompleteReason: err.reason,
          errorMessage: null,
          findingCounts: {},
        });
        return {
          runId,
          status: 'incomplete',
          findings: [],
          incompleteReason: err.reason,
          errorMessage: null,
          findingCounts: {},
        };
      }
      throw err;
    }

    source = reader;
    snapshotIdentifier = `${opts.snapshotPath}#${reader.identifier.fileSizeBytes}b@${reader.identifier.fileModifiedAt}`;
    snapshotFileSizeBytes = reader.identifier.fileSizeBytes;
    snapshotFileModifiedAt = reader.identifier.fileModifiedAt;
  }

  const { runId } = await opts.persistence.createRun({
    userId: opts.userId,
    businessDate,
    snapshotIdentifier,
    snapshotFileSizeBytes,
    snapshotFileModifiedAt,
  });

  try {
    const ruleResults = await runAllRules({
      reader: source,
      officeRecordsConfig: opts.officeRecordsConfig ?? OFFICE_RECORDS_NOT_CONFIGURED,
      fetchImpl: opts.fetchImpl,
      officeRecordsDateRange: opts.officeRecordsDateRange,
    });
    const failedRules = ruleResults.filter((r) => r.error !== null);
    const rawFindings = ruleResults.flatMap((r) => r.findings);

    // Classification (Phase 4A) happens here, deterministically, BEFORE
    // persistence and therefore BEFORE any AI step - see
    // lib/moneymanager/classification/classify.ts's file header for the
    // anti-fabrication rules this ordering enforces.
    const runMetadata: RunMetadata = {
      moneyManagerDataAsOf: await source.dataAsOfDate(),
      officeRecordsConfigured: (opts.officeRecordsConfig ?? OFFICE_RECORDS_NOT_CONFIGURED).configured,
      officeRecordsReportingPeriod: opts.officeRecordsDateRange ?? null,
    };
    const findings = classifyFindings(rawFindings, runMetadata);

    const findingCounts: Record<string, number> = {};
    for (const f of findings) {
      findingCounts[f.severity] = (findingCounts[f.severity] ?? 0) + 1;
    }

    const findingsWithKeys = findings.map((f) => ({ ...f, dedupeKey: findingDedupeKey(f) }));

    await opts.persistence.upsertFindings(runId, opts.userId, findingsWithKeys);
    await opts.persistence.createAlertsForFindings(opts.userId, findingsWithKeys);
    await opts.persistence.recordCheckpoint({
      userId: opts.userId,
      snapshotIdentifier,
      tableCounts: await source.tableCounts(),
      runId,
    });

    const status = failedRules.length > 0 ? 'incomplete' : 'completed';
    const incompleteReason =
      failedRules.length > 0
        ? `${failedRules.length} rule(s) failed to run: ${failedRules
            .map((r) => `${r.ruleId} (${r.error})`)
            .join('; ')}`
        : null;

    await opts.persistence.finishRun({
      runId,
      status,
      finishedAt: now().toISOString(),
      incompleteReason,
      errorMessage: null,
      findingCounts,
    });

    return { runId, status, findings, incompleteReason, errorMessage: null, findingCounts };
  } catch (err) {
    const errorMessage = (err as Error).message;
    await opts.persistence.finishRun({
      runId,
      status: 'failed',
      finishedAt: now().toISOString(),
      incompleteReason: null,
      errorMessage,
      findingCounts: {},
    });
    return {
      runId,
      status: 'failed',
      findings: [],
      incompleteReason: null,
      errorMessage,
      findingCounts: {},
    };
  } finally {
    source.close();
  }
}
