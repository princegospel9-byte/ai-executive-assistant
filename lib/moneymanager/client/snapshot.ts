// Read-only adapter over a MoneyManager sqlite snapshot file. Never opens
// the file for writing (readOnly: true, always) and never connects to a
// live MoneyManager server - this is the only supported input.
//
// Fail-safe contract: if an expected table or column is missing, or the
// file can't be opened, this throws SnapshotIncompleteError rather than
// returning empty arrays. Callers (lib/moneymanager/run.ts) MUST catch this
// and mark the monitoring run 'incomplete' - never translate "couldn't
// read" into "found nothing to report".
import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync } from 'node:fs';
import { nextIsoDate } from '../shared/dates';
import type { MoneyManagerSource } from './source';
import {
  EXPECTED_SCHEMA,
  VAULT_ACCOUNT_CODE,
  type Branch,
  type CustomerAccount,
  type FieldSurveyCheck,
  type GlAccount,
  type Investment,
  type Loan,
  type PassbookCheck,
  type WithdrawalRecord,
} from './types';

export class SnapshotIncompleteError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`MoneyManager snapshot incomplete: ${reason}`);
    this.name = 'SnapshotIncompleteError';
    this.reason = reason;
  }
}

export type SnapshotIdentifier = {
  filePath: string;
  fileSizeBytes: number;
  fileModifiedAt: string;
};

// Concrete desktop/offline adapter: reads a manually-exported sqlite
// snapshot file read-only. Implements MoneyManagerSource (lib/moneymanager/
// client/source.ts) so rules depend on that interface, not this class -
// see source.ts for how a future source (e.g. a desktop-LAN or web/VPS
// adapter) would plug in without changing any rule.
export class SnapshotReader implements MoneyManagerSource {
  private db: DatabaseSync;
  readonly identifier: SnapshotIdentifier;

  private constructor(db: DatabaseSync, identifier: SnapshotIdentifier) {
    this.db = db;
    this.identifier = identifier;
  }

  /** Opens the snapshot strictly read-only and validates the schema this
   * adapter depends on exists. Throws SnapshotIncompleteError on any
   * problem - never returns a partially-usable reader. */
  static open(filePath: string): SnapshotReader {
    if (!existsSync(filePath)) {
      throw new SnapshotIncompleteError(`snapshot file not found at ${filePath}`);
    }

    const stat = statSync(filePath);
    let db: DatabaseSync;
    try {
      db = new DatabaseSync(filePath, { readOnly: true });
    } catch (err) {
      throw new SnapshotIncompleteError(
        `could not open snapshot file read-only: ${(err as Error).message}`
      );
    }

    const reader = new SnapshotReader(db, {
      filePath,
      fileSizeBytes: stat.size,
      fileModifiedAt: stat.mtime.toISOString(),
    });

    try {
      reader.validateSchema();
    } catch (err) {
      // Close the handle before rethrowing - otherwise an incomplete
      // snapshot leaves a dangling read lock on the file (observable on
      // Windows as a later delete/rename of the snapshot failing with
      // EPERM) even though the caller only sees a thrown error and never
      // gets a reader to call .close() on themselves.
      db.close();
      throw err;
    }
    return reader;
  }

  private validateSchema(): void {
    const tableRows = this.db
      .prepare("select name from sqlite_master where type = 'table'")
      .all() as { name: string }[];
    const existingTables = new Set(tableRows.map((r) => r.name));

    const missingTables: string[] = [];
    const missingColumns: string[] = [];

    for (const [table, columns] of Object.entries(EXPECTED_SCHEMA)) {
      if (!existingTables.has(table)) {
        missingTables.push(table);
        continue;
      }
      const colRows = this.db.prepare(`pragma table_info(${table})`).all() as { name: string }[];
      const existingCols = new Set(colRows.map((c) => c.name));
      for (const col of columns) {
        if (!existingCols.has(col)) {
          missingColumns.push(`${table}.${col}`);
        }
      }
    }

    if (missingTables.length > 0 || missingColumns.length > 0) {
      const parts: string[] = [];
      if (missingTables.length > 0) parts.push(`missing tables: ${missingTables.join(', ')}`);
      if (missingColumns.length > 0) parts.push(`missing columns: ${missingColumns.join(', ')}`);
      throw new SnapshotIncompleteError(parts.join('; '));
    }
  }

