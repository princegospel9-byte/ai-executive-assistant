// CLI entry point for the Daily Business Operations Report (MVP V1) - the
// "VPS scheduler" leg of the target architecture:
//   VPS scheduler -> KBrisks Agent -> Daily Report -> notification adapter
// This file owns ONLY argv parsing, wiring up concrete implementations
// (Supabase persistence, the n8n webhook notification adapter), and stdout -
// all actual orchestration lives in lib/moneymanager/runDailyReport.ts's
// runDailyBusinessOperationsReport(), which knows nothing about argv, n8n,
// or this being a CLI. A future entry point (an n8n-triggered handler, a
// different scheduler) calls that same function with a different
// NotificationSender (lib/moneymanager/notify/types.ts) instead of
// duplicating this file's logic.
//
// Usage:
//   npx tsx scripts/mm-daily-report.ts --snapshot "C:\path\to\snapshot.sqlite3" --dry-run
//   npx tsx scripts/mm-daily-report.ts --snapshot "C:\path\to\snapshot.sqlite3" --user-id <uuid> [--business-date 2026-09-28] [--no-send]
//
// --dry-run: runs the 11 rules + classification straight off the snapshot,
//   prints the full report to stdout, never touches Supabase or n8n (same
//   safety convention as scripts/mm-monitor.ts's --dry-run - Office Records
//   is always reported "not configured" here since there's no credential-
//   free way to load the real config). Deliberately NOT routed through
//   runDailyBusinessOperationsReport(), which always persists via
//   runMonitoring() - dry-run's entire point is to persist nothing.
// --user-id: real run via runDailyBusinessOperationsReport() - persists to
//   mm_monitoring_runs/mm_findings/mm_alerts exactly like scripts/mm-monitor.ts,
//   then (unless --no-send) sends via N8nWebhookNotificationSender.
//
// Exit codes (checked by a VPS scheduler/cron/systemd unit, not this script
// itself - see EXIT_CODES below): 0 only when the monitoring run completed
// AND (no send was required OR the send succeeded); 1 invalid usage; 2 the
// snapshot couldn't be opened at all (--dry-run only - a real run folds this
// into the monitoring run's own 'incomplete' status, handled by 4 below,
// since runMonitoring() doesn't expose a separate discriminator for it and
// this task intentionally does not change monitoring internals to add one);
// 3 the monitoring run completed but the required notification send failed;
// 4 the monitoring run itself was 'incomplete' or 'failed'; 5 a concurrent
// run for the same user/business date was already in progress and this
// invocation was blocked (see the lock in acquireRunLock() below).
//
// Logging: this script only ever writes to stdout/stderr via console.*, by
// design (no logging framework added). A VPS scheduler is expected to
// redirect both streams to a persistent log file
// (e.g. `>> /var/log/kbrisks/mm-daily-report.log 2>&1` in the cron entry, or
// StandardOutput=append:... in a systemd unit) - this script does not do
// that itself.
import { existsSync, mkdirSync, openSync, closeSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SnapshotIncompleteError, SnapshotReader } from '../lib/moneymanager/client/snapshot';
import { runAllRules } from '../lib/moneymanager/rules';
import { classifyFindings } from '../lib/moneymanager/classification/classify';
import { SupabaseMonitoringPersistence } from '../lib/moneymanager/persistence/supabase';
import { loadOfficeRecordsConfig, OFFICE_RECORDS_NOT_CONFIGURED } from '../lib/moneymanager/office-records/config';
import { createServiceClient } from '../lib/supabase/service';
import { buildDailyReport } from '../lib/moneymanager/report/dailyReport';
import { formatFullReportText, formatConciseReportMessage, severityForNotification } from '../lib/moneymanager/report/formatReportMessage';
import { runDailyBusinessOperationsReport } from '../lib/moneymanager/runDailyReport';
import { N8nWebhookNotificationSender } from '../lib/moneymanager/notify/n8nWebhookSender';

export const EXIT_CODES = {
  SUCCESS: 0,
  INVALID_USAGE: 1,
  SNAPSHOT_READ_FAILURE: 2,
  NOTIFICATION_FAILURE: 3,
  MONITORING_INCOMPLETE_OR_FAILED: 4,
  DUPLICATE_RUN_BLOCKED: 5,
} as const;

