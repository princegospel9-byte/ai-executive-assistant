// Phase 4C: a real MoneyManagerSource implementation backed by MoneyManager's
// actual REST API (the desktop app's office-LAN host mode - see
// moneymanager-standalone-src/src/main/lan-server/start-lan-server.ts - or,
// later, the identical web/VPS deployment; both serve the byte-for-byte
// same Express app, verified in the Phase 4 design report). NOT connected
// to anything live this phase: this class is constructed and unit-tested
// against a mocked fetchImpl only - see lib/moneymanager/__tests__/
// lanApiSource.test.ts. No credentials, no real base URL, no LAN server
// enable anywhere in this codebase.
//
// Read-only guarantee: every method below only ever calls
// LanApiHttpClient.get() (lib/moneymanager/client/lan-api/http-client.ts),
// which physically has no other HTTP-calling method - there is no code
// path anywhere in this file that can issue a POST/PUT/PATCH/DELETE.
//
// API coverage - the honest split (see each method's own doc comment for
// the specific reasoning): about half of MoneyManagerSource's 23 data
// methods have a clean, faithful live equivalent (a real endpoint exposing
// exactly the fields the method's contract promises). The other half
// depend on customer_ledger_entries (MoneyManager's largest table, ~678k
// rows in the reference offline snapshot) or on a field the closest live
// endpoint doesn't expose - and MoneyManager's real REST API has NO bulk
// read endpoint for that table at all (only per-customer-account
// statements, impractical to loop over thousands of accounts per
// monitoring run). Rather than approximate those with a partial or
// aggregated substitute that could look like a real result, every such
// method throws LanApiUnsupportedMethodError - a distinct, typed signal
// that this data was never checked, not a false "checked, found nothing".
import { LanApiHttpClient } from './lan-api/http-client';
import { LanApiUnsupportedMethodError } from './lan-api/errors';
import { isImplausibleDate } from '../shared/dates';
import type { MoneyManagerSource } from './source';
import type { Branch, GlAccount, Investment, Loan, FieldSurveyCheck, PassbookCheck } from './types';

export type LanApiSourceConfig = {
  baseUrl: string;
  sessionCookie: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Page size used when this adapter paginates through a list endpoint to
   * assemble a full table read (e.g. ledger_entries for
   * glAccountMovementTotals/ledgerBatchTotals). Defaults to 500. */
  pageSize?: number;
};

type PagedResult<T> = { items: T[]; total: number };

function isPagedResult(data: unknown): data is PagedResult<unknown> {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { items?: unknown }).items) &&
    typeof (data as { total?: unknown }).total === 'number'
  );
}

export class LanApiSource implements MoneyManagerSource {
  private readonly http: LanApiHttpClient;
  private readonly pageSize: number;

  constructor(config: LanApiSourceConfig) {
    this.http = new LanApiHttpClient(config);
    this.pageSize = config.pageSize ?? 500;
  }

  /** Pages through any `{items, total}` list endpoint until every row has
   * been collected. Used only for the two tables small enough to read in
   * full over HTTP without it being impractical (ledger_entries: ~5,193
   * rows in the reference snapshot; field_survey_checks/passbook_checks:
   * a few hundred rows) - never attempted for customer_ledger_entries. */
  private async fetchAllPages<T>(path: string, query: Record<string, string | number | boolean | undefined>): Promise<T[]> {
    const items: T[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.http.get<PagedResult<T>>(
        path,
        { ...query, limit: this.pageSize, offset },
        (data: unknown): data is PagedResult<T> => isPagedResult(data)
      );
      items.push(...(page.items as T[]));
      offset += this.pageSize;
      if (page.items.length < this.pageSize || offset >= page.total) break;
    }
    return items;
  }

  private unsupported(methodName: string, reason: string): never {
    throw new LanApiUnsupportedMethodError(
      `${methodName}() is not supported by LanApiSource - ${reason}`
    );
  }

  // ---- Real, faithful live implementations ----

