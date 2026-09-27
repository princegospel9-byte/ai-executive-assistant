// Real MonitoringPersistence implementation backed by this repo's existing
// Supabase project (mm_monitoring_runs, mm_findings, mm_alerts,
// mm_sync_checkpoints - see supabase/migrations/0025_mm_monitoring.sql).
// Uses the service-role client (lib/supabase/service.ts) because monitoring
// runs happen outside any signed-in user's request/response cycle (invoked
// by a script or a future n8n workflow) - RLS with auth.uid() has nothing
// to bind to there. Never used from browser code.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Finding } from '../rules/types';
import type {
  CreateRunInput,
  FinishRunInput,
  MonitoringPersistence,
} from './types';

// Findings at or above this severity also get an mm_alerts row.
const ALERT_SEVERITIES = new Set(['HIGH', 'CRITICAL']);

export class SupabaseMonitoringPersistence implements MonitoringPersistence {
  constructor(private readonly client: SupabaseClient) {}

  async createRun(input: CreateRunInput): Promise<{ runId: string }> {
    const { data, error } = await this.client
      .from('mm_monitoring_runs')
      .insert({
        user_id: input.userId,
        status: 'running',
        business_date: input.businessDate,
        snapshot_identifier: input.snapshotIdentifier,
        snapshot_file_size_bytes: input.snapshotFileSizeBytes,
        snapshot_file_modified_at: input.snapshotFileModifiedAt,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create mm_monitoring_runs row: ${error?.message}`);
    }
    return { runId: data.id as string };
  }

  async finishRun(input: FinishRunInput): Promise<void> {
    const { error } = await this.client
      .from('mm_monitoring_runs')
      .update({
        status: input.status,
        finished_at: input.finishedAt,
        incomplete_reason: input.incompleteReason,
        error_message: input.errorMessage,
        finding_counts: input.findingCounts,
      })
      .eq('id', input.runId);

    if (error) {
      throw new Error(`Failed to finish mm_monitoring_runs row ${input.runId}: ${error.message}`);
    }
  }

  async upsertFindings(
    runId: string,
    userId: string,
    findings: (Finding & { dedupeKey: string })[]
  ) {
    if (findings.length === 0) return { insertedCount: 0, updatedCount: 0 };

    const rows = findings.map((f) => ({
      user_id: userId,
      dedupe_key: f.dedupeKey,
      rule_id: f.ruleId,
      finding_type: f.findingType,
      severity: f.severity,
      entity_type: f.entityType,
      entity_id: f.entityId,
      expected_value: f.expectedValue,
      actual_value: f.actualValue,
      variance: f.variance,
      business_date: f.businessDate,
      evidence: f.evidence,
      first_seen_run_id: runId,
      last_seen_run_id: runId,
      last_seen_at: new Date().toISOString(),
    }));

    // on conflict(dedupe_key): keep first_seen_run_id, refresh everything
    // else - see lib/moneymanager/dedupe.ts for why the key excludes the
    // numeric fields.
    const { error } = await this.client
      .from('mm_findings')
      .upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: false });

    if (error) {
      throw new Error(`Failed to upsert mm_findings: ${error.message}`);
    }

    return { insertedCount: rows.length, updatedCount: 0 };
  }

  async createAlertsForFindings(userId: string, findings: (Finding & { dedupeKey: string })[]) {
    const alertable = findings.filter((f) => ALERT_SEVERITIES.has(f.severity));
    if (alertable.length === 0) return { createdCount: 0 };

    const rows = alertable.map((f) => ({
      user_id: userId,
      finding_dedupe_key: f.dedupeKey,
      severity: f.severity,
      title: `${f.findingType} — ${f.entityType} ${f.entityId}`,
      status: 'open',
    }));

    const { error } = await this.client
      .from('mm_alerts')
      .upsert(rows, { onConflict: 'finding_dedupe_key', ignoreDuplicates: true });

    if (error) {
      throw new Error(`Failed to create mm_alerts: ${error.message}`);
    }

    return { createdCount: rows.length };
  }

  async recordCheckpoint(input: {
    userId: string;
    snapshotIdentifier: string;
    tableCounts: Record<string, number>;
    runId: string;
  }): Promise<void> {
    const { error } = await this.client.from('mm_sync_checkpoints').upsert(
      {
        user_id: input.userId,
        snapshot_identifier: input.snapshotIdentifier,
        table_counts: input.tableCounts,
        last_run_id: input.runId,
        checked_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,snapshot_identifier' }
    );

    if (error) {
      throw new Error(`Failed to record mm_sync_checkpoints: ${error.message}`);
    }
  }
}
