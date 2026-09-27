// Builds a small, disposable sqlite file whose schema mirrors the real
// MoneyManager snapshot (same tables/columns SnapshotReader depends on,
// per lib/moneymanager/client/types.ts EXPECTED_SCHEMA) so rule tests run
// in milliseconds instead of against the real 263MB backup. The real
// snapshot's actual structure was inspected once (read-only) to derive
// this - see documentation/moneymanager-monitoring.md.
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCHEMA_SQL = `
create table branches (id integer primary key, code text, name text);

create table gl_accounts (
  id integer primary key, branch_id integer, account_code text, account_name text,
  category text, balance_minor integer
);

create table customer_accounts (
  id integer primary key, branch_id integer, customer_id integer, account_no text,
  account_name text, account_type text, current_balance_minor integer,
  account_status text, dormant integer
);

create table customer_ledger_entries (
  id integer primary key, branch_id integer, customer_account_id integer,
  entry_date text, receipt_no text, ref_no text, details text,
  dr_minor integer, cr_minor integer, balance_minor integer, tag text,
  batch_no text, voided_at text
);

create table ledger_entries (
  id integer primary key, branch_id integer, entry_date text, ref_no text,
  details text, gl_account_id integer, dr_minor integer, cr_minor integer,
  tag text, batch_no text, source text, customer_ledger_entry_id integer
);

create table withdrawal_records (
  customer_ledger_entry_id integer primary key, branch_id integer,
  customer_account_id integer, machine_balance_before_minor integer,
  amount_minor integer, commission_minor integer, balance_after_minor integer,
  passbook_balance_minor integer, passbook_difference_minor integer, recorded_at text
);

create table vouchers (id integer primary key, branch_id integer, voucher_no text, voucher_date text, status text);

create table voucher_lines (id integer primary key, voucher_id integer, gl_account_id integer, dr_minor integer, cr_minor integer);

create table loans (id integer primary key, loan_ref text, customer_account_id integer, principal_minor integer, status text);

create table zones (id integer primary key, branch_id integer, name text);

create table customers (id integer primary key, branch_id integer, full_name text, zone_id integer);

create table field_survey_checks (
  id integer primary key, customer_account_id integer, worker_id integer, surveyed_at text,
  passbook_balance_minor integer, system_balance_minor integer, difference_minor integer, status text
);

create table passbook_checks (
  id integer primary key, customer_account_id integer, checked_at text,
  passbook_balance_minor integer, system_balance_minor integer, difference_minor integer, status text
);

create table investments (id integer primary key, investment_ref text, customer_account_id integer, principal_minor integer, status text);
`;

export type FixtureDb = {
  path: string;
  close: () => void;
};

/** Creates a fresh fixture sqlite file, applies the base schema, runs
 * seedFn against a write handle, then closes it and hands back the path -
 * so nothing holds a write lock while a test's SnapshotReader opens the
 * same path read-only afterward. */
export function buildFixtureDb(seedFn: (db: DatabaseSync) => void): FixtureDb {
  const dir = mkdtempSync(join(tmpdir(), 'mm-fixture-'));
  const path = join(dir, 'snapshot.sqlite3');
  const db = new DatabaseSync(path);
  db.exec(SCHEMA_SQL);
  seedFn(db);
  db.close();

  return {
    path,
    close: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