  async branches(): Promise<Branch[]> {
    const data = await this.http.get<{ id: number; code: string; name: string }[]>('/api/branches');
    if (!Array.isArray(data)) throw new LanApiUnsupportedMethodError('GET /api/branches did not return an array.');
    return data.map((b) => ({ id: b.id, code: b.code, name: b.name }));
  }

  async glAccounts(): Promise<GlAccount[]> {
    const data = await this.http.get<
      { id: number; branchId: number; accountCode: string | null; accountName: string; balanceMinor: number }[]
    >('/api/ledger/gl-accounts');
    if (!Array.isArray(data)) throw new LanApiUnsupportedMethodError('GET /api/ledger/gl-accounts did not return an array.');
    // The live GlAccountOption type (mm-server-actual/src/shared/types/
    // ledger.ts) doesn't expose `category` - only offline SnapshotReader
    // has it (gl_accounts.category). Rules that branch on category
    // (glReconciliation.ts's DEBIT_NATURE check) need it; default to
    // 'UNKNOWN' rather than guessing asset-vs-liability, and document this
    // as a real, narrower-than-offline field gap.
    return data.map((r) => ({
      id: r.id,
      branchId: r.branchId,
      accountCode: r.accountCode ?? '',
      accountName: r.accountName,
      category: 'UNKNOWN',
      balanceMinor: r.balanceMinor,
    }));
  }

  async loans(): Promise<Loan[]> {
    const data = await this.fetchAllPages<{ id: number; loanRef: string; customerAccountId: number; principalMinor: number; status: string }>(
      '/api/loans',
      {}
    );
    return data.map((r) => ({ id: r.id, loanRef: r.loanRef, customerAccountId: r.customerAccountId, principalMinor: r.principalMinor, status: r.status }));
  }

  async investments(): Promise<Investment[]> {
    const data = await this.fetchAllPages<{
      id: number;
      investmentRef: string;
      customerAccountId: number;
      principalMinor: number;
      status: string;
    }>('/api/investments', {});
    return data.map((r) => ({ id: r.id, investmentRef: r.investmentRef, customerAccountId: r.customerAccountId, principalMinor: r.principalMinor, status: r.status }));
  }

  /** field_survey_checks IS a real, bulk-listable live table (GET
   * /api/field-survey-checks, paginated, filterable) - unlike most of the
   * "unsupported" methods below, this one has a genuine, complete live
   * equivalent. The real constraint is the PERMISSION it requires
   * (PASSBOOK_CHECK_MANAGE, verified fresh against mm-server-actual/src/
   * business/field-survey/list-field-survey-checks.ts) - a mixed
   * read+write code, same pattern as DAILY_RECONCILIATION_MANAGE/
   * COLLECTOR_SUBMIT flagged in the Phase 4 design report. A genuinely
   * read-only KBRISKS_AGENT_READONLY role (which deliberately excludes
   * every *_MANAGE code) will get a real, correctly-surfaced
   * LanApiPermissionError (403) calling this - that is the CORRECT
   * outcome given today's MoneyManager permission catalog, not a bug in
   * this adapter. */
  async fieldSurveyChecks(): Promise<FieldSurveyCheck[]> {
    const data = await this.fetchAllPages<{
      id: number;
      accountId: number;
      surveyedAt: string;
      passbookBalanceMinor: number;
      systemBalanceMinor: number;
      differenceMinor: number;
      status: string;
    }>('/api/field-survey-checks', {});
    return data.map((r) => ({
      id: r.id,
      customerAccountId: r.accountId,
      workerId: null, // live list endpoint returns workerName, not a numeric id - not needed by fieldSurveyPassbookChecks.ts beyond evidence display
      surveyedAt: r.surveyedAt,
      passbookBalanceMinor: r.passbookBalanceMinor,
      systemBalanceMinor: r.systemBalanceMinor,
      differenceMinor: r.differenceMinor,
      status: r.status,
    }));
  }

