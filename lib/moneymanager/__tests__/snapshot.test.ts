import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SnapshotIncompleteError, SnapshotReader } from '../client/snapshot';
import { buildFixtureDb } from './fixtureDb';

describe('SnapshotReader fail-safe behavior', () => {
  it('throws SnapshotIncompleteError for a nonexistent file rather than returning empty data', () => {
    assert.throws(() => SnapshotReader.open('C:/does/not/exist/nope.sqlite3'), SnapshotIncompleteError);
  });

  it('throws SnapshotIncompleteError when a required table is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-bad-fixture-'));
    const path = join(dir, 'bad.sqlite3');
    const db = new DatabaseSync(path);
    db.exec('create table branches (id integer primary key, code text, name text)');
    // gl_accounts, customer_accounts, etc. deliberately missing.
    db.close();

    let error: unknown;
    try {
      SnapshotReader.open(path);
    } catch (e) {
      error = e;
    }
    assert.ok(error instanceof SnapshotIncompleteError);
    assert.ok((error as SnapshotIncompleteError).reason.includes('missing tables'));
  });

  it('throws SnapshotIncompleteError when a required column is missing', () => {
    const fixture = buildFixtureDb((db) => {
      // Drop a column customer_ledger_entries depends on by recreating the table without it.
      db.exec('drop table customer_ledger_entries');
      db.exec(
        `create table customer_ledger_entries (
           id integer primary key, branch_id integer, customer_account_id integer,
           entry_date text, receipt_no text, ref_no text, details text,
           dr_minor integer, cr_minor integer, balance_minor integer, tag text, batch_no text
           -- voided_at column intentionally omitted
         )`
      );
    });

    let error: unknown;
    try {
      SnapshotReader.open(fixture.path);
    } catch (e) {
      error = e;
    }
    fixture.close();

    assert.ok(error instanceof SnapshotIncompleteError);
    assert.ok((error as SnapshotIncompleteError).reason.includes('customer_ledger_entries.voided_at'));
  });

  it('opens successfully and reports table counts when the schema is complete', () => {
    const fixture = buildFixtureDb((db) => {
      db.exec(`insert into branches values (1, 'JACOL', 'Jacol Susu Enterprise')`);
    });

    const reader = SnapshotReader.open(fixture.path);
    const counts = reader.tableCounts();
    reader.close();
    fixture.close();

    assert.strictEqual(counts.branches, 1);
    assert.strictEqual(counts.customer_accounts, 0);
  });
});

describe('SnapshotReader.dataAsOfDate (Phase 4A - the source-agnostic "as of" date classify.ts depends on)', () => {
  it('returns the latest plausible entry_date across customer_ledger_entries', () => {
    const fixture = buildFixtureDb((db) => {
      db.exec(`insert into branches values (1, 'JACOL', 'Jacol Susu Enterprise')`);
      db.exec(`insert into customer_accounts values (1, 1, 1, '1000000001', 'A B', 'Random', 500, 'ACTIVE', 0)`);
      db.exec(
        `insert into customer_ledger_entries values
         (1, 1, 1, '2026-09-10', 'RCT-0001', 'r1', 'DEPOSIT', 0, 100, 100, 'DEPOSIT', 'b1', null)`
      );
      db.exec(
        `insert into customer_ledger_entries values
         (2, 1, 1, '2026-09-22', 'RCT-0002', 'r2', 'DEPOSIT', 0, 100, 200, 'DEPOSIT', 'b2', null)`
      );
      db.exec(
        `insert into customer_ledger_entries values
         (3, 1, 1, '2026-09-15', 'RCT-0003', 'r3', 'DEPOSIT', 0, 100, 300, 'DEPOSIT', 'b3', null)`
      );
    });
    const reader = SnapshotReader.open(fixture.path);
    const asOf = reader.dataAsOfDate();
    reader.close();
    fixture.close();

    assert.strictEqual(asOf, '2026-09-22');
  });

  it('excludes implausible/corrupted dates rather than letting one poison the result (real snapshot has one exactly like this: "0202-03-06")', () => {
    const fixture = buildFixtureDb((db) => {
      db.exec(`insert into branches values (1, 'JACOL', 'Jacol Susu Enterprise')`);
      db.exec(`insert into customer_accounts values (1, 1, 1, '1000000001', 'A B', 'Random', 500, 'ACTIVE', 0)`);
      db.exec(
        `insert into customer_ledger_entries values
         (1, 1, 1, '2026-09-15', 'RCT-0001', 'r1', 'DEPOSIT', 0, 100, 100, 'DEPOSIT', 'b1', null)`
      );
      // A corrupted future-looking date that would otherwise sort as the
      // "latest" by plain string ordering - must be excluded.
      db.exec(
        `insert into customer_ledger_entries values
         (2, 1, 1, '9999-01-01', 'RCT-0002', 'r2', 'DEPOSIT', 0, 100, 200, 'DEPOSIT', 'b2', null)`
      );
    });
    const reader = SnapshotReader.open(fixture.path);
    const asOf = reader.dataAsOfDate();
    reader.close();
    fixture.close();

    assert.strictEqual(asOf, '2026-09-15');
  });

  it('returns null (never a best-guess date) when there is no plausible date at all', () => {
    const fixture = buildFixtureDb((db) => {
      db.exec(`insert into branches values (1, 'JACOL', 'Jacol Susu Enterprise')`);
      db.exec(`insert into customer_accounts values (1, 1, 1, '1000000001', 'A B', 'Random', 500, 'ACTIVE', 0)`);
      db.exec(
        `insert into customer_ledger_entries values
         (1, 1, 1, '0202-03-06', 'RCT-0001', 'r1', 'DEPOSIT', 0, 100, 100, 'DEPOSIT', 'b1', null)`
      );
    });
    const reader = SnapshotReader.open(fixture.path);
    const asOf = reader.dataAsOfDate();
    reader.close();
    fixture.close();

    assert.strictEqual(asOf, null);
  });

  it('returns null when customer_ledger_entries is empty', () => {
    const fixture = buildFixtureDb((db) => {
      db.exec(`insert into branches values (1, 'JACOL', 'Jacol Susu Enterprise')`);
    });
    const reader = SnapshotReader.open(fixture.path);
    const asOf = reader.dataAsOfDate();
    reader.close();
    fixture.close();

    assert.strictEqual(asOf, null);
  });
});
