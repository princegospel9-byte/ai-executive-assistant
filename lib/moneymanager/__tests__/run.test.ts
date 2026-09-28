import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { runMonitoring } from '../run';
import { buildFixtureDb, type FixtureDb } from './fixtureDb';
import { FailingPersistence, FakePersistence } from './fakePersistence';

let fixture: FixtureDb | undefined;

afterEach(() => {
  fixture?.close();
  fixture = undefined;
});

function seedCleanData(db: DatabaseSync) {
  db.exec(`insert into branches values (1, 'JACOL', 'Jacol Susu Enterprise')`);
  db.exec(`insert into gl_accounts values (1, 1, '10001', 'Vault', 'ASSET', 500)`);
  db.exec(`insert into gl_accounts values (2, 1, '20003', 'Savings Control', 'LIABILITY', 500)`);
  db.exec(
    `insert into customer_accounts values (1, 1, 1, '1000000001', 'A B', 'Random', 500, 'ACTIVE', 0)`
  );
  db.exec(
    `insert into customer_ledger_entries values
     (1, 1, 1, '2026-09-01', 'RCT-0001', 'r1', 'DEPOSIT', 0, 500, 500, 'DEPOSIT', 'b1', null)`
  );
  db.exec(
    `insert into ledger_entries values
     (1, 1, '2026-09-01', 'r1', 'Collection', 1, 500, 0, null, 'b1', 'DEPOSIT', 1)`
  );
  db.exec(
    `insert into ledger_entries values
     (2, 1, '2026-09-01', 'r1', 'Collection', 2, 0, 500, null, 'b1', 'DEPOSIT', 1)`
  );
}

const USER_ID = '00000000-0000-0000-0000-000000000001';

