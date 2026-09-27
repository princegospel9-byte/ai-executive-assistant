# MoneyManager Monitoring (Phase 10, offline)

MoneyManager is a separate, already-production financial system
(susu/savings business) with two faces: a desktop Electron app
(`moneymanager-standalone-src`, PRIMARY per the user's roadmap) and a web/VPS
deployment at `moneymanager.kbrisks.com` (added later, as an alternate
source, not a replacement). This phase does **not** connect to either live.
It reads a periodically exported, read-only sqlite snapshot of the desktop
app's own database and runs a deterministic rule engine over it, same "app
layer stays thin, decisions stay inspectable" discipline as
`lib/business/health-score.ts`. One rule (`officeRecordsComparison.ts`) also
reads Google Sheets - a third-party source MoneyManager's own real feature
already depends on, not MoneyManager itself - see that section below.

## Architecture

```
MoneyManagerSource (interface, lib/moneymanager/client/source.ts)
  |
  +-- SnapshotReader (concrete, lib/moneymanager/client/snapshot.ts)
  |     desktop/offline adapter: opens a manually-exported sqlite snapshot
  |     read-only, validates schema, exposes typed queries. Throws
  |     SnapshotIncompleteError on anything missing - never returns empty
  |     data silently. THE implementation used by this phase.
  |
  +-- (Phase 4, NOT implemented) a desktop-LAN or web/VPS adapter -
        see "Source adapter architecture" below.
        │
        ▼
lib/moneymanager/rules/*.ts            Rule functions taking a
                                        MoneyManagerSource, not a concrete
                                        SnapshotReader - substitutable
                                        without rewriting any rule. Ten of
                                        eleven are pure/synchronous/
                                        deterministic; officeRecordsComparison.ts
                                        is the sole async, network-calling
                                        exception (Google Sheets only).
        │
        ▼
lib/moneymanager/run.ts                Orchestrates one monitoring run:
                                        creates an mm_monitoring_runs row,
                                        runs all rules, dedupes + upserts
                                        findings, creates alerts, records a
                                        checkpoint, finishes the run with a
                                        status.
        │
        ▼
Supabase (mm_monitoring_runs, mm_findings, mm_alerts, mm_sync_checkpoints,
          mm_office_records_config)
        │
        ▼
n8n: Agent - Orchestrate Request        Fetches recent mm_findings and hands
                                         them (Finding[] only) to three
                                         specialist agents via the existing
                                         AI - Process Request sub-workflow.
```

## Source adapter architecture (desktop primary now, web/VPS later)

Per the user's roadmap: the desktop/offline MoneyManager is the PRIMARY
source now; a web/VPS source gets added LATER as an alternate, without
rewriting the deterministic rules. This is achieved with one interface:

- **`MoneyManagerSource`** (`lib/moneymanager/client/source.ts`) - the data-
  query contract every source must implement (one method per query the
  rules actually use: `branches()`, `glAccounts()`, `customerAccounts()`,
  `zoneCollectionsByDate()`, `withdrawalsForMatching()`, etc.). This is an
  *extraction*, not a redesign: it's exactly `SnapshotReader`'s existing
  public method surface, unchanged.
- **`SnapshotReader implements MoneyManagerSource`** - the one line that
  actually changed on the class itself. Everything else about it (how it
  opens a file, validates schema, runs SQL) is untouched.
- **Every rule's `RuleContext.reader` is typed `MoneyManagerSource`**, not
  `SnapshotReader` (`lib/moneymanager/rules/types.ts`). Because TypeScript
  is structurally typed and every rule already only called methods that
  exist on the interface, this required zero changes inside any of the
  eleven rule files themselves - confirmed by `npx tsc --noEmit` passing
  unchanged. This is the actual substitutability win: a future adapter that
  implements `MoneyManagerSource` plugs into every existing rule with no
  rule-file edits.
- **`WebApiSourceStub`** (bottom of `source.ts`) - a documented-but-NOT-
  implemented type comment (no class, no network code, no credentials) for
  Phase 4. See the desktop-LAN recommendation directly below for which
  mechanism a real implementation should call.

### Desktop integration: recommended production mechanism (investigated, not implemented)

The task asked explicitly: don't assume the desktop app should expose its
raw `.sqlite3` file to the agent in production. Investigated
`moneymanager-standalone-src/src/main/lan-server/start-lan-server.ts`:
MoneyManager's desktop app already runs `startLanServer()` - **the exact
same Express app/API as `moneymanager.kbrisks.com`**, just bound to
`0.0.0.0` on the office LAN instead of the internet, backed by the
desktop's own already-open, already-migrated sqlite connection (see that
file's own doc comment: "so other computers on the LAN see the exact same
live data as this desktop window, each logging in with their own
account"). `manage-lan-host.ts`/`local-network-addresses.ts` round out
starting/stopping it and discovering the LAN address to connect to.

**Recommendation for Phase 4**: a production desktop adapter should call
this already-running local HTTP API (once a dedicated read-only-scoped
account/role exists on it - none does today, and creating one is
explicitly out of scope here) rather than ever opening the raw `.sqlite3`
file directly in production. Two concrete reasons this matters, both
observed directly in this codebase:
1. **The file can be actively written to** while the desktop app runs -
   reading it out-of-band risks reading a half-written page or, worse,
   requires bypassing sqlite's own locking in a way the desktop app doesn't
   expect. Phase 3's `SnapshotReader` reading a manually-exported, *closed*
   snapshot file sidesteps this entirely - fine for offline development,
   not the shape of a continuously-running production integration.
2. **Reading the raw file bypasses the app's own authorization model**
   entirely - the LAN server already has real login/session/permission
   logic (the same Express `app` moneymanager.kbrisks.com runs); a raw-file
   reader has none of that and would need to reinvent read-scoping from
   scratch, or over-read data no external read-only client should ever see.

This is a documented recommendation only - no LAN client code was written,
no connection was made, and `SnapshotReader` continues to be exactly what
Phase 3 needs for offline development.

## Selected snapshot

`db-backup-before-field-survey-repair-2026-09-22/jacviv-savings-manager.sqlite3`
(~263MB, real production data copy) - the most recent of five same-day
backups, with no orphaned WAL/SHM files. Treated strictly as read-only input;
never written to (`node:sqlite` `DatabaseSync(path, { readOnly: true })`).

Actual schema found on inspection (differs in places from a generic
assumption of MoneyManager's structure - this is what the adapter was built
against):

- `customer_ledger_entries`: 678,723 rows - the real transaction volume.
  `entry_date` is free-form text, not a strict date type, and at least one
  row in the real snapshot has an obviously corrupted value
  (`'0202-03-06T00:00:00.000Z'`) - `mm.data_integrity.v1` exists because of
  this genuine finding, not a hypothetical.
- `gl_accounts`: only 7 rows (one branch). Vault is `account_code = '10001'`,
  `account_name = 'Vault (Cash on Hand)'`.
- `ledger_entries`: 5,193 rows. This is a **narrower** GL posting stream than
  `customer_ledger_entries` - not every customer collection/withdrawal is
  mirrored here. Global `sum(dr_minor)` (53,638,700) does **not** equal
  `sum(cr_minor)` (253,346,920) in the real snapshot, which looks like a
  broken double-entry ledger at first glance but is very likely this scope
  gap instead. Every GL-reconciliation finding's `evidence.note` field says
  this explicitly so a human (or the AI reviewing it) doesn't jump to "fraud"
  from a scope artifact.
- `loans`, `loan_repayments`, `loan_schedule_items`, `loan_penalties`,
  `investments`, `investment_payouts`, `daily_reconciliations`,
  `fixed_deposit_products`, `financial_years`, `bank_reconciliations`: all
  **0 rows** in this snapshot - this business hasn't disbursed a loan or
  investment yet. Rules that touch these tables are scaffolded to run safely
  against an empty-but-present table (zero findings is a legitimate result
  here, not a fail-safe violation - see "Known limitations" below for how
  this is distinguished from a genuinely missing/unreadable table).
- `withdrawal_records`: only 52 rows - a narrow, purpose-built audit table
  pairing a withdrawal with its backing ledger entry and (sometimes) a
  physical passbook figure.
- `field_survey_checks`: 217 rows (150 `MISMATCH`, 67 `MATCHED`) - a real,
  legitimate field-verification signal (NOT MoneyManager's "Compare with
  Office Records" feature - see the correction below). This snapshot's own
  folder name (`db-backup-before-field-survey-repair-2026-09-22`) refers to
  this feature/incident.
- `passbook_checks`: 46 rows - a withdrawal-time passbook-vs-system spot
  check with its own `OPEN`/`RESOLVED` resolution workflow (distinct table
  from `withdrawal_records.passbook_balance_minor`, though the two are
  related via `withdrawal_records.passbook_check_id`). Also not "Compare
  with Office Records".
- `zones` (6 rows), `customers` (8,123 rows) - added to `EXPECTED_SCHEMA` for
  `officeRecordsComparison.ts`'s zone-collections query (needs each
  customer's zone name).
- **`office_records_settings` / `office_records_comparison_cache`: do NOT
  exist in this snapshot.** Confirmed directly. This feature postdates the
  snapshot - see the correction below for what this means for this phase.

## Data adapter

`lib/moneymanager/client/snapshot.ts` (`SnapshotReader`):

- Opens the file strictly read-only; throws `SnapshotIncompleteError` if the
  file doesn't exist or can't be opened read-only.
- `validateSchema()` checks every table/column in `EXPECTED_SCHEMA`
  (`lib/moneymanager/client/types.ts`) exists before any query runs, and
  closes its own db handle before rethrowing on failure (otherwise a Windows
  file lock lingers on a failed snapshot even though the caller never got a
  reader to call `.close()` on).
- Every query method returns typed, normalized shapes in minor units - no
  float conversion of money, so comparisons stay exact.
- `node:sqlite` predates the `@types/node` version this repo pins (`^20`);
  `lib/moneymanager/client/node-sqlite.d.ts` is a narrow ambient declaration
  for only the surface used here, so no global type-package upgrade was
  needed.

## Deterministic rules (`lib/moneymanager/rules/`)

Ten of eleven are pure functions: `(MoneyManagerSource) => Finding[]`, no
LLM calls, no randomness, no wall-clock reads, no I/O beyond the source.
`officeRecordsComparison.ts` is the sole documented exception (network I/O)
- see its own subsection below.

| Rule file | Findings | Snapshot support |
|---|---|---|
| `balanceReconciliation.ts` | `BALANCE_MISMATCH`, `BALANCE_NO_LEDGER_HISTORY` | Full - 8,016 accounts |
| `duplicateTransactions.ts` | `DUPLICATE_LEDGER_ENTRY_GROUP`, `DUPLICATE_RECEIPT_NUMBER` | Full |
| `missingTransactions.ts` | `ORPHANED_CUSTOMER_LEDGER_ENTRY`, `ORPHANED_GL_LEDGER_ENTRY`, `ORPHANED_WITHDRAWAL_RECORD` | Full - referential integrity only; see limitation below |
| `vaultReconciliation.ts` | `VAULT_BALANCE_MISMATCH`, `VAULT_ACCOUNT_NOT_FOUND` | Full |
| `glReconciliation.ts` | `GL_GLOBAL_IMBALANCE`, `GL_BATCH_IMBALANCE`, `GL_ACCOUNT_BALANCE_MISMATCH` | Full, with the scope-gap caveat noted above |
| `dailyTotals.ts` | `DAILY_DEPOSIT_TOTAL_MISMATCH` | Full, same scope-gap caveat |
| `withdrawalConsistency.ts` | `WITHDRAWAL_AMOUNT_MISMATCH`, `WITHDRAWAL_BALANCE_AFTER_MISMATCH`, `WITHDRAWAL_PASSBOOK_DIFFERENCE_RECOMPUTE_MISMATCH`, `WITHDRAWAL_PASSBOOK_MISMATCH` | Full - 52 rows |
| `loanInvestmentConsistency.ts` | `LOAN_ORPHANED_CUSTOMER_ACCOUNT`, `INVESTMENT_ORPHANED_CUSTOMER_ACCOUNT` | Scaffolded only - see limitation below |
| `dataIntegrity.ts` | `IMPLAUSIBLE_ENTRY_DATE`, `ZERO_AMOUNT_LEDGER_ENTRY` | Full |
| `fieldSurveyPassbookChecks.ts` | `FIELD_SURVEY_MISMATCH`, `PASSBOOK_CHECK_OPEN` | Full - 217 + 46 rows. Silent when clean (normal convention) |
| `officeRecordsComparison.ts` | `SAVINGS_COMPARE_WITH_OFFICE_RECORDS_NOT_CONFIGURED`, `_UNAVAILABLE`, `_ZONE_DIFF`, `_WITHDRAWAL_MISMATCH`, `_SUMMARY` | See below - config not yet provided |

### A correction: `fieldSurveyPassbookChecks.ts` is NOT "Compare with Office Records"

An earlier pass of this phase investigated `mm-server-actual` (grepped
exhaustively: routes, business logic, shared types, `nav-config.ts`) and,
finding no literal "Compare with Office Records" feature there, concluded
`field_survey_checks`/`passbook_checks` were the closest real match and
built a rule (then named `savingsCompareWithOfficeRecords.ts`) against them.
**That conclusion was wrong.** Inspecting screenshots of the real feature
and a newer worktree (`moneymanager-standalone-src`, ahead of
`mm-server-actual`) found the actual, already-built, ~500-line
implementation - see the next section. `field_survey_checks`/
`passbook_checks` are real MoneyManager data in their own right (a genuine
field-verification signal - 150 real `MISMATCH` rows), so rather than
deleting that work, it was renamed to `fieldSurveyPassbookChecks.ts` under
honest finding types (`FIELD_SURVEY_MISMATCH`, `PASSBOOK_CHECK_OPEN` -
dropping the `SAVINGS_COMPARE_WITH_OFFICE_RECORDS_` prefix entirely) and
reverted to the normal silent-when-clean convention (the always-emit
requirement was specific to the real "Compare with Office Records" product
ask, not to this data). Its logic (passbook vs system balance,
`differenceMinor`, OVER-direction severity bump) is unchanged from before -
only the name and product framing were corrected.

### `officeRecordsComparison.ts` - the REAL "Compare with Office Records"

Ported from `moneymanager-standalone-src/src/business/reports/
compare-office-records.ts` (~500 lines, treated as the authoritative spec -
`mm-server-actual` predates this feature entirely and does not contain it
at all). What it actually does, and what this rule reuses **exactly**, not
reinterpreted:

- A singleton settings row (`office_records_settings` on the desktop; here,
  `mm_office_records_config` in Supabase - see "Configuration" below) holds
  six staff-filled Google Sheets URLs: five zone "cash received in hand"
  sheets (`zone_a_url..zone_e_url`) and one Master Workbook
  (`master_workbook_url`).
- Each zone sheet is fetched as CSV (`docs.google.com/spreadsheets/d/{id}/
  export?format=csv`); its "total" column sits right after the `COINS`
  column (verified against a real sheet, per the reference file's own
  comment) - `lib/moneymanager/office-records/parse.ts`'s `parseZoneCsv`.
- The Master Workbook is fetched as `.xlsx` and read for two sheets:
  `DAILY SUMMARY` (`START UP`=opening, `TOTAL MOBILIZIED`=deposits,
  `WITHDRAWALS`, `EXPENDITURE`, `FROM OTHER SOURCE`, `FINAL` vs
  `TOTAL AMOUNT`=physically-counted closing cash) and `CASH OUT`
  (per-withdrawal `NAME`/`AMNT`/`COMMISSON` rows, date forward-filled
  down each day's block, terminated by a blank-name subtotal row) -
  `parseDailySummarySheet`/`parseCashOutSheet`.
- Compared against MoneyManager's **own local data** (available in the
  snapshot, unlike the Google Sheets side): zone-and-day deposit+card-sale
  totals (`reader.zoneCollectionsByDate` - ported as SQL from
  `moneymanager-standalone-src/src/data/office-records-comparison.
  repository.ts`'s `getZoneCollectionsByDate`) and withdrawal rows
  (`reader.withdrawalsForMatching`, same file's `getWithdrawalsForMatching`
  - `cle.dr_minor` is always the gross principal+commission amount; the
  structured net `withdrawal_records.amount_minor` is preferred when it
  exists, falling back to the raw ledger amount only for legacy rows).
- Withdrawals are matched with the reference file's exact multi-strategy
  matcher (`matchWithdrawalsForDate` in `parse.ts`): exact amount+name,
  then a "pre-structured-record" gross-amount+name fallback (commission
  wasn't tracked separately before that feature existed), then amount-only,
  gross-amount-only, and finally name-only.

**Implemented facets**: zone-sheet vs local-zone-collections diffing
(`_ZONE_DIFF`), and withdrawal matching (`_WITHDRAWAL_MISMATCH`).

**Deliberately NOT implemented this phase**: the reference file's third
facet, "closing balance structure" / per-day verdicts (opening/deposit/
withdraw/expense/cashReceived/closing reconciliation, plus the office's own
`FINAL`-vs-`TOTAL AMOUNT` internal-consistency check). That requires
faithfully porting MoneyManager's full Cash Book opening-balance algorithm
(`cash-book.ts`'s `getCashBook`): a 3-tier fallback (period-closing anchor →
live Vault balance worked backward → full-history sum) plus every
non-customer-ledger Vault posting (salary, vouchers, bank transfers,
journal corrections). Building a plausible-looking closing-balance number
without being able to verify it's the same algorithm would be exactly the
kind of fabrication this project has refused to do everywhere else (the
Commission and Mobilizer/Daily-Reconciliation gaps below, the six URLs
never being invented) - so it's named as a gap instead. See "What Phase 4
would need".

**Always-emit, unlike the other ten rules.** By explicit product
requirement, this check must always produce something to render, even when
clean/unconfigured/unavailable - never an absent section:
- Not configured → exactly one `SAVINGS_COMPARE_WITH_OFFICE_RECORDS_NOT_CONFIGURED`
  finding, `WARNING` (a missing setup, not a detected financial problem, but
  not nothing either), naming which URLs are missing.
- Google Sheets fetch fails (network error, or Google serving an HTML
  sign-in/permission page instead of the real file - detected exactly as
  the reference file detects it: an `<!doctype html>`/`<html` response body
  for CSV, or a missing "PK" zip signature for the `.xlsx`, with the same
  2s/5s/10s retry schedule) → exactly one `SAVINGS_COMPARE_WITH_OFFICE_RECORDS_UNAVAILABLE`
  finding whose `evidence.message` is **always** the literal string
  `"Office Records comparison could not be completed because the external
  office-record source was unavailable."` - never "no discrepancies", a
  hard requirement, tested directly.
- Successful comparison → one `_SUMMARY` finding always (`INFO` when clean,
  `WARNING` otherwise) plus `_ZONE_DIFF`/`_WITHDRAWAL_MISMATCH` findings for
  anything that didn't match. `_SUMMARY`'s evidence carries the full
  management-report shape (see "Report-readiness" below).

**Partial-incomplete, not whole-run-incomplete.** `officeRecordsComparisonRule`
never throws - "not configured" and fetch failures both become findings, not
exceptions - so an unconfigured/unavailable Google Sheets source does not
stop the other ten rules from completing normally; `mm_monitoring_runs`
still finishes `completed` overall, with the office-records finding
surfacing the gap on its own. No change to `run.ts`'s status model was
needed for this - it falls out naturally from the rule's own error handling.

**Configuration**: `mm_office_records_config` (`supabase/migrations/
0027_mm_office_records_config.sql`) - a singleton-per-user row (`user_id`
primary key), RLS-protected, following the exact same "user fills this in
via the app" pattern already established by `voice_preferences`
(`0018_voice_multimodal.sql`) rather than an env var (checked: this repo's
convention for user-editable runtime settings is a Supabase table, not
`.env`). **No URL is seeded or hardcoded anywhere** -
`lib/moneymanager/office-records/config.ts`'s `loadOfficeRecordsConfig`
returns `configured: false` with the specific missing fields named until a
human fills the row in (there is currently no settings UI page for this -
see "What's needed from the user" below).

**"New vs recurring" - not implemented, by design, not by oversight.** Same
reasoning as documented before: a rule function only ever sees one snapshot
via `RuleContext` - it has no access to prior runs' findings, so it cannot
itself classify a discrepancy as "new" vs "seen before". Already answerable
generically, for every rule's findings, one layer up:
`mm_findings.first_seen_run_id` vs `last_seen_run_id` after `run.ts`
upserts them.

### Report-readiness (not a report renderer - just confirming the data supports one)

`_SUMMARY`'s `evidence` carries every field a future report section would
need without re-deriving anything: `reportingPeriod`, `zonesChecked`,
`recordsCompared`, `matching` (withdrawal rows total/matched/unmatched),
`discrepancies` (zone-diff count, withdrawal-mismatch count, total),
`varianceTotalMinor`, `newVsRecurringIssues` (the limitation note above,
inline), `recommendedInvestigation`, and `closingBalanceStructure` (the
deferral note above, inline) - plus every `_ZONE_DIFF`/`_WITHDRAWAL_MISMATCH`
finding's own `evidence` for per-zone/per-withdrawal detail. No report
renderer was built - this phase only confirms the shape is there.

**Deferred / not built:**

- **Mobilizer/Collector activity monitoring** - not built at all. MoneyManager
  currently has no way to grant read-only access to this data without also
  granting write/manage permissions, so there's nothing safe to snapshot yet.
- **Daily Reconciliation monitoring** - not built. `daily_reconciliations`
  has 0 rows in this snapshot and the same read-without-write-access gap
  applies to how this data would normally be produced.
- **Commission verification** - not built. `mm-server-actual/src/shared/business/commission.ts`
  states plainly that commission is **no longer calculated from a formula**:
  "every withdrawal's commission is a plain amount staff type in on the
  withdrawal form." There is no formula to verify against, so inventing one
  would be fabricating business logic the real system doesn't have. If
  MoneyManager ever reintroduces a real commission formula, this would
  become a straightforward rule against `withdrawal_records.commission_minor`.
- **Deep loan/investment schedule reconciliation** - the schema exists
  (`loan_schedule_items`, `loan_penalties`, `investment_payouts`) but every
  row is empty in this snapshot, so there's no real data to validate
  non-trivial logic against without inventing it. `loanInvestmentConsistency.ts`
  only checks referential integrity (orphaned `customer_account_id`), which
  is schema-verifiable regardless of row count.

## Finding structure

Every rule returns `Finding[]` (`lib/moneymanager/rules/types.ts`):

```ts
{
  findingType: string;
  severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
  entityType: string;
  entityId: string;
  expectedValue: number | null;
  actualValue: number | null;
  variance: number | null;
  businessDate: string;
  evidence: Record<string, unknown>;
  ruleId: string;
}
```

## New Supabase tables (`supabase/migrations/0025_mm_monitoring.sql`)

- `mm_sync_checkpoints` - which snapshot (by identifier) was last processed,
  plus a row-count fingerprint.
- `mm_monitoring_runs` - one row per execution: `status`
  (`running|completed|incomplete|failed`), `business_date`,
  `snapshot_identifier`, timestamps, `incomplete_reason`, `error_message`,
  `finding_counts`.
- `mm_findings` - deduplicated finding rows, unique on `dedupe_key`.
- `mm_alerts` - HIGH/CRITICAL findings surfaced for attention, unique on
  `finding_dedupe_key`.
- `mm_agent_analysis` - AI commentary on a batch of findings.

All five have RLS enabled with the repo's standard `auth.uid() = user_id`
single-tenant policy. `finance_entries` and `business_metrics` are
**untouched** - they keep meaning exactly what they've meant since Phase 7/9
(Prince's own manual income/expense log and KBrisks' own SaaS metrics);
MoneyManager data never gets written into either.

Prompts for the three new agent personas are in
`supabase/migrations/0026_mm_monitoring_prompts.sql`, following the exact
`{{subtask}}` + `{{context}}` shape every agent prompt has used since Phase 7.

A sixth table, added for `officeRecordsComparison.ts`, is in its own
migration: `mm_office_records_config` (`supabase/migrations/
0027_mm_office_records_config.sql`) - the six Google Sheets URLs, same
`user_id` singleton-row + RLS pattern as the other five. See "Configuration"
above for why a table instead of an env var.

## Finding deduplication

`lib/moneymanager/dedupe.ts`: `dedupe_key = sha256(ruleId|entityType|entityId|businessDate|findingType)`.
These five fields identify "the same underlying problem" across repeated
runs against an unchanged snapshot. The key deliberately excludes
`expectedValue`/`actualValue`/`variance` - if a later run recomputes a
slightly different variance for the same entity+date+rule, that's the same
finding progressing, not a new one. `mm_findings` is upserted on
`dedupe_key` (`first_seen_run_id` kept, everything else refreshed), so
re-running against the same unchanged snapshot never creates duplicate rows.

## Monitoring run orchestration (`lib/moneymanager/run.ts`)

`runMonitoring({ snapshotPath, userId, persistence, businessDate?,
officeRecordsConfig?, fetchImpl?, officeRecordsDateRange? })`:

1. Opens the snapshot. If it can't open/validate, creates an
   `mm_monitoring_runs` row anyway (so the failure is visible) and marks it
   `incomplete` with the reason - **never** silently returns "no findings".
2. Runs all rules (`lib/moneymanager/rules/index.ts`'s `runAllRules`, now
   `async` - one rule, `officeRecordsComparison.ts`, does real network I/O;
   the other ten are still synchronous and awaiting a plain array is a
   no-op). A single rule throwing is caught and recorded per-rule; if any
   rule failed, the run finishes `incomplete` (not `completed`) with the
   reason listing which rule(s) and why. `officeRecordsConfig` defaults to
   "not configured" (`OFFICE_RECORDS_NOT_CONFIGURED`) when the caller
   doesn't supply one, so forgetting to wire it up still produces an
   explicit finding rather than silently skipping the rule.
3. Upserts findings (deduplicated), creates alerts for HIGH/CRITICAL
   findings, records a sync checkpoint.
4. If persistence itself throws at any point, the run finishes `failed`
   with the error message recorded.

Persistence is injected via the `MonitoringPersistence` interface
(`lib/moneymanager/persistence/types.ts`) - `SupabaseMonitoringPersistence`
(`lib/moneymanager/persistence/supabase.ts`) is the real implementation used
by the CLI; tests inject an in-memory fake
(`lib/moneymanager/__tests__/fakePersistence.ts`) so the orchestration logic
is fully testable without a live Supabase project.

## AI boundary

The AI (via `Agent - Orchestrate Request` → `AI - Process Request`) only
ever receives rows already in `mm_findings` - the `Finding[]` shape above,
rendered as plain text by the orchestrator's `Build Context Bundle` node. It
never receives the sqlite snapshot, MoneyManager credentials/session tokens,
raw ledger rows, or the Google Sheets URLs/contents `officeRecordsComparison.ts`
reads - only the `Finding[]` rows that rule produces, same as every other
rule. All three new agent prompts state this constraint explicitly and are
read-only/advisory - `requires_approval: false`, no write path to
MoneyManager (desktop or web) exists anywhere in this codebase, and no
write path to Google Sheets exists either (the fetch is `GET`-only, export
endpoints).

### New agents (seeded in `0025_mm_monitoring.sql`, reusing the existing `agents` table)

- `transaction_integrity` - duplicate/orphaned/balance-mismatch findings.
- `reconciliation` - Vault/GL findings.
- `business_performance` - trend summary across monitoring runs.

No Mobilizer/Collector agent was built (see limitations above).

### n8n change (smallest possible addition)

`n8n/Agents/Agent - Orchestrate Request.json`: one new HTTP Request node,
`Fetch Recent MM Findings` (cloned in shape from the existing `Fetch Open
Support Tickets` node - same auth headers, same `alwaysOutputData`/retry
settings), inserted into the existing linear fetch chain right before `Build
Context Bundle`. `Build Context Bundle`'s code gained one array read and
three `context_by_key` entries (`transaction_integrity`, `reconciliation`,
`business_performance`) - the router (`agent_router` prompt) and combiner
(`agent_combine_results` prompt) were not touched; they already work
generically off whatever's in the `agents` table. No other n8n workflow was
modified.

**Not done as part of this phase** (would need a real n8n environment to
verify, per the task's "no live n8n" constraint): re-linking the new HTTP
node's binding in the n8n UI on import, activating nothing new (no new
webhook was added), and updating `documentation/agent-system-module.md`'s
post-import checklist. Flagging this explicitly for whoever next imports the
updated workflow JSON into a running n8n instance.

## How to run monitoring locally

```bash
# Dry run - prints findings to stdout, writes nothing to Supabase. Office
# Records always reports "not configured" here (dry-run never touches
# Supabase, so there's no credential-free way to load the real config):
npx tsx scripts/mm-monitor.ts --snapshot "C:\path\to\snapshot.sqlite3" --dry-run

# Real run - writes to this repo's Supabase project, and loads
# mm_office_records_config for officeRecordsComparison.ts:
#   requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env
npm run mm:monitor -- --snapshot "C:\path\to\snapshot.sqlite3" --user-id <uuid> [--business-date 2026-09-22]
```

## How to run tests

```bash
npm test
```

Runs Node's built-in test runner (`node --test`) via `tsx`, scoped to
`lib/moneymanager/__tests__/*.test.ts`. Tests build small fixture sqlite
files (`lib/moneymanager/__tests__/fixtureDb.ts`) whose schema mirrors the
real snapshot's structure (as inspected once, read-only) rather than running
against the real 263MB backup - fast and doesn't depend on a
machine-specific file path. `vitest` was tried first but hit a Windows-
specific bug in the pinned Vite version's SSR module resolution for
`node:sqlite` (a newer Node built-in); Node's own test runner has no such
issue and needed no extra dependency beyond `tsx` (already added for the CLI
script). `tsx` and (briefly, then removed) `vitest` are the only new
dependencies added by this phase - `officeRecordsComparison.ts` reuses this
repo's existing `xlsx` dependency (already in `package.json`), so no new
dependency was needed for it either.

`officeRecordsComparison.ts`'s tests
(`lib/moneymanager/__tests__/officeRecordsComparison.test.ts` and
`officeRecordsParse.test.ts`) never make a real network call: `fetchImpl` is
injected and mocked with realistic synthetic CSV text and a real `.xlsx`
buffer built in-memory via the `xlsx` library itself (so the parsing code
under test round-trips through the real file format, just never over a real
network). `officeRecordsRetryDelaysMs: []` is passed in tests to skip the
real 2s/5s/10s retry schedule.

## Known limitations

- **Mobilizer/Collector activity monitoring**: deferred - no read-only
  MoneyManager access path exists yet (see above).
- **Daily Reconciliation monitoring**: deferred - same access gap, and the
  table is empty in this snapshot regardless.
- **Commission verification**: not implemented - MoneyManager no longer
  calculates commission from a formula (confirmed in
  `mm-server-actual/src/shared/business/commission.ts`); it's a plain
  staff-entered amount. There is nothing to verify it against.
- **GL scope gap**: `ledger_entries` is a narrower posting stream than
  `customer_ledger_entries` for at least some transaction types in this
  snapshot. Every Vault/GL/daily-totals finding's evidence carries a `note`
  explaining this so a variance isn't over-read as confirmed fraud - but it
  means those three rule families will need a real MoneyManager-side answer
  (which write paths post to `ledger_entries` and which don't) before their
  findings can be trusted as precise, not just directionally useful.
- **Single-snapshot rules only**: nothing here compares two snapshots over
  time to catch a transaction that was silently deleted between exports (a
  true "missing transaction" in the sense of "existed once, doesn't now").
  What's implemented is referential-integrity-within-one-snapshot instead.
- **"Compare with Office Records" new-vs-recurring classification**: not
  implemented within the rule itself (see `officeRecordsComparison.ts`
  section above) - `RuleContext` scopes a rule to one snapshot with no prior-
  run history. Already answerable generically after a run via
  `mm_findings.first_seen_run_id` vs `last_seen_run_id`, just not by the rule
  function in isolation.
- **"Compare with Office Records" - the six URLs are not yet provided.**
  Confirmed directly: `office_records_settings` doesn't exist in the Phase 3
  snapshot (the feature postdates it), and the user has not supplied the six
  real Google Sheets URLs as of this phase (screenshot showed empty
  placeholder fields - not yet configured in their own MoneyManager
  instance either). No URL was invented or hardcoded anywhere. Until a human
  fills in `mm_office_records_config`, every run reports
  `SAVINGS_COMPARE_WITH_OFFICE_RECORDS_NOT_CONFIGURED` - correctly, not as a
  bug.
- **"Compare with Office Records" - closing balance structure deferred.**
  See the dedicated note in the `officeRecordsComparison.ts` section above -
  MoneyManager's full Cash Book opening-balance algorithm was judged out of
  scope to port with real fidelity this phase.
- **No settings UI page** for `mm_office_records_config` yet - it can be
  filled in directly via Supabase (table editor or a one-off script) today;
  a `/settings`-style page for it is Phase 4 UI work, not built here.

## What Phase 4 would need

1. A real, agreed MoneyManager-side read-only export/access mechanism
   (resolving the Mobilizer/Collector/Daily-Reconciliation permission gap)
   rather than a manually-copied backup file - see "Desktop integration:
   recommended production mechanism" above for the investigated
   recommendation (the desktop's own LAN server, not the raw sqlite file).
2. Snapshot-over-snapshot comparison to catch genuinely deleted/missing
   transactions, not just broken references within one snapshot.
3. A scheduled trigger (n8n cron or otherwise) calling `runMonitoring`
   regularly instead of the manual CLI.
4. Resolving the `ledger_entries` vs `customer_ledger_entries` scope
   question with MoneyManager's own team so GL/Vault/daily-totals findings
   can be tightened from "flag for review" to "confirmed variance".
5. If MoneyManager reintroduces a real commission formula, a
   `commissionVerification.ts` rule against it.
6. The six real Google Sheets URLs, from the user, entered into
   `mm_office_records_config` (directly or via a future settings page).
7. A faithful port of MoneyManager's Cash Book opening-balance algorithm for
   `officeRecordsComparison.ts`'s closing-balance-structure facet.
8. A real `WebApiSource` implementation (`lib/moneymanager/client/source.ts`)
   - against the desktop's LAN-hosted API first (once a read-only-scoped
   account/role exists there), then optionally against
   `moneymanager.kbrisks.com` later as an alternate source, per the user's
   roadmap. Every `MoneyManagerSource` method is currently synchronous
   (matching `SnapshotReader`'s sqlite reads); an HTTP-backed adapter needs
   async methods, which is a real Phase 4 design decision (an async
   `MoneyManagerSource` vs. a sync facade that awaits eagerly before
   invoking rules) - not guessed at here.