  /** Row counts for the tables this adapter reads - used as a cheap
   * checkpoint fingerprint (mm_sync_checkpoints) to detect whether the
   * snapshot changed between runs. Not a substitute for a content hash,
   * but enough to tell "nothing changed" from "something changed". */
  tableCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const table of Object.keys(EXPECTED_SCHEMA)) {
      counts[table] = (this.db.prepare(`select count(*) as c from ${table}`).get() as { c: number })
        .c;
    }
    return counts;
  }

  branches(): Branch[] {
    return (this.db.prepare('select id, code, name from branches').all() as Record<string, unknown>[]).map(
      (r) => ({ id: r.id as number, code: r.code as string, name: r.name as string })
    );
  }

  glAccounts(): GlAccount[] {
    return (
      this.db
        .prepare(
          'select id, branch_id, account_code, account_name, category, balance_minor from gl_accounts'
        )
        .all() as Record<string, unknown>[]
    ).map((r) => ({
      id: r.id as number,
      branchId: r.branch_id as number,
      accountCode: r.account_code as string,
      accountName: r.account_name as string,
      category: (r.category as string) ?? 'UNKNOWN',
      balanceMinor: (r.balance_minor as number) ?? 0,
    }));
  }

  customerAccounts(): CustomerAccount[] {
    return (
      this.db
        .prepare(
          `select id, branch_id, customer_id, account_no, account_name, account_type,
                  current_balance_minor, account_status, dormant
           from customer_accounts`
        )
        .all() as Record<string, unknown>[]
    ).map((r) => ({
      id: r.id as number,
      branchId: r.branch_id as number,
      customerId: r.customer_id as number,
      accountNo: r.account_no as string,
      accountName: r.account_name as string,
      accountType: r.account_type as string,
      currentBalanceMinor: (r.current_balance_minor as number) ?? 0,
      accountStatus: r.account_status as string,
      dormant: Boolean(r.dormant),
    }));
  }

  /** Latest (by id) non-voided ledger entry per customer_account_id - the
   * balance MoneyManager's own ledger claims for that account, used by
   * balance reconciliation. Computed in SQL, not by pulling all 600k+ rows
   * into JS, because customer_ledger_entries is large. */
  latestLedgerBalancePerAccount(): Map<number, { entryId: number; balanceMinor: number; entryDate: string }> {
    const rows = this.db
      .prepare(
        `select cle.customer_account_id as customer_account_id,
                cle.id as entry_id,
                cle.balance_minor as balance_minor,
                cle.entry_date as entry_date
         from customer_ledger_entries cle
         join (
           select customer_account_id, max(id) as max_id
           from customer_ledger_entries
           where voided_at is null
           group by customer_account_id
         ) latest
           on latest.customer_account_id = cle.customer_account_id
          and latest.max_id = cle.id`
      )
      .all() as Record<string, unknown>[];

    const map = new Map<number, { entryId: number; balanceMinor: number; entryDate: string }>();
    for (const r of rows) {
      map.set(r.customer_account_id as number, {
        entryId: r.entry_id as number,
        balanceMinor: r.balance_minor as number,
        entryDate: r.entry_date as string,
      });
    }
    return map;
  }

  /** Duplicate candidate groups: entries sharing (customer_account_id,
   * entry_date, dr_minor, cr_minor, details) more than once, excluding
   * voided entries. Returns one row per duplicate group with the count and
   * the list of colliding entry ids. */
  duplicateCustomerLedgerGroups(): {
    customerAccountId: number;
    entryDate: string;
    drMinor: number;
    crMinor: number;
    details: string | null;
    count: number;
    entryIds: number[];
  }[] {
    const rows = this.db
      .prepare(
        `select customer_account_id, entry_date, dr_minor, cr_minor, details,
                count(*) as cnt, group_concat(id) as ids
         from customer_ledger_entries
         where voided_at is null and (dr_minor > 0 or cr_minor > 0)
         group by customer_account_id, entry_date, dr_minor, cr_minor, details
         having count(*) > 1`
      )
      .all() as Record<string, unknown>[];

    return rows.map((r) => ({
      customerAccountId: r.customer_account_id as number,
      entryDate: r.entry_date as string,
      drMinor: r.dr_minor as number,
      crMinor: r.cr_minor as number,
      details: r.details as string | null,
      count: r.cnt as number,
      entryIds: String(r.ids)
        .split(',')
        .map((s) => Number(s)),
    }));
  }

  /** Duplicate receipt numbers reused across more than one ledger entry -
   * receipt_no is meant to be a unique physical receipt reference. */
  duplicateReceiptNumbers(): { receiptNo: string; count: number; entryIds: number[] }[] {
    const rows = this.db
      .prepare(
        `select receipt_no, count(*) as cnt, group_concat(id) as ids
         from customer_ledger_entries
         where receipt_no is not null and voided_at is null
         group by receipt_no
         having count(*) > 1`
      )
      .all() as Record<string, unknown>[];

    return rows.map((r) => ({
      receiptNo: r.receipt_no as string,
      count: r.cnt as number,
      entryIds: String(r.ids)
        .split(',')
        .map((s) => Number(s)),
    }));
  }

  /** customer_ledger_entries whose customer_account_id has no matching row
   * in customer_accounts - an orphaned foreign key. */
  orphanedCustomerLedgerEntries(): { id: number; customerAccountId: number; entryDate: string }[] {
    const rows = this.db
      .prepare(
        `select cle.id as id, cle.customer_account_id as customer_account_id, cle.entry_date as entry_date
         from customer_ledger_entries cle
         left join customer_accounts ca on ca.id = cle.customer_account_id
         where ca.id is null`
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      customerAccountId: r.customer_account_id as number,
      entryDate: r.entry_date as string,
    }));
  }

  /** ledger_entries whose gl_account_id has no matching row in gl_accounts. */
  orphanedLedgerEntries(): { id: number; glAccountId: number; entryDate: string }[] {
    const rows = this.db
      .prepare(
        `select le.id as id, le.gl_account_id as gl_account_id, le.entry_date as entry_date
         from ledger_entries le
         left join gl_accounts g on g.id = le.gl_account_id
         where g.id is null`
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      glAccountId: r.gl_account_id as number,
      entryDate: r.entry_date as string,
    }));
  }

  /** withdrawal_records whose customer_ledger_entry_id doesn't exist in
   * customer_ledger_entries - the withdrawal has no backing ledger posting. */
  orphanedWithdrawalRecords(): { customerLedgerEntryId: number; customerAccountId: number }[] {
    const rows = this.db
      .prepare(
        `select wr.customer_ledger_entry_id as customer_ledger_entry_id, wr.customer_account_id as customer_account_id
         from withdrawal_records wr
         left join customer_ledger_entries cle on cle.id = wr.customer_ledger_entry_id
         where cle.id is null`
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      customerLedgerEntryId: r.customer_ledger_entry_id as number,
      customerAccountId: r.customer_account_id as number,
    }));
  }

  /** All withdrawal_records joined to their backing ledger entry (only
   * rows with a valid link - orphans are reported separately). */
  withdrawalRecordsWithLedgerEntry(): {
    record: WithdrawalRecord;
    ledgerEntry: { drMinor: number; crMinor: number; balanceMinor: number } | null;
  }[] {
    const rows = this.db
      .prepare(
        `select wr.customer_ledger_entry_id as customer_ledger_entry_id,
                wr.branch_id as branch_id,
                wr.customer_account_id as customer_account_id,
                wr.machine_balance_before_minor as machine_balance_before_minor,
                wr.amount_minor as amount_minor,
                wr.commission_minor as commission_minor,
                wr.balance_after_minor as balance_after_minor,
                wr.passbook_balance_minor as passbook_balance_minor,
                wr.passbook_difference_minor as passbook_difference_minor,
                wr.recorded_at as recorded_at,
                cle.dr_minor as le_dr_minor,
                cle.cr_minor as le_cr_minor,
                cle.balance_minor as le_balance_minor
         from withdrawal_records wr
         left join customer_ledger_entries cle on cle.id = wr.customer_ledger_entry_id`
      )
      .all() as Record<string, unknown>[];

    return rows.map((r) => ({
      record: {
        customerLedgerEntryId: r.customer_ledger_entry_id as number,
        branchId: r.branch_id as number,
        customerAccountId: r.customer_account_id as number,
        machineBalanceBeforeMinor: r.machine_balance_before_minor as number,
        amountMinor: r.amount_minor as number,
        commissionMinor: r.commission_minor as number,
        balanceAfterMinor: r.balance_after_minor as number,
        passbookBalanceMinor: r.passbook_balance_minor as number | null,
        passbookDifferenceMinor: r.passbook_difference_minor as number | null,
        recordedAt: r.recorded_at as string,
      },
      ledgerEntry:
        r.le_dr_minor === null && r.le_cr_minor === null
          ? null
          : {
              drMinor: r.le_dr_minor as number,
              crMinor: r.le_cr_minor as number,
              balanceMinor: r.le_balance_minor as number,
            },
    }));
  }

  glAccountMovementTotals(): Map<number, { drMinor: number; crMinor: number }> {
    const rows = this.db
      .prepare(
        `select gl_account_id, sum(dr_minor) as dr, sum(cr_minor) as cr
         from ledger_entries
         group by gl_account_id`
      )
      .all() as Record<string, unknown>[];
    const map = new Map<number, { drMinor: number; crMinor: number }>();
    for (const r of rows) {
      map.set(r.gl_account_id as number, {
        drMinor: (r.dr as number) ?? 0,
        crMinor: (r.cr as number) ?? 0,
      });
    }
    return map;
  }

  /** Per-batch dr/cr totals in ledger_entries - each batch_no is meant to
   * represent one balanced double-entry transaction (dr total == cr total).
   * Rows with a null batch_no are excluded (nothing to group them by). */
  ledgerBatchTotals(): { batchNo: string; drMinor: number; crMinor: number; entryCount: number }[] {
    const rows = this.db
      .prepare(
        `select batch_no, sum(dr_minor) as dr, sum(cr_minor) as cr, count(*) as cnt
         from ledger_entries
         where batch_no is not null
         group by batch_no`
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      batchNo: r.batch_no as string,
      drMinor: (r.dr as number) ?? 0,
      crMinor: (r.cr as number) ?? 0,
      entryCount: r.cnt as number,
    }));
  }

  ledgerTotals(): { drMinor: number; crMinor: number } {
    const r = this.db
      .prepare('select sum(dr_minor) as dr, sum(cr_minor) as cr from ledger_entries')
      .get() as Record<string, unknown>;
    return { drMinor: (r.dr as number) ?? 0, crMinor: (r.cr as number) ?? 0 };
  }

  /** Daily customer DEPOSIT totals from customer_ledger_entries vs daily
   * DEPOSIT-sourced Vault movement totals from ledger_entries, per date. */
  dailyDepositTotals(): {
    date: string;
    customerLedgerDepositsMinor: number;
    vaultDepositMovementMinor: number;
  }[] {
    const customerSide = this.db
      .prepare(
        `select date(entry_date) as d, sum(cr_minor) as total
         from customer_ledger_entries
         where tag = 'DEPOSIT' and voided_at is null
         group by date(entry_date)`
      )
      .all() as Record<string, unknown>[];

    const vaultSide = this.db
      .prepare(
        `select date(le.entry_date) as d, sum(le.dr_minor) as total
         from ledger_entries le
         join gl_accounts g on g.id = le.gl_account_id
         where g.account_code = ? and le.source = 'DEPOSIT'
         group by date(le.entry_date)`
      )
      .all(VAULT_ACCOUNT_CODE) as Record<string, unknown>[];

    const byDate = new Map<string, { customerLedgerDepositsMinor: number; vaultDepositMovementMinor: number }>();
    for (const r of customerSide) {
      const d = r.d as string;
      byDate.set(d, { customerLedgerDepositsMinor: (r.total as number) ?? 0, vaultDepositMovementMinor: 0 });
    }
    for (const r of vaultSide) {
      const d = r.d as string;
      const existing = byDate.get(d) ?? { customerLedgerDepositsMinor: 0, vaultDepositMovementMinor: 0 };
      existing.vaultDepositMovementMinor = (r.total as number) ?? 0;
      byDate.set(d, existing);
    }

    return Array.from(byDate.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Raw entry_date strings across the two ledger tables, for basic date
   * sanity checks (malformed / out-of-range values). */
  allEntryDates(): { table: string; id: number; entryDate: string }[] {
    const cle = this.db
      .prepare('select id, entry_date from customer_ledger_entries')
      .all() as Record<string, unknown>[];
    const le = this.db.prepare('select id, entry_date from ledger_entries').all() as Record<
      string,
      unknown
    >[];
    return [
      ...cle.map((r) => ({ table: 'customer_ledger_entries', id: r.id as number, entryDate: r.entry_date as string })),
      ...le.map((r) => ({ table: 'ledger_entries', id: r.id as number, entryDate: r.entry_date as string })),
    ];
  }

  /** customer_ledger_entries with null/zero on both dr_minor and cr_minor
   * for a non-void entry - a transaction that moved no money at all. */
  zeroAmountEntries(): { id: number; customerAccountId: number; entryDate: string }[] {
    const rows = this.db
      .prepare(
        `select id, customer_account_id, entry_date
         from customer_ledger_entries
         where voided_at is null and (dr_minor is null or dr_minor = 0) and (cr_minor is null or cr_minor = 0)`
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      customerAccountId: r.customer_account_id as number,
      entryDate: r.entry_date as string,
    }));
  }

  loans(): Loan[] {
    return (
      this.db
        .prepare('select id, loan_ref, customer_account_id, principal_minor, status from loans')
        .all() as Record<string, unknown>[]
    ).map((r) => ({
      id: r.id as number,
      loanRef: r.loan_ref as string,
      customerAccountId: r.customer_account_id as number,
      principalMinor: r.principal_minor as number,
      status: r.status as string,
    }));
  }

  investments(): Investment[] {
    return (
      this.db
        .prepare(
          'select id, investment_ref, customer_account_id, principal_minor, status from investments'
        )
        .all() as Record<string, unknown>[]
    ).map((r) => ({
      id: r.id as number,
      investmentRef: r.investment_ref as string,
      customerAccountId: r.customer_account_id as number,
      principalMinor: r.principal_minor as number,
      status: r.status as string,
    }));
  }

  /** MoneyManager's field survey checks - the systematic passbook-vs-system
   * ("Compare with Office Records") comparison. See
   * mm-server-actual/src/business/field-survey/get-field-survey-report.ts
   * and lib/moneymanager/rules/savingsCompareWithOfficeRecords.ts. Only 217
   * rows in the reference snapshot - cheap to read in full. */
  fieldSurveyChecks(): FieldSurveyCheck[] {
    return (
      this.db
        .prepare(
          `select id, customer_account_id, worker_id, surveyed_at, passbook_balance_minor,
                  system_balance_minor, difference_minor, status
           from field_survey_checks`
        )
        .all() as Record<string, unknown>[]
    ).map((r) => ({
      id: r.id as number,
      customerAccountId: r.customer_account_id as number,
      workerId: (r.worker_id as number | null) ?? null,
      surveyedAt: r.surveyed_at as string,
      passbookBalanceMinor: r.passbook_balance_minor as number,
      systemBalanceMinor: r.system_balance_minor as number,
      differenceMinor: r.difference_minor as number,
      status: r.status as string,
    }));
  }

  /** MoneyManager's withdrawal-time passbook spot-check-with-resolution
   * workflow - the other half of "Compare with Office Records" (see
   * mm-server-actual/src/business/passbook-checks/). Only 46 rows in the
   * reference snapshot. */
  passbookChecks(): PassbookCheck[] {
    return (
      this.db
        .prepare(
          `select id, customer_account_id, checked_at, passbook_balance_minor,
                  system_balance_minor, difference_minor, status
           from passbook_checks`
        )
        .all() as Record<string, unknown>[]
    ).map((r) => ({
      id: r.id as number,
      customerAccountId: r.customer_account_id as number,
      checkedAt: r.checked_at as string,
      passbookBalanceMinor: r.passbook_balance_minor as number,
      systemBalanceMinor: r.system_balance_minor as number,
      differenceMinor: r.difference_minor as number,
      status: r.status as string,
    }));
  }

  /** Zone-and-day deposit + card-sale-cash totals - ported verbatim (as
   * SQL) from moneymanager-standalone-src/src/data/office-records-
   * comparison.repository.ts's getZoneCollectionsByDate: card-sale cash is
   * collected in the field alongside deposits and the office's own zone
   * sheets include it in the same total, so CARD FEE CASH must be summed
   * in here too or every zone diff looks wrong by that amount. */
  zoneCollectionsByDate(
    dateFrom: string,
    dateTo: string
  ): { zoneName: string; entryDate: string; amountMinor: number }[] {
    const rows = this.db
      .prepare(
        `select z.name as zone_name, substr(cle.entry_date, 1, 10) as entry_date,
                sum(case when cle.tag = 'DEPOSIT' then cle.cr_minor
                         else (select coalesce(sum(le.dr_minor), 0) from ledger_entries le where le.customer_ledger_entry_id = cle.id)
                end) as amount_minor
         from customer_ledger_entries cle
         join customer_accounts ca on ca.id = cle.customer_account_id
         join customers cu on cu.id = ca.customer_id
         join zones z on z.id = cu.zone_id
         where cle.entry_date >= ? and cle.entry_date < ?
           and cle.tag in ('DEPOSIT', 'CARD FEE CASH') and cle.voided_at is null
         group by z.name, substr(cle.entry_date, 1, 10)`
      )
      .all(dateFrom, nextIsoDate(dateTo)) as Record<string, unknown>[];

    return rows.map((r) => ({
      zoneName: r.zone_name as string,
      entryDate: r.entry_date as string,
      amountMinor: (r.amount_minor as number) ?? 0,
    }));
  }

  /** Withdrawal rows for office-sheet matching - ported verbatim (as SQL)
   * from getWithdrawalsForMatching: cle.dr_minor is always the gross
   * amount (principal+commission combined); use the structured NET
   * principal (withdrawal_records.amount_minor) when it exists, falling
   * back to the raw ledger amount only for legacy rows with no
   * withdrawal_records row at all. */
  withdrawalsForMatching(
    dateFrom: string,
    dateTo: string
  ): {
    entryDate: string;
    customerName: string;
    amountMinor: number;
    commissionMinor: number;
    hasStructuredRecord: boolean;
  }[] {
    const rows = this.db
      .prepare(
        `select substr(cle.entry_date, 1, 10) as entry_date, cu.full_name as customer_name,
                coalesce(wr.amount_minor, cle.dr_minor) as amount_minor,
                coalesce(wr.commission_minor, 0) as commission_minor,
                (wr.customer_ledger_entry_id is not null) as has_structured_record
         from customer_ledger_entries cle
         left join customer_accounts ca on ca.id = cle.customer_account_id
         left join customers cu on cu.id = ca.customer_id
         left join withdrawal_records wr on wr.customer_ledger_entry_id = cle.id
         where cle.tag = 'Withdrawal' and cle.voided_at is null
           and cle.entry_date >= ? and cle.entry_date < ?`
      )
      .all(dateFrom, nextIsoDate(dateTo)) as Record<string, unknown>[];

    return rows.map((r) => ({
      entryDate: r.entry_date as string,
      customerName: (r.customer_name as string) ?? 'Unknown',
      amountMinor: (r.amount_minor as number) ?? 0,
      commissionMinor: (r.commission_minor as number) ?? 0,
      hasStructuredRecord: Boolean(r.has_structured_record),
    }));
  }

  close(): void {
    this.db.close();
  }
}