describe('runMonitoring - happy path', () => {
  it('marks the run completed and records only the always-emit summary finding for clean data', async () => {
    fixture = buildFixtureDb(seedCleanData);
    const persistence = new FakePersistence();

    const result = await runMonitoring({
      snapshotPath: fixture.path,
      userId: USER_ID,
      persistence,
      businessDate: '2026-09-27',
    });

    assert.strictEqual(result.status, 'completed');
    // mm.office_records_comparison.v1 always emits one finding, even when
    // clean/unconfigured - every other rule stays silent. runMonitoring
    // defaults officeRecordsConfig to "not configured" when the caller
    // (like this test) doesn't supply one, so the finding here is the
    // NOT_CONFIGURED variant, not a real comparison result - and the run
    // still completes normally (partial-incomplete, not whole-run).
    assert.strictEqual(result.findings.length, 1);
    assert.strictEqual(result.findings[0].findingType, 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_NOT_CONFIGURED');
    assert.strictEqual(persistence.runs.get(result.runId)?.status, 'completed');
    assert.strictEqual(persistence.checkpoints.size, 1);
  });
});

describe('runMonitoring - incomplete/missing snapshot', () => {
  it('marks the run incomplete (never a false clean) when the snapshot file does not exist', async () => {
    const persistence = new FakePersistence();

    const result = await runMonitoring({
      snapshotPath: 'C:/does/not/exist/missing.sqlite3',
      userId: USER_ID,
      persistence,
      businessDate: '2026-09-27',
    });

    assert.strictEqual(result.status, 'incomplete');
    assert.ok(result.incompleteReason);
    assert.deepStrictEqual(result.findings, []);
    // The run row itself must exist and say 'incomplete', not silently vanish.
    assert.strictEqual(persistence.runs.get(result.runId)?.status, 'incomplete');
  });

  it('marks the run incomplete when a required table is missing from the snapshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-bad-'));
    const path = join(dir, 'bad.sqlite3');
    const db = new DatabaseSync(path);
    db.exec('create table branches (id integer primary key, code text, name text)');
    db.close();

    const persistence = new FakePersistence();
    const result = await runMonitoring({
      snapshotPath: path,
      userId: USER_ID,
      persistence,
      businessDate: '2026-09-27',
    });

    assert.strictEqual(result.status, 'incomplete');
    assert.ok(result.incompleteReason?.includes('missing tables'));
    rmSync(dir, { recursive: true, force: true });
  });

  it('marks the run incomplete (not a false-clean result) when field_survey_checks/passbook_checks are missing', async () => {
    // A snapshot with every other table but missing the field survey /
    // passbook check tables must fail loudly (schema validation), not
    // quietly produce a clean-looking result as if that were genuine.
    const dir = mkdtempSync(join(tmpdir(), 'mm-no-office-records-'));
    const path = join(dir, 'partial.sqlite3');
    const db = new DatabaseSync(path);
    db.exec(`create table branches (id integer primary key, code text, name text)`);
    db.exec(
      `create table gl_accounts (id integer primary key, branch_id integer, account_code text, account_name text, category text, balance_minor integer)`
    );
    db.exec(
      `create table customer_accounts (id integer primary key, branch_id integer, customer_id integer, account_no text, account_name text, account_type text, current_balance_minor integer, account_status text, dormant integer)`
    );
    db.exec(
      `create table customer_ledger_entries (id integer primary key, branch_id integer, customer_account_id integer, entry_date text, receipt_no text, ref_no text, details text, dr_minor integer, cr_minor integer, balance_minor integer, tag text, batch_no text, voided_at text)`
    );
    db.exec(
      `create table ledger_entries (id integer primary key, branch_id integer, entry_date text, ref_no text, details text, gl_account_id integer, dr_minor integer, cr_minor integer, tag text, batch_no text, source text, customer_ledger_entry_id integer)`
    );
    db.exec(
      `create table withdrawal_records (customer_ledger_entry_id integer primary key, branch_id integer, customer_account_id integer, machine_balance_before_minor integer, amount_minor integer, commission_minor integer, balance_after_minor integer, passbook_balance_minor integer, passbook_difference_minor integer, recorded_at text)`
    );
    db.exec(`create table vouchers (id integer primary key, branch_id integer, voucher_no text, voucher_date text, status text)`);
    db.exec(`create table voucher_lines (id integer primary key, voucher_id integer, gl_account_id integer, dr_minor integer, cr_minor integer)`);
    db.exec(`create table loans (id integer primary key, loan_ref text, customer_account_id integer, principal_minor integer, status text)`);
    db.exec(`create table investments (id integer primary key, investment_ref text, customer_account_id integer, principal_minor integer, status text)`);
    // field_survey_checks and passbook_checks intentionally omitted.
    db.close();

    const persistence = new FakePersistence();
    const result = await runMonitoring({
      snapshotPath: path,
      userId: USER_ID,
      persistence,
      businessDate: '2026-09-27',
    });

    assert.strictEqual(result.status, 'incomplete');
    assert.ok(result.incompleteReason?.includes('field_survey_checks'));
    assert.deepStrictEqual(result.findings, []);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('runMonitoring - failure path', () => {
  it('marks the run failed and records the error when persistence throws', async () => {
    fixture = buildFixtureDb(seedCleanData);
    const persistence = new FailingPersistence();

    const result = await runMonitoring({
      snapshotPath: fixture.path,
      userId: USER_ID,
      persistence,
      businessDate: '2026-09-27',
    });

    assert.strictEqual(result.status, 'failed');
    assert.ok(result.errorMessage?.includes('simulated persistence failure'));
    assert.strictEqual(persistence.runs.get(result.runId)?.status, 'failed');
  });
});

describe('runMonitoring - deduplication', () => {
  it('re-running against the same unchanged snapshot does not duplicate findings', async () => {
    fixture = buildFixtureDb((db) => {
      seedCleanData(db);
      db.exec(`update customer_accounts set current_balance_minor = 999 where id = 1`);
    });
    const persistence = new FakePersistence();

    const run1 = await runMonitoring({
      snapshotPath: fixture.path,
      userId: USER_ID,
      persistence,
      businessDate: '2026-09-27',
    });
    assert.ok(run1.findings.length > 0);

    const run2 = await runMonitoring({
      snapshotPath: fixture.path,
      userId: USER_ID,
      persistence,
      businessDate: '2026-09-27',
    });

    assert.strictEqual(run2.findings.length, run1.findings.length);
    // Same dedupe keys were upserted twice, not inserted as new rows -
    // the fake store still only has one entry per unique finding.
    assert.strictEqual(persistence.findingsByDedupeKey.size, run1.findings.length);
    for (const entry of persistence.findingsByDedupeKey.values()) {
      assert.strictEqual(entry.seenCount, 2);
    }
  });
});

describe('runMonitoring - Phase 4A classification integration', () => {
  it('classifies every finding before persisting it, using this run\'s own snapshot as moneyManagerDataAsOf', async () => {
    fixture = buildFixtureDb((db) => {
      seedCleanData(db);
      db.exec(`update customer_accounts set current_balance_minor = 999 where id = 1`);
    });
    const persistence = new FakePersistence();

    const result = await runMonitoring({
      snapshotPath: fixture.path,
      userId: USER_ID,
      persistence,
      businessDate: '2026-09-27',
    });

    assert.ok(result.findings.length > 0);
    const balanceMismatch = result.findings.find((f) => f.findingType === 'BALANCE_MISMATCH');
    assert.ok(balanceMismatch);
    assert.strictEqual(balanceMismatch.classification, 'CONFIRMED_DISCREPANCY');

    // "The AI cannot override a deterministic classification" - the
    // practical, verifiable form of that guarantee in this codebase:
    // nothing exists between classify.ts running and persistence writing
    // the row that could change the classification value. This asserts
    // the value actually persisted (via the fake store, standing in for
    // Supabase) is bit-for-bit what was returned to the caller before any
    // persistence or downstream step touched it - there is no AI call
    // anywhere in this path (classification happens synchronously inside
    // runMonitoring, before any network/AI call could occur), and no code
    // path writes to a finding's classification field except
    // classifyFindings() itself (grep-verified: classification is only
    // ever assigned in lib/moneymanager/classification/classify.ts).
    const persisted = [...persistence.findingsByDedupeKey.values()].find((f) => f.findingType === 'BALANCE_MISMATCH');
    assert.strictEqual(persisted?.classification, balanceMismatch.classification);
    assert.strictEqual(persisted?.classificationReason, balanceMismatch.classificationReason);
  });

  it('threads moneyManagerDataAsOf from the actual snapshot data into classification, not a hardcoded/guessed date', async () => {
    fixture = buildFixtureDb((db) => {
      db.exec(`insert into branches values (1, 'JACOL', 'Jacol Susu Enterprise')`);
      db.exec(`insert into zones values (1, 1, 'ZONE A')`);
      db.exec(`insert into customers values (1, 1, 'Kwame Mensah', 1)`);
      db.exec(`insert into customer_accounts values (1, 1, 1, '1000000001', 'A B', 'Random', 500, 'ACTIVE', 0)`);
      // Snapshot's own latest data is 2026-09-10 - well before the
      // office-records date range used below.
      db.exec(
        `insert into customer_ledger_entries values
         (1, 1, 1, '2026-09-10', 'RCT-0001', 'r1', 'DEPOSIT', 0, 10000, 10000, 'DEPOSIT', 'b1', null)`
      );
    });
    const persistence = new FakePersistence();

    // A fast, non-retried failure (a genuine HTTP status error skips the
    // retry schedule entirely - see fetch.ts's isNonTransientConfigError)
    // so this test doesn't wait through real retry delays. This test only
    // cares that moneyManagerDataAsOf reaches the classified finding's
    // evidence, not that the comparison itself succeeds.
    const fetchImpl = (async () => ({ ok: false, status: 403, text: async () => '' }) as unknown as Response) as unknown as typeof fetch;

    const result = await runMonitoring({
      snapshotPath: fixture.path,
      userId: USER_ID,
      persistence,
      businessDate: '2026-09-27',
      officeRecordsConfig: {
        configured: true,
        urls: {
          zoneA: 'https://docs.google.com/spreadsheets/d/FAKE_A/edit',
          zoneB: 'https://docs.google.com/spreadsheets/d/FAKE_B/edit',
          zoneC: 'https://docs.google.com/spreadsheets/d/FAKE_C/edit',
          zoneD: 'https://docs.google.com/spreadsheets/d/FAKE_D/edit',
          zoneE: 'https://docs.google.com/spreadsheets/d/FAKE_E/edit',
          masterWorkbook: 'https://docs.google.com/spreadsheets/d/FAKE_MASTER/edit',
        },
      },
      officeRecordsDateRange: { dateFrom: '2026-09-15', dateTo: '2026-09-15' },
      fetchImpl,
    });

    // The fetch fails fast (HTTP 403), so officeRecordsComparisonRule
    // returns its UNAVAILABLE finding - that's fine, this test only cares
    // that moneyManagerDataAsOf, computed from the real snapshot
    // (2026-09-10), reached the finding's evidence.sourceContext.
    const officeFinding = result.findings.find((f) => f.ruleId === 'mm.office_records_comparison.v1');
    assert.ok(officeFinding);
    const sourceContext = (officeFinding.evidence as { sourceContext?: { moneyManagerDataAsOf: string | null } }).sourceContext;
    assert.strictEqual(sourceContext?.moneyManagerDataAsOf, '2026-09-10');
  });
});