/** Pure decision logic for the real-run exit code - success (0) requires
 * BOTH the monitoring run having completed AND (no send being required OR
 * the send having succeeded). Monitoring failure takes priority over a send
 * failure when both are true, since it's the more fundamental problem. */
export function decideExitCode(input: { monitoringOk: boolean; sendRequired: boolean; sent: boolean }): number {
  if (!input.monitoringOk) return EXIT_CODES.MONITORING_INCOMPLETE_OR_FAILED;
  if (input.sendRequired && !input.sent) return EXIT_CODES.NOTIFICATION_FAILURE;
  return EXIT_CODES.SUCCESS;
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

// Duplicate-run protection (MVP V1) - deliberately NOT a new Supabase table
// or a change to mm_monitoring_runs: that table's `status` column can't
// safely distinguish "the notification was actually sent" from "monitoring
// completed" (a --no-send run's row looks identical to a sent one), so
// reusing it for this would risk a false "already sent" skip. A VPS
// scheduler is a single process on a single host, so a small local
// filesystem lock/marker is sufficient and needs no migration. Both are
// scoped per (userId, businessDate) - a different user or a different day
// is never affected. Overridable via MM_DAILY_REPORT_STATE_DIR for a VPS
// deployment where this repo's own directory isn't where persistent state
// should live (e.g. a separate data volume).
export const STATE_DIR =
  process.env.MM_DAILY_REPORT_STATE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '.mm-daily-report-state');

function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

function lockPath(userId: string, businessDate: string): string {
  return join(STATE_DIR, `run-${userId}-${businessDate}.lock`);
}

function sentMarkerPath(userId: string, businessDate: string): string {
  return join(STATE_DIR, `sent-${userId}-${businessDate}.json`);
}

/** Already successfully sent for this exact (userId, businessDate)? A prior
 * FAILED run, or one run with --no-send, never creates this marker, so
 * neither ever blocks a later retry - only a run that both completed AND
 * sent does. A corrupted/unreadable marker is treated as "not sent" rather
 * than permanently blocking every future run for that date. */