  /** Same real-endpoint-but-mixed-permission situation as
   * fieldSurveyChecks() above - see that method's doc comment. */
  async passbookChecks(): Promise<PassbookCheck[]> {
    const data = await this.fetchAllPages<{
      id: number;
      accountId: number;
      checkedAt: string;
      passbookBalanceMinor: number;
      systemBalanceMinor: number;
      differenceMinor: number;
      status: string;
    }>('/api/passbook-checks', {});
    return data.map((r) => ({
      id: r.id,
      customerAccountId: r.accountId,
      checkedAt: r.checkedAt,
      passbookBalanceMinor: r.passbookBalanceMinor,
      systemBalanceMinor: r.systemBalanceMinor,
      differenceMinor: r.differenceMinor,
      status: r.status,
    }));
  }

  /** withdrawal_records also has a real, bulk-listable, date-range-
   * filterable live endpoint (GET /api/withdrawals/records) that already
   * carries the officer/customer name and amount fields
   * officeRecordsComparison.ts's withdrawal matching needs. Every
   * withdrawal returned by this endpoint IS a structured record (it's a
   * direct read of the withdrawal_records table) - the offline
   * SnapshotReader's `hasStructuredRecord: false` fallback branch existed
   * only for legacy customer_ledger_entries rows with NO withdrawal_records
   * row at all, which this endpoint (by definition) never returns - so
   * `hasStructuredRecord` is always `true` here. This is a narrower but
   * real, documented behavior difference: any such legacy unstructured
   * withdrawal (none exist in the reference offline snapshot - all 52
   * withdrawal_records rows there are structured) would be invisible to
   * this live adapter's withdrawal matching, not silently miscounted. */
  async withdrawalsForMatching(
    dateFrom: string,
    dateTo: string
  ): Promise<{ entryDate: string; customerName: string; amountMinor: number; commissionMinor: number; hasStructuredRecord: boolean }[]> {
    const data = await this.fetchAllPages<{
      entryDate: string;
      customerName: string;
      amountMinor: number;
      commissionMinor: number;
      voided: boolean;
    }>('/api/withdrawals/records', { dateFrom, dateTo });
    return data
      .filter((r) => !r.voided)
      .map((r) => ({
        entryDate: r.entryDate.slice(0, 10),
        customerName: r.customerName,
        amountMinor: r.amountMinor,
        commissionMinor: r.commissionMinor,
        hasStructuredRecord: true,
      }));
  }

  /** ledger_entries (the GL posting stream, NOT customer_ledger_entries)
   * is small enough (~5,193 rows in the reference snapshot) to read in
   * full via pagination and aggregate client-side - unlike
   * customer_ledger_entries, there's no impractical N-thousand-request
   * problem here. GET /api/ledger already computes totalDrMinor/
   * totalCrMinor server-side per the requested filter (see
   * mm-server-actual/src/business/ledger/list-ledger-entries.ts) - used
   * directly for ledgerTotals() below rather than re-summing client-side. */
  private async fetchAllLedgerEntries(): Promise<
    { id: number; entryDate: string; glAccountId: number | null; drMinor: number; crMinor: number; batchNo: string | null }[]
  > {
    return this.fetchAllPages('/api/ledger', {});
  }

  async ledgerTotals(): Promise<{ drMinor: number; crMinor: number }> {
    const page = await this.http.get<{ totalDrMinor: number; totalCrMinor: number }>('/api/ledger', {
      limit: 1,
      offset: 0,
    });
    return { drMinor: page.totalDrMinor, crMinor: page.totalCrMinor };
  }

  async glAccountMovementTotals(): Promise<Map<number, { drMinor: number; crMinor: number }>> {
    const entries = await this.fetchAllLedgerEntries();
    const map = new Map<number, { drMinor: number; crMinor: number }>();
    for (const e of entries) {
      if (e.glAccountId === null) continue;
      const existing = map.get(e.glAccountId) ?? { drMinor: 0, crMinor: 0 };
      existing.drMinor += e.drMinor;
      existing.crMinor += e.crMinor;
      map.set(e.glAccountId, existing);
    }
    return map;
  }

