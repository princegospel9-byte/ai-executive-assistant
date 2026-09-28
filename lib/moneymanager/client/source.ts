// The data-query contract every MoneyManager source must implement. Rules
// (lib/moneymanager/rules/*.ts) depend on THIS interface, not on
// SnapshotReader concretely - so a rule written today keeps working
// (aside from adding `await`, see Phase 4B below) when a second source is
// added later (see WebApiSourceStub below).
//
// This is deliberately just an extraction of SnapshotReader's existing
// public query surface (lib/moneymanager/client/snapshot.ts) - not a
// redesign. SnapshotReader already satisfies this structurally; the
// `implements` clause on it is the only place that needed to change.
//
// Phase 4B: every query method is now async (`Promise<T>`), not just
// zoneCollectionsByDate/withdrawalsForMatching's future callers. This is
// the "option 1" design from the Phase 4 desktop-LAN investigation report:
// a live HTTP-backed source (desktop-LAN or web/VPS, still NOT built this
// phase) needs to make a real network request per method, which can't be
// synchronous - so the interface itself must be async, even though
// SnapshotReader's own underlying sqlite reads stay perfectly synchronous
// internally (see snapshot.ts - it just wraps each already-sync read in an
// `async` method, no behavior change, no added latency). `close()` is the
// one exception, kept synchronous: it's local resource cleanup (closing a
// db handle, or a no-op for an HTTP client), never itself an async fetch,
// matching the WebApiSourceStub example below.
import type {
  CustomerAccount,
  Branch,
  FieldSurveyCheck,
  GlAccount,
  Investment,
  Loan,
  PassbookCheck,
  WithdrawalRecord,
} from './types';

export interface MoneyManagerSource {
  tableCounts(): Promise<Record<string, number>>;
  branches(): Promise<Branch[]>;
  glAccounts(): Promise<GlAccount[]>;
  customerAccounts(): Promise<CustomerAccount[]>;
  latestLedgerBalancePerAccount(): Promise<Map<number, { entryId: number; balanceMinor: number; entryDate: string }>>;
  duplicateCustomerLedgerGroups(): Promise<{
    customerAccountId: number;
    entryDate: string;
    drMinor: number;
    crMinor: number;
    details: string | null;
    count: number;
    entryIds: number[];
  }[]>;
  duplicateReceiptNumbers(): Promise<{ receiptNo: string; count: number; entryIds: number[] }[]>;
  orphanedCustomerLedgerEntries(): Promise<{ id: number; customerAccountId: number; entryDate: string }[]>;
  orphanedLedgerEntries(): Promise<{ id: number; glAccountId: number; entryDate: string }[]>;
  orphanedWithdrawalRecords(): Promise<{ customerLedgerEntryId: number; customerAccountId: number }[]>;
  withdrawalRecordsWithLedgerEntry(): Promise<{
    record: WithdrawalRecord;
    ledgerEntry: { drMinor: number; crMinor: number; balanceMinor: number } | null;
  }[]>;
  glAccountMovementTotals(): Promise<Map<number, { drMinor: number; crMinor: number }>>;
  ledgerBatchTotals(): Promise<{ batchNo: string; drMinor: number; crMinor: number; entryCount: number }[]>;
  ledgerTotals(): Promise<{ drMinor: number; crMinor: number }>;
  dailyDepositTotals(): Promise<{
    date: string;
    customerLedgerDepositsMinor: number;
    vaultDepositMovementMinor: number;
  }[]>;
  allEntryDates(): Promise<{ table: string; id: number; entryDate: string }[]>;
  zeroAmountEntries(): Promise<{ id: number; customerAccountId: number; entryDate: string }[]>;
  loans(): Promise<Loan[]>;
  investments(): Promise<Investment[]>;
  fieldSurveyChecks(): Promise<FieldSurveyCheck[]>;
  passbookChecks(): Promise<PassbookCheck[]>;
  /** Zone-and-day deposit + card-sale-cash totals, for "Compare with Office
   * Records" zone-sheet matching. Mirrors moneymanager-standalone-src/src/
   * data/office-records-comparison.repository.ts's getZoneCollectionsByDate
   * exactly (see lib/moneymanager/office-records/compare.ts). */
  zoneCollectionsByDate(dateFrom: string, dateTo: string): Promise<{
    zoneName: string;
    entryDate: string;
    amountMinor: number;
  }[]>;
  /** Withdrawal rows for office-sheet matching, in the same shape as
   * moneymanager-standalone-src's getWithdrawalsForMatching. */
  withdrawalsForMatching(dateFrom: string, dateTo: string): Promise<{
    entryDate: string;
    customerName: string;
    amountMinor: number;
    commissionMinor: number;
    hasStructuredRecord: boolean;
  }[]>;
  /** The latest business date this source's MoneyManager-side data actually
   * covers, as an ISO 'YYYY-MM-DD' string - the "as of" date the Phase 4A
   * classification layer (lib/moneymanager/classification/) uses to tell a
   * real discrepancy apart from a comparison that only looks wrong because
   * this source's data simply doesn't reach that far yet (e.g. a stale
   * offline snapshot exported days before "today"). Deliberately part of
   * the shared interface, not a SnapshotReader-only concept: a live
   * desktop-LAN or web/VPS adapter (not built in this phase) would
   * implement this too, typically returning something close to "now" since
   * a live source has no export-time staleness - the classification logic
   * that reads this value never needs to know or care which concrete
   * adapter produced it. Returns null only if no plausible business date
   * can be determined at all (never a best-guess/implausible date - see
   * SnapshotReader's implementation for how it excludes corrupted rows). */
  dataAsOfDate(): Promise<string | null>;
  /** Local resource cleanup only (closing a db handle, or a no-op for an
   * HTTP client) - never itself a network fetch, so this stays synchronous
   * even though every data-query method above is async. */
  close(): void;
}

