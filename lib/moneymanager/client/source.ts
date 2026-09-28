// The data-query contract every MoneyManager source must implement. Rules
// (lib/moneymanager/rules/*.ts) depend on THIS interface, not on
// SnapshotReader concretely - so a rule written today keeps working
// unchanged when a second source is added later (see WebApiSource below).
//
// This is deliberately just an extraction of SnapshotReader's existing
// public query surface (lib/moneymanager/client/snapshot.ts) - not a
// redesign. SnapshotReader already satisfies this structurally; the
// `implements` clause on it is the only place that needed to change.
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
  tableCounts(): Record<string, number>;
  branches(): Branch[];
  glAccounts(): GlAccount[];
  customerAccounts(): CustomerAccount[];
  latestLedgerBalancePerAccount(): Map<number, { entryId: number; balanceMinor: number; entryDate: string }>;
  duplicateCustomerLedgerGroups(): {
    customerAccountId: number;
    entryDate: string;
    drMinor: number;
    crMinor: number;
    details: string | null;
    count: number;
    entryIds: number[];
  }[];
  duplicateReceiptNumbers(): { receiptNo: string; count: number; entryIds: number[] }[];
  orphanedCustomerLedgerEntries(): { id: number; customerAccountId: number; entryDate: string }[];
  orphanedLedgerEntries(): { id: number; glAccountId: number; entryDate: string }[];
  orphanedWithdrawalRecords(): { customerLedgerEntryId: number; customerAccountId: number }[];
  withdrawalRecordsWithLedgerEntry(): {
    record: WithdrawalRecord;
    ledgerEntry: { drMinor: number; crMinor: number; balanceMinor: number } | null;
  }[];
  glAccountMovementTotals(): Map<number, { drMinor: number; crMinor: number }>;
  ledgerBatchTotals(): { batchNo: string; drMinor: number; crMinor: number; entryCount: number }[];
  ledgerTotals(): { drMinor: number; crMinor: number };
  dailyDepositTotals(): {
    date: string;
    customerLedgerDepositsMinor: number;
    vaultDepositMovementMinor: number;
  }[];
  allEntryDates(): { table: string; id: number; entryDate: string }[];
  zeroAmountEntries(): { id: number; customerAccountId: number; entryDate: string }[];
  loans(): Loan[];
  investments(): Investment[];
  fieldSurveyChecks(): FieldSurveyCheck[];
  passbookChecks(): PassbookCheck[];
  /** Zone-and-day deposit + card-sale-cash totals, for "Compare with Office
   * Records" zone-sheet matching. Mirrors moneymanager-standalone-src/src/
   * data/office-records-comparison.repository.ts's getZoneCollectionsByDate
   * exactly (see lib/moneymanager/office-records/compare.ts). */
  zoneCollectionsByDate(dateFrom: string, dateTo: string): {
    zoneName: string;
    entryDate: string;
    amountMinor: number;
  }[];
  /** Withdrawal rows for office-sheet matching, in the same shape as
   * moneymanager-standalone-src's getWithdrawalsForMatching. */
  withdrawalsForMatching(dateFrom: string, dateTo: string): {
    entryDate: string;
    customerName: string;
    amountMinor: number;
    commissionMinor: number;
    hasStructuredRecord: boolean;
  }[];
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
  dataAsOfDate(): string | null;
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
 * Not defined as a real interface/class yet because every method on
 * MoneyManagerSource is currently synchronous (matching SnapshotReader's
 * synchronous sqlite reads) - an HTTP-backed adapter's methods would need
 * to be async, which changes every rule's call site. That's a real,
 * deliberate Phase 4 decision (async MoneyManagerSource vs. a sync facade
 * that awaits eagerly before invoking rules), not something to guess at
 * here.
 */
export type WebApiSourceStub = never;