  async ledgerBatchTotals(): Promise<{ batchNo: string; drMinor: number; crMinor: number; entryCount: number }[]> {
    const entries = await this.fetchAllLedgerEntries();
    const map = new Map<string, { drMinor: number; crMinor: number; entryCount: number }>();
    for (const e of entries) {
      if (e.batchNo === null) continue;
      const existing = map.get(e.batchNo) ?? { drMinor: 0, crMinor: 0, entryCount: 0 };
      existing.drMinor += e.drMinor;
      existing.crMinor += e.crMinor;
      existing.entryCount += 1;
      map.set(e.batchNo, existing);
    }
    return Array.from(map.entries()).map(([batchNo, v]) => ({ batchNo, ...v }));
  }

  async orphanedLedgerEntries(): Promise<{ id: number; glAccountId: number; entryDate: string }[]> {
    const [entries, accounts] = await Promise.all([this.fetchAllLedgerEntries(), this.glAccounts()]);
    const accountIds = new Set(accounts.map((a) => a.id));
    return entries
      .filter((e) => e.glAccountId !== null && !accountIds.has(e.glAccountId))
      .map((e) => ({ id: e.id, glAccountId: e.glAccountId as number, entryDate: e.entryDate }));
  }

  /** Only the ledger_entries portion of allEntryDates() - the
   * customer_ledger_entries portion is not covered (see the
   * LanApiUnsupportedMethodError note on that table throughout this file);
   * dataIntegrity.ts still runs against whatever this returns, it just
   * checks a narrower slice of dates than the offline snapshot covers. */
  async allEntryDates(): Promise<{ table: string; id: number; entryDate: string }[]> {
    const entries = await this.fetchAllLedgerEntries();
    return entries.map((e) => ({ table: 'ledger_entries', id: e.id, entryDate: e.entryDate }));
  }

  /** Approximated from ledger_entries (the only bulk-readable ledger
   * stream over this API), NOT customer_ledger_entries (Phase 3/4A's
   * offline definition) - documented divergence, not a silent behavior
   * change. ledger_entries is a narrower, GL-level stream that in practice
   * lags customer_ledger_entries (see vaultReconciliation.ts's own
   * evidence.note on this exact scope gap) - so this method's result may
   * be an EARLIER date than the true business "as of" date, never a later
   * (fabricated-forward) one. That asymmetry is safe for
   * classify.ts's SNAPSHOT_LIMITATION check: an earlier-than-true
   * moneyManagerDataAsOf can only make the classifier MORE conservative
   * (more findings correctly deferred as SNAPSHOT_LIMITATION), never
   * less - it cannot cause a stale comparison to be miscalled
   * CONFIRMED_DISCREPANCY. */
  async dataAsOfDate(): Promise<string | null> {
    const entries = await this.fetchAllLedgerEntries();
    let latest: string | null = null;
    for (const e of entries) {
      if (isImplausibleDate(e.entryDate)) continue;
      const date = e.entryDate.slice(0, 10);
      if (latest === null || date > latest) latest = date;
    }
    return latest;
  }

  /** Best-effort only: counts only the tables this adapter can actually
   * read (branches/gl_accounts/loans/investments/ledger_entries via each
   * endpoint's own `total`), and deliberately OMITS a key for every table
   * it has no way to count (customer_accounts, customer_ledger_entries,
   * withdrawal_records, field_survey_checks, passbook_checks) rather than
   * reporting a fabricated 0 - a missing key in the checkpoint's JSON is
   * visibly different from "counted, found zero rows". */
  async tableCounts(): Promise<Record<string, number>> {
    const [branches, glAccounts, loansPage, investmentsPage, ledgerPage] = await Promise.all([
      this.branches(),
      this.glAccounts(),
      this.http.get<{ total: number }>('/api/loans', { limit: 1, offset: 0 }),
      this.http.get<{ total: number }>('/api/investments', { limit: 1, offset: 0 }),
      this.http.get<{ total: number }>('/api/ledger', { limit: 1, offset: 0 }),
    ]);
    return {
      branches: branches.length,
      gl_accounts: glAccounts.length,
      loans: loansPage.total,
      investments: investmentsPage.total,
      ledger_entries: ledgerPage.total,
    };
  }