/**
 * NOT IMPLEMENTED - Phase 4 stub only. Type signature + intended mechanism
 * documented here so a future implementation has a fixed shape to build
 * against; no network code, no credentials, nothing live.
 *
 * Two distinct future sources, per the user's roadmap (desktop/offline is
 * primary now; web/VPS is added later as an alternate, not a replacement):
 *
 * 1. Desktop-LAN adapter (recommended production mechanism for the desktop
 *    source - see documentation/moneymanager-monitoring.md's "Desktop
 *    integration: recommended production mechanism" section). MoneyManager's
 *    desktop app already runs `startLanServer()` (moneymanager-standalone-
 *    src/src/main/lan-server/start-lan-server.ts) - the exact same Express
 *    app/API as moneymanager.kbrisks.com, bound to the office LAN instead of
 *    the internet, backed by the desktop's own already-open sqlite
 *    connection. A future WebApiSource implementation should call THIS
 *    local HTTP API (with a dedicated read-only-scoped account, once one
 *    exists) rather than ever opening MoneyManager's raw .sqlite3 file
 *    directly in a production setting - the file can be actively
 *    written-to while the desktop app runs, and reading it out-of-band
 *    bypasses the app's own authorization/permission model entirely. Phase
 *    3's SnapshotReader reading a manually-exported, closed snapshot file
 *    is fine for offline development; it is not the recommended mechanism
 *    once this needs to run continuously against a live desktop.
 * 2. Web/VPS adapter (Phase 4, later): the same interface, implemented
 *    against moneymanager.kbrisks.com's own REST API instead, once a
 *    read-only-scoped account/role exists there (explicitly out of scope
 *    to create in this phase - see the hard constraints in
 *    documentation/moneymanager-monitoring.md).
 *
 * Either implementation would look like:
 *
 *   class WebApiSource implements MoneyManagerSource {
 *     constructor(private readonly baseUrl: string, private readonly readOnlyToken: string) {}
 *     async branches() { return this.get('/api/branches') }
 *     // ...one method per MoneyManagerSource member, over HTTP instead of SQL.
 *     close() {} // no persistent handle to release for an HTTP client
 *   }
 *
 * Still not implemented as a real class this phase - only the interface
 * conversion (Phase 4B) that a real HTTP-backed adapter needs was done:
 * MoneyManagerSource is now fully async (see the interface above), so a
 * future WebApiSource/LanApiSource can make a genuine per-method network
 * request without any further interface change. No network code, no
 * credentials, no live connection was added this phase - only the
 * plumbing that a future adapter will need already being in place.
 */
export type WebApiSourceStub = never;
