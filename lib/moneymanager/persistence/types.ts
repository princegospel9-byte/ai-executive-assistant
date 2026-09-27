// Narrow persistence interface the monitoring orchestrator (lib/moneymanager/
// run.ts) depends on, instead of importing @supabase/supabase-js directly.
// This is what makes the orchestration logic unit-testable without a real
// Supabase project: tests inject an in-memory fake; production code injects
// lib/moneymanager/persistence/supabase.ts.
import type { Finding } from '../rules/types';

export type RunStatus = 'running' | 'completed' | 'incomplete' | 'failed';

export type CreateRunInput = {
  userId: string;
  businessDate: string;
  snapshotIdentifier: string;
  snapshotFileSizeBytes: number;
  snapshotFileModifiedAt: string;
};

export type FinishRunInput = {
  runId: string;
  status: RunStatus;
  finishedAt: string;
  incompleteReason: string | null;
  errorMessage: string | null;
  findingCounts: Record<string, number>;
};

export type UpsertFindingsResult = {
  insertedCount: number;
  updatedCount: number;
};

export interface MonitoringPersistence {
  createRun(input: CreateRunInput): Promise<{ runId: string }>;
  finishRun(input: FinishRunInput): Promise<void>;
  /** Upserts findings keyed by their dedupe_key (see lib/moneymanager/dedupe.ts).
   * Must be idempotent: calling this twice with identical findings for the
   * same run must not create duplicate mm_findings rows. */
  upsertFindings(
    runId: string,
    userId: string,
    findings: (Finding & { dedupeKey: string })[]
  ): Promise<UpsertFindingsResult>;
  /** Creates mm_alerts rows for findings at/above the alert threshold that
   * don't already have an alert (keyed by the same dedupe_key). */
  createAlertsForFindings(
    userId: string,
    findings: (Finding & { dedupeKey: string })[]
  ): Promise<{ createdCount: number }>;
  /** Records/updates the sync checkpoint for this snapshot identifier so a
   * future run can tell whether the snapshot changed. */
  recordCheckpoint(input: {
    userId: string;
    snapshotIdentifier: string;
    tableCounts: Record<string, number>;
    runId: string;
  }): Promise<void>;
}