  // ---- Not supported against the current MoneyManager REST API surface ----
  // Every method below depends on customer_ledger_entries (no bulk-read
  // endpoint exists for it - only GET /api/customer-ledger/statement,
  // scoped to one customerAccountId at a time, impractical to loop over
  // the ~8,000+ accounts a real branch has per monitoring run) or on a
  // field the closest live endpoint doesn't expose. See errors.ts's
  // LanApiUnsupportedMethodError doc comment for why this is thrown rather
  // than an empty array.

  async customerAccounts(): Promise<never> {
    return this.unsupported(
      'customerAccounts',
      'the only bulk live endpoint (GET /api/customer-ledger/balances/all) omits accountType/accountStatus/dormant, and there is no bulk customer_accounts read endpoint that has them.'
    );
  }

  async latestLedgerBalancePerAccount(): Promise<never> {
    return this.unsupported(
      'latestLedgerBalancePerAccount',
      'requires reading customer_ledger_entries in bulk; MoneyManager\'s API only exposes it per customerAccountId (GET /api/customer-ledger/statement), not across all accounts.'
    );
  }

  async duplicateCustomerLedgerGroups(): Promise<never> {
    return this.unsupported('duplicateCustomerLedgerGroups', 'requires a bulk customer_ledger_entries read - no such endpoint exists.');
  }

  async duplicateReceiptNumbers(): Promise<never> {
    return this.unsupported('duplicateReceiptNumbers', 'requires a bulk customer_ledger_entries read - no such endpoint exists.');
  }

  async orphanedCustomerLedgerEntries(): Promise<never> {
    return this.unsupported('orphanedCustomerLedgerEntries', 'requires a bulk customer_ledger_entries read - no such endpoint exists.');
  }

  async orphanedWithdrawalRecords(): Promise<never> {
    return this.unsupported(
      'orphanedWithdrawalRecords',
      'requires cross-referencing withdrawal_records against customer_ledger_entries in bulk - no endpoint exposes that linkage.'
    );
  }

  async withdrawalRecordsWithLedgerEntry(): Promise<never> {
    return this.unsupported(
      'withdrawalRecordsWithLedgerEntry',
      'GET /api/withdrawals/records does not expose the backing raw ledger posting (dr_minor/cr_minor/balance_minor) - only withdrawal_records\' own fields. Returning every row with ledgerEntry: null would make withdrawalConsistency.ts silently skip every row (its own "already reported as orphaned elsewhere" short-circuit), producing zero findings that would look exactly like a clean result - refused rather than risk that.'
    );
  }

  async zeroAmountEntries(): Promise<never> {
    return this.unsupported('zeroAmountEntries', 'requires a bulk customer_ledger_entries read - no such endpoint exists.');
  }

  async zoneCollectionsByDate(): Promise<never> {
    return this.unsupported(
      'zoneCollectionsByDate',
      'requires a bulk, zone-attributed customer_ledger_entries read (SnapshotReader computes this with a SQL SUM/GROUP BY) - no live endpoint returns per-zone collection totals or the raw rows to aggregate them from.'
    );
  }

  async dailyDepositTotals(): Promise<never> {
    return this.unsupported(
      'dailyDepositTotals',
      'the customer_ledger_entries side of this comparison has no bulk read endpoint (the ledger_entries/Vault side alone isn\'t enough to answer the question this rule asks).'
    );
  }

  close(): void {
    // No persistent handle to release for an HTTP client.
  }
}
