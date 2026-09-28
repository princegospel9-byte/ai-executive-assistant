// In-memory MonitoringPersistence used only by tests, so run.ts's
// orchestration logic (run creation, finding dedup upsert, alert creation,
// checkpointing, status transitions) can be exercised without a real
// Supabase project.
import type { ClassifiedFinding } from '../classification/types';
import type {
  CreateRunInput,
  FinishRunInput,
  MonitoringPersistence,
} from '../persistence/types';

export class FakePersistence implements MonitoringPersistence {
  runs = new Map<string, CreateRunInput & Partial<FinishRunInput>>();
  findingsByDedupeKey = new Map<string, ClassifiedFinding & { dedupeKey: string; seenCount: number }>();
  alertsByDedupeKey = new Map<string, { severity: string }>();
  checkpoints = new Map<string, { tableCounts: Record<string, number>; runId: string }>();
  private nextId = 1;

  async createRun(input: CreateRunInput) {
    const runId = `run-${this.nextId++}`;
    this.runs.set(runId, { ...input });
    return { runId };
  }

  async finishRun(input: FinishRunInput) {
    const existing = this.runs.get(input.runId);
    if (!existing) throw new Error(`finishRun called for unknown runId ${input.runId}`);
    this.runs.set(input.runId, { ...existing, ...input });
  }

  async upsertFindings(runId: string, _userId: string, findings: (ClassifiedFinding & { dedupeKey: string })[]) {
    let insertedCount = 0;
    let updatedCount = 0;
    for (const f of findings) {
      const existing = this.findingsByDedupeKey.get(f.dedupeKey);
      if (existing) {
        this.findingsByDedupeKey.set(f.dedupeKey, { ...f, seenCount: existing.seenCount + 1 });
        updatedCount++;
      } else {
        this.findingsByDedupeKey.set(f.dedupeKey, { ...f, seenCount: 1 });
        insertedCount++;
      }
    }
    return { insertedCount, updatedCount };
  }

  async createAlertsForFindings(_userId: string, findings: (ClassifiedFinding & { dedupeKey: string })[]) {
    let createdCount = 0;
    for (const f of findings) {
      if ((f.severity === 'HIGH' || f.severity === 'CRITICAL') && !this.alertsByDedupeKey.has(f.dedupeKey)) {
        this.alertsByDedupeKey.set(f.dedupeKey, { severity: f.severity });
        createdCount++;
      }
    }
    return { createdCount };
  }

  async recordCheckpoint(input: {
    userId: string;
    snapshotIdentifier: string;
    tableCounts: Record<string, number>;
    runId: string;
  }) {
    this.checkpoints.set(input.snapshotIdentifier, { tableCounts: input.tableCounts, runId: input.runId });
  }
}

export class FailingPersistence extends FakePersistence {
  async upsertFindings(
    runId: string,
    userId: string,
    findings: (ClassifiedFinding & { dedupeKey: string })[]
  ): Promise<{ insertedCount: number; updatedCount: number }> {
    void runId;
    void userId;
    void findings;
    throw new Error('simulated persistence failure during upsertFindings');
  }
}
