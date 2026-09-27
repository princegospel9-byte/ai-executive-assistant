// CLI entry point to run MoneyManager monitoring locally, with no n8n
// involved. Usage:
//   npx tsx scripts/mm-monitor.ts --snapshot "C:\path\to\snapshot.sqlite3" --user-id <uuid> [--business-date 2026-09-22] [--dry-run]
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
// environment unless --dry-run is passed, in which case findings are only
// printed to stdout and nothing is written to Supabase.
import { runMonitoring } from '../lib/moneymanager/run';
import { SnapshotIncompleteError, SnapshotReader } from '../lib/moneymanager/client/snapshot';
import { runAllRules } from '../lib/moneymanager/rules';
import { findingDedupeKey } from '../lib/moneymanager/dedupe';
import { SupabaseMonitoringPersistence } from '../lib/moneymanager/persistence/supabase';
import { loadOfficeRecordsConfig } from '../lib/moneymanager/office-records/config';
import { createServiceClient } from '../lib/supabase/service';

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshotPath = args['snapshot'] as string | undefined;
  const dryRun = Boolean(args['dry-run']);

  if (!snapshotPath) {
    console.error('Usage: mm-monitor --snapshot <path> [--user-id <uuid>] [--business-date YYYY-MM-DD] [--dry-run]');
    process.exit(1);
  }

  if (dryRun) {
    let reader: SnapshotReader;
    try {
      reader = SnapshotReader.open(snapshotPath);
    } catch (err) {
      if (err instanceof SnapshotIncompleteError) {
        console.error(`INCOMPLETE: ${err.reason}`);
        process.exit(2);
      }
      throw err;
    }
    // Dry run never touches Supabase, so Office Records comparison is
    // always reported as "not configured" here even if a real config
    // exists - there's no credential-free way to read it in dry-run mode.
    const results = await runAllRules({ reader });
    reader.close();

    const findings = results.flatMap((r) => r.findings);
    const failed = results.filter((r) => r.error);
    console.log(`Rules run: ${results.length}, failed: ${failed.length}`);
    for (const f of failed) console.error(`  RULE ERROR [${f.ruleId}]: ${f.error}`);
    console.log(`Findings: ${findings.length}`);
    for (const f of findings) {
      console.log(
        `  [${f.severity}] ${f.ruleId} ${f.findingType} ${f.entityType}#${f.entityId} (${f.businessDate}) dedupe=${findingDedupeKey(f).slice(0, 8)}`
      );
    }
    return;
  }

  const userId = args['user-id'] as string | undefined;
  if (!userId) {
    console.error('--user-id is required unless --dry-run is passed.');
    process.exit(1);
  }

  const supabase = createServiceClient();
  const persistence = new SupabaseMonitoringPersistence(supabase);
  const officeRecordsConfig = await loadOfficeRecordsConfig(supabase, userId);
  const result = await runMonitoring({
    snapshotPath,
    userId,
    persistence,
    businessDate: args['business-date'] as string | undefined,
    officeRecordsConfig,
  });

  console.log(`Run ${result.runId}: ${result.status}`);
  if (result.incompleteReason) console.log(`Incomplete reason: ${result.incompleteReason}`);
  if (result.errorMessage) console.log(`Error: ${result.errorMessage}`);
  console.log(`Findings: ${result.findings.length}`, result.findingCounts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
