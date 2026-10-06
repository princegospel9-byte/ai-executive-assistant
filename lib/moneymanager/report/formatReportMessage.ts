// Deterministic text rendering of a DailyBusinessReport (dailyReport.ts).
// No AI call here - formatting only. Two renderers:
//  - formatFullReportText(): the complete report, every section, every row -
//    for logging/archival/manual review.
//  - formatConciseReportMessage(): a short digest for the actual email/
//    Telegram body sent via the existing "Notifications - Send Notification"
//    n8n workflow (that workflow's own "Build Notification Email" node just
//    wraps whatever `message` string it's given as a plain-text email, and
//    Telegram messages are similarly plain text - long tables don't belong
//    there; the full report stays queryable via mm_findings/mm_monitoring_runs).
import type { ComparisonRow, DailyBusinessReport, ReportSection } from './dailyReport';
import { REPORT_STATUS_LABEL } from './dailyReport';

function money(v: number | null): string {
  if (v === null) return 'n/a';
  return (v / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** For count-based rows (see COUNT_METRIC_FINDING_TYPES in dailyReport.ts) -
 * a plain integer occurrence count, never divided by 100 like a currency
 * value would be. */
function count(v: number | null): string {
  if (v === null) return 'n/a';
  return v.toLocaleString('en-GH');
}

function formatValue(row: ComparisonRow, v: number | null): string {
  return row.valueKind === 'count' ? count(v) : money(v);
}

function pct(v: number | null): string {
  if (v === null) return 'n/a';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function statusLabel(row: ComparisonRow): string {
  return row.status === 'INFO' ? 'INFO' : REPORT_STATUS_LABEL[row.status];
}

function formatRow(row: ComparisonRow): string {
  const unit = row.valueKind === 'count' ? 'occurrences' : 'GHS';
  return (
    `  - [${row.severity}] ${row.label} (${row.businessDate}) — ${row.findingType}\n` +
    `      System/MoneyManager (${unit}): ${formatValue(row, row.systemValue)} | ${row.referenceLabel}: ${formatValue(row, row.referenceValue)} | ` +
    `Diff: ${formatValue(row, row.difference)} | %Diff: ${pct(row.percentDifference)}\n` +
    `      Status: ${statusLabel(row)}\n` +
    `      Follow-up: ${row.recommendedFollowUp}`
  );
}

function formatSection(title: string, section: ReportSection): string {
  const lines = [`## ${title}`];
  if (!section.available) {
    lines.push(`  UNAVAILABLE - ${section.unavailableReason}`);
    return lines.join('\n');
  }
  if (section.rows.length === 0) {
    lines.push('  No discrepancies found.');
    return lines.join('\n');
  }
  for (const row of section.rows) lines.push(formatRow(row));
  return lines.join('\n');
}

/** Full report - every section, every row. Suitable for stdout, a file, or
 * a future dashboard page - not what gets emailed/texted (see
 * formatConciseReportMessage below). */
export function formatFullReportText(report: DailyBusinessReport): string {
  const { meta, executiveSummary: exec } = report;
  const lines: string[] = [];

  lines.push(`# Daily Business Operations Report — ${meta.businessDate}`);
  lines.push(`Run ${meta.runId} (${meta.runStatus}), generated ${meta.generatedAt}`);
  if (meta.incompleteReason) lines.push(`INCOMPLETE: ${meta.incompleteReason}`);
  if (meta.errorMessage) lines.push(`ERROR: ${meta.errorMessage}`);
  lines.push('');

  lines.push('## 1. Executive Summary');
  lines.push(`  Total findings: ${exec.totalFindings}`);
  lines.push(
    `  By severity: CRITICAL ${exec.bySeverity.CRITICAL}, HIGH ${exec.bySeverity.HIGH}, WARNING ${exec.bySeverity.WARNING}, INFO ${exec.bySeverity.INFO}`
  );
  lines.push(
    `  By status: CONFIRMED DIFFERENCE ${exec.byStatus.CONFIRMED_DIFFERENCE}, POSSIBLE/TIMING DIFFERENCE ${exec.byStatus.POSSIBLE_TIMING_DIFFERENCE}, ` +
      `SUSPECTED DATA-ENTRY ISSUE ${exec.byStatus.SUSPECTED_DATA_ENTRY_ISSUE}, UNRESOLVED ${exec.byStatus.UNRESOLVED}`
  );
  lines.push(`  MoneyManager data as of: ${exec.moneyManagerDataAsOf ?? 'unknown'}`);
  lines.push(`  Office Records: ${exec.officeRecordsStatus}`);
  lines.push('');

  lines.push(formatSection('2. Collections', report.collections));
  lines.push('');
  lines.push(formatSection('3. Withdrawals', report.withdrawals));
  lines.push('');
  lines.push(formatSection('4. Deposits/Submissions', report.depositsSubmissions));
  lines.push('');
  lines.push(formatSection('5. Expenses', report.expenses));
  lines.push('');
  lines.push(formatSection('6. Cash Movement', report.cashMovement));
  lines.push('');
  lines.push(formatSection('7. Mobilizer/Collector Activity', report.mobilizerActivity));
  lines.push('');

  lines.push('## 8. Office Records Comparison');
  if (!report.officeRecords.available) {
    lines.push(`  UNAVAILABLE - ${report.officeRecords.unavailableReason}`);
  } else {
    if (report.officeRecords.summaryMessage) lines.push(`  ${report.officeRecords.summaryMessage}`);
    if (report.officeRecords.rows.length === 0) {
      lines.push('  No discrepancies found.');
    } else {
      for (const row of report.officeRecords.rows) lines.push(formatRow(row));
    }
  }
  lines.push('');

  lines.push(formatSection('9. Mismatches/Anomalies', report.mismatchesAnomalies));
  lines.push('');

  lines.push('## 10. Important Issues Requiring Manager Attention');
  if (report.managerAttention.length === 0) {
    lines.push('  None - no HIGH/CRITICAL findings this run.');
  } else {
    for (const row of report.managerAttention) lines.push(formatRow(row));
  }
  lines.push('');

  lines.push('## 11. Recommended Follow-up');
  if (report.recommendedFollowUp.length === 0) {
    lines.push('  None.');
  } else {
    for (const item of report.recommendedFollowUp) lines.push(`  - ${item}`);
  }

  return lines.join('\n');
}

/** Short digest for the actual email/Telegram body - executive summary,
 * Office Records status, and up to 5 highest-severity manager-attention
 * items. Points back to the full report/mm_findings for detail rather than
 * inlining every row, per the request's "concise report/message". */
export function formatConciseReportMessage(report: DailyBusinessReport): string {
  const { meta, executiveSummary: exec } = report;
  const lines: string[] = [];

  lines.push(`Daily Business Operations Report - ${meta.businessDate}`);
  lines.push(`Run status: ${meta.runStatus}${meta.incompleteReason ? ` (${meta.incompleteReason})` : ''}`);
  lines.push(
    `${exec.totalFindings} finding(s): ${exec.byStatus.CONFIRMED_DIFFERENCE} confirmed, ${exec.byStatus.POSSIBLE_TIMING_DIFFERENCE} possible/timing, ` +
      `${exec.byStatus.SUSPECTED_DATA_ENTRY_ISSUE} suspected data-entry, ${exec.byStatus.UNRESOLVED} unresolved.`
  );

  const officeLine =
    exec.officeRecordsStatus === 'not_configured'
      ? 'Office Records: not configured (six Google Sheets URLs missing).'
      : exec.officeRecordsStatus === 'configured_unavailable'
        ? `Office Records: unavailable - ${report.officeRecords.unavailableReason}`
        : `Office Records: compared - ${report.officeRecords.summaryMessage ?? ''}`;
  lines.push(officeLine);

  if (report.managerAttention.length > 0) {
    lines.push('');
    lines.push('Top issues:');
    for (const row of report.managerAttention.slice(0, 5)) {
      lines.push(
        `  - [${row.severity}/${statusLabel(row)}] ${row.label} (${row.businessDate}): ` +
          `System ${formatValue(row, row.systemValue)} vs ${row.referenceLabel} ${formatValue(row, row.referenceValue)}, diff ${formatValue(row, row.difference)}`
      );
    }
  } else {
    lines.push('No HIGH/CRITICAL issues this run.');
  }

  lines.push('');
  lines.push(`Full detail: mm_findings / mm_monitoring_runs, run ${meta.runId}.`);

  return lines.join('\n');
}

/** 'critical' if any manager-attention row is CRITICAL severity or the run
 * itself did not complete cleanly (incomplete/failed - the manager needs to
 * know monitoring itself broke, not just what it found); 'warning' if there
 * are any findings at all; 'info' for a genuinely clean, fully-completed run.
 * Matches the notifications table's severity vocabulary ('info'|'warning'|
 * 'critical' - supabase/migrations/0006_automation_foundation.sql) and the
 * existing Notifications - Send Notification workflow's convention that
 * only warning/critical trigger real email/Telegram delivery. */
export function severityForNotification(report: DailyBusinessReport): 'info' | 'warning' | 'critical' {
  if (report.meta.runStatus !== 'completed') return 'critical';
  if (report.managerAttention.some((r) => r.severity === 'CRITICAL')) return 'critical';
  if (report.executiveSummary.totalFindings > 0) return 'warning';
  return 'info';
}