export function alreadySent(userId: string, businessDate: string): { runId: string; sentAt: string } | null {
  const path = sentMarkerPath(userId, businessDate);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function markSent(userId: string, businessDate: string, runId: string): void {
  ensureStateDir();
  writeFileSync(sentMarkerPath(userId, businessDate), JSON.stringify({ runId, sentAt: new Date().toISOString() }), 'utf8');
}

/** Exclusive lock for one (userId, businessDate) pair - prevents two
 * concurrent invocations (e.g. an overlapping cron misfire) from both
 * processing/sending at once. `wx` fails if the file already exists, which
 * is atomic at the OS level (unlike a separate check-then-write). Always
 * released in main()'s `finally`, including after a failure - this is a
 * mutex, not a "done" marker (see markSent/alreadySent above for that
 * separate concern), so a failed run remains retryable immediately after. */
export function acquireRunLock(userId: string, businessDate: string): boolean {
  ensureStateDir();
  try {
    const fd = openSync(lockPath(userId, businessDate), 'wx');
    closeSync(fd);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

export function releaseRunLock(userId: string, businessDate: string): void {
  const path = lockPath(userId, businessDate);
  if (existsSync(path)) unlinkSync(path);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshotPath = args['snapshot'] as string | undefined;
  const dryRun = Boolean(args['dry-run']);
  const businessDate = args['business-date'] as string | undefined;

  if (!snapshotPath) {
    console.error('Usage: mm-daily-report --snapshot <path> [--user-id <uuid>] [--business-date YYYY-MM-DD] [--dry-run] [--no-send]');
    process.exit(EXIT_CODES.INVALID_USAGE);
  }

  if (dryRun) {
    let reader: SnapshotReader;
    try {
      reader = SnapshotReader.open(snapshotPath);
    } catch (err) {
      if (err instanceof SnapshotIncompleteError) {
        console.error(`INCOMPLETE: ${err.reason}`);
        process.exit(EXIT_CODES.SNAPSHOT_READ_FAILURE);
      }
      throw err;
    }

    const ruleResults = await runAllRules({ reader, officeRecordsConfig: OFFICE_RECORDS_NOT_CONFIGURED });
    const rawFindings = ruleResults.flatMap((r) => r.findings);
    const failedRules = ruleResults.filter((r) => r.error);
    const moneyManagerDataAsOf = await reader.dataAsOfDate();
    reader.close();

    const findings = classifyFindings(rawFindings, {
      moneyManagerDataAsOf,
      officeRecordsConfigured: false,
      officeRecordsReportingPeriod: null,
    });

    const report = buildDailyReport(findings, {
      businessDate: businessDate ?? moneyManagerDataAsOf ?? new Date().toISOString().slice(0, 10),
      runId: '(dry-run, not persisted)',
      runStatus: failedRules.length > 0 ? 'incomplete' : 'completed',
      incompleteReason: failedRules.length > 0 ? `${failedRules.length} rule(s) failed: ${failedRules.map((r) => `${r.ruleId} (${r.error})`).join('; ')}` : null,
      errorMessage: null,
      generatedAt: new Date().toISOString(),
    });

    console.log(formatFullReportText(report));
    console.log('\n--- Concise message (would be sent) ---\n');
    console.log(formatConciseReportMessage(report));
    console.log(`\nSeverity for notification: ${severityForNotification(report)}`);
    console.log('\n(--dry-run: nothing was written to Supabase and nothing was sent.)');
    process.exitCode = decideExitCode({ monitoringOk: failedRules.length === 0, sendRequired: false, sent: false });
    return;
  }

  const userId = args['user-id'] as string | undefined;
  if (!userId) {
    console.error('--user-id is required unless --dry-run is passed.');
    process.exit(EXIT_CODES.INVALID_USAGE);
  }

  const send = !args['no-send'];
  const effectiveBusinessDate = businessDate ?? new Date().toISOString().slice(0, 10);

  if (send) {
    const prior = alreadySent(userId, effectiveBusinessDate);
    if (prior) {
      console.log(
        `Daily report for user ${userId}, business date ${effectiveBusinessDate} was already sent at ${prior.sentAt} (run ${prior.runId}). Nothing to do - not re-sending.`
      );
      console.log('(Pass --no-send if you want to regenerate/re-persist the report without this check, or delete the marker file under .mm-daily-report-state/ to force a resend.)');
      process.exitCode = EXIT_CODES.SUCCESS;
      return;
    }
  }

  if (!acquireRunLock(userId, effectiveBusinessDate)) {
    console.error(`Another run for user ${userId}, business date ${effectiveBusinessDate} is already in progress. Blocking this invocation rather than running concurrently.`);
    process.exitCode = EXIT_CODES.DUPLICATE_RUN_BLOCKED;
    return;
  }

  try {
    const supabase = createServiceClient();
    const persistence = new SupabaseMonitoringPersistence(supabase);
    const officeRecordsConfig = await loadOfficeRecordsConfig(supabase, userId);

    const { report, sent, sendError } = await runDailyBusinessOperationsReport({
      snapshotPath,
      userId,
      persistence,
      officeRecordsConfig,
      notificationSender: new N8nWebhookNotificationSender(),
      businessDate: effectiveBusinessDate,
      send,
    });

    console.log(formatFullReportText(report));

    const monitoringOk = report.meta.runStatus === 'completed';
    if (!monitoringOk) {
      console.error(
        `\nMonitoring run status: ${report.meta.runStatus}${report.meta.incompleteReason ? ` - ${report.meta.incompleteReason}` : ''}${report.meta.errorMessage ? ` (${report.meta.errorMessage})` : ''}`
      );
    }

    if (!send) {
      console.log('\n(--no-send: report generated and persisted, nothing sent.)');
      process.exitCode = decideExitCode({ monitoringOk, sendRequired: false, sent: false });
      return;
    }

    if (sent) {
      console.log('\nDaily report sent via n8n Notifications workflow.');
      markSent(userId, effectiveBusinessDate, report.meta.runId);
    } else {
      console.error(`\nFailed to send daily report: ${sendError}`);
    }

    process.exitCode = decideExitCode({ monitoringOk, sendRequired: true, sent });
  } finally {
    releaseRunLock(userId, effectiveBusinessDate);
  }
}

// Guard against side effects on import - this file is imported directly by
// lib/moneymanager/__tests__/dailyReportCli.test.ts to exercise EXIT_CODES/
// decideExitCode/the lock+marker functions above without re-running the
// whole CLI (which would parse the TEST RUNNER's own argv and call
// process.exit). Only actually run main() when this file is the process's
// entry point (tsx scripts/mm-daily-report.ts ...), matching Node's standard
// ESM "is this the entry module" idiom.
const isEntryModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
