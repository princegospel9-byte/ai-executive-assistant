// The "core" of the Daily Business Operations Report (MVP V1) - runnable
// from ANY entry point (today: scripts/mm-daily-report.ts, a VPS-scheduled
// process; later: an n8n-triggered handler, a different scheduler, a test)
// with zero knowledge of where it was called from or how its output gets
// delivered. This is the scheduler/runtime boundary the target architecture
// needs:
//   VPS scheduler -> KBrisks Agent -> Daily Report -> notification adapter
// A future n8n-triggered entry point calls this exact function with a
// different NotificationSender (or the same one) - no orchestration logic
// is duplicated, and this file never imports anything n8n-specific. See
// lib/moneymanager/notify/types.ts for the delivery-side boundary.
import { runMonitoring } from './run';
import type { MoneyManagerSource } from './client/source';
import type { MonitoringPersistence } from './persistence/types';
import type { OfficeRecordsConfigResult } from './office-records/config';
import { buildDailyReport, type DailyBusinessReport } from './report/dailyReport';
import { formatConciseReportMessage, severityForNotification } from './report/formatReportMessage';
import type { NotificationSender } from './notify/types';

type CommonRunDailyReportOptions = {
  userId: string;
  persistence: MonitoringPersistence;
  officeRecordsConfig: OfficeRecordsConfigResult;
  notificationSender: NotificationSender;
  /** Business date this run represents - defaults to today (UTC) if omitted,
   * same as runMonitoring's own default. */
  businessDate?: string;
  /** When false, builds and persists the report but never calls
   * notificationSender.send() - same as the CLI's --no-send flag. */
  send: boolean;
};

// Mirrors runMonitoring's own discriminated union (lib/moneymanager/run.ts) -
// a caller passes EITHER an offline snapshot path OR an already-constructed
// live MoneyManagerSource (e.g. LanApiSource), never both/neither. Kept as a
// separate type here (rather than re-exporting runMonitoring's) so this
// file's public surface documents its own contract independently.
export type RunDailyReportOptions = CommonRunDailyReportOptions &
  (
    | { snapshotPath: string; source?: undefined; sourceIdentifier?: undefined }
    | { source: MoneyManagerSource; sourceIdentifier: string; snapshotPath?: undefined }
  );

export type RunDailyReportResult = {
  report: DailyBusinessReport;
  sent: boolean;
  /** Non-null only when send was true and notificationSender.send() threw -
   * the report itself is still returned/persisted either way, so a delivery
   * failure never looks like "there was nothing to report". */
  sendError: string | null;
};

export async function runDailyBusinessOperationsReport(opts: RunDailyReportOptions): Promise<RunDailyReportResult> {
  const result = await runMonitoring(
    opts.source
      ? {
          source: opts.source,
          sourceIdentifier: opts.sourceIdentifier,
          userId: opts.userId,
          persistence: opts.persistence,
          businessDate: opts.businessDate,
          officeRecordsConfig: opts.officeRecordsConfig,
        }
      : {
          snapshotPath: opts.snapshotPath,
          userId: opts.userId,
          persistence: opts.persistence,
          businessDate: opts.businessDate,
          officeRecordsConfig: opts.officeRecordsConfig,
        }
  );

  const report = buildDailyReport(result.findings, {
    businessDate: opts.businessDate ?? new Date().toISOString().slice(0, 10),
    runId: result.runId,
    runStatus: result.status,
    incompleteReason: result.incompleteReason,
    errorMessage: result.errorMessage,
    generatedAt: new Date().toISOString(),
  });

  if (!opts.send) {
    return { report, sent: false, sendError: null };
  }

  try {
    await opts.notificationSender.send({
      userId: opts.userId,
      title: `Daily Business Operations Report - ${report.meta.businessDate}`,
      message: formatConciseReportMessage(report),
      severity: severityForNotification(report),
    });
    return { report, sent: true, sendError: null };
  } catch (err) {
    return { report, sent: false, sendError: (err as Error).message };
  }
}
