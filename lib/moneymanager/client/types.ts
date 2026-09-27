// Normalized shapes read from the MoneyManager sqlite snapshot. These are
// intentionally narrow - only the columns the monitoring rules actually use,
// not a full mirror of MoneyManager's schema. Money is kept in minor units
// (pesewas/cents) exactly as MoneyManager stores it - no float conversion,
// so comparisons stay exact.

export type Branch = {
  id: number;
  code: string;
  name: string;
};

export type GlAccount = {
  id: number;
  branchId: number;
  accountCode: string;
  accountName: string;
  category: string; // 'ASSET' | 'LIABILITY' | 'INCOME' | 'EXPENSE' | 'EQUITY'
  balanceMinor: number;
};

export type CustomerAccount = {
  id: number;
  branchId: number;
  customerId: number;
  accountNo: string;
  accountName: string;
  accountType: string;
  currentBalanceMinor: number;
  accountStatus: string;
  dormant: boolean;
};

export type CustomerLedgerEntry = {
  id: number;
  branchId: number;
  customerAccountId: number;
  entryDate: string; // ISO string as stored, may be malformed
  receiptNo: string | null;
  refNo: string | null;
  details: string | null;
  drMinor: number;
  crMinor: number;
  balanceMinor: number;
  tag: string | null;
  batchNo: string | null;
  voidedAt: string | null;
};

export type LedgerEntry = {
  id: number;
  branchId: number;
  entryDate: string;
  refNo: string | null;
  details: string | null;
  glAccountId: number;
  drMinor: number;
  crMinor: number;
  tag: string | null;
  batchNo: string | null;
  source: string | null;
  customerLedgerEntryId: number | null;
};

export type WithdrawalRecord = {
  customerLedgerEntryId: number;
  branchId: number;
  customerAccountId: number;
  machineBalanceBeforeMinor: number;
  amountMinor: number;
  commissionMinor: number;
  balanceAfterMinor: number;
  passbookBalanceMinor: number | null;
  passbookDifferenceMinor: number | null;
  recordedAt: string;
};

export type Voucher = {
  id: number;
  branchId: number;
  voucherNo: string;
  voucherDate: string;
  status: string;
};

export type VoucherLine = {
  id: number;
  voucherId: number;
  glAccountId: number;
  drMinor: number;
  crMinor: number;
};

export type Loan = {
  id: number;
  loanRef: string;
  customerAccountId: number;
  principalMinor: number;
  status: string;
};

export type Investment = {
  id: number;
  investmentRef: string;
  customerAccountId: number;
  principalMinor: number;
  status: string;
};

/** MoneyManager's own field-verification survey: compares the customer's
 * physical passbook balance against the system balance at survey time.
 * Mirrors mm-server-actual/src/data/field-survey-checks.repository.ts
 * exactly: differenceMinor = systemBalanceMinor - passbookBalanceMinor,
 * status 'MATCHED' | 'MISMATCH'. NOTE: this is NOT MoneyManager's "Compare
 * with Office Records" feature (an earlier investigation mistook it for
 * that - corrected; see lib/moneymanager/rules/officeRecordsComparison.ts
 * for the real one, sourced from Google Sheets, not this table). This
 * table backs the separate lib/moneymanager/rules/
 * fieldSurveyPassbookChecks.ts rule instead. */
export type FieldSurveyCheck = {
  id: number;
  customerAccountId: number;
  workerId: number | null;
  surveyedAt: string;
  passbookBalanceMinor: number;
  systemBalanceMinor: number;
  differenceMinor: number;
  status: string; // 'MATCHED' | 'MISMATCH'
};

/** MoneyManager's other passbook-vs-system comparison mechanism: a
 * withdrawal-time spot check with its own resolution workflow (distinct
 * from the field_survey_checks bulk survey - see
 * mm-server-actual/src/business/passbook-checks/). Only 'OPEN' (unresolved)
 * mismatches are actionable; 'RESOLVED' ones have already been handled by
 * staff. */
export type PassbookCheck = {
  id: number;
  customerAccountId: number;
  checkedAt: string;
  passbookBalanceMinor: number;
  systemBalanceMinor: number;
  differenceMinor: number;
  status: string; // 'OPEN' | 'RESOLVED'
};

/** The set of tables/columns this adapter depends on. Used to validate the
 * snapshot before any rule runs, so a schema drift fails loudly instead of
 * silently reading nulls/zeros. */
export const EXPECTED_SCHEMA: Record<string, string[]> = {
  branches: ['id', 'code', 'name'],
  gl_accounts: ['id', 'branch_id', 'account_code', 'account_name', 'category', 'balance_minor'],
  customer_accounts: [
    'id',
    'branch_id',
    'customer_id',
    'account_no',
    'account_name',
    'account_type',
    'current_balance_minor',
    'account_status',
    'dormant',
  ],
  customer_ledger_entries: [
    'id',
    'branch_id',
    'customer_account_id',
    'entry_date',
    'receipt_no',
    'ref_no',
    'details',
    'dr_minor',
    'cr_minor',
    'balance_minor',
    'tag',
    'batch_no',
    'voided_at',
  ],
  ledger_entries: [
    'id',
    'branch_id',
    'entry_date',
    'ref_no',
    'details',
    'gl_account_id',
    'dr_minor',
    'cr_minor',
    'tag',
    'batch_no',
    'source',
    'customer_ledger_entry_id',
  ],
  withdrawal_records: [
    'customer_ledger_entry_id',
    'branch_id',
    'customer_account_id',
    'machine_balance_before_minor',
    'amount_minor',
    'commission_minor',
    'balance_after_minor',
    'passbook_balance_minor',
    'passbook_difference_minor',
    'recorded_at',
  ],
  vouchers: ['id', 'branch_id', 'voucher_no', 'voucher_date', 'status'],
  voucher_lines: ['id', 'voucher_id', 'gl_account_id', 'dr_minor', 'cr_minor'],
  loans: ['id', 'loan_ref', 'customer_account_id', 'principal_minor', 'status'],
  investments: ['id', 'investment_ref', 'customer_account_id', 'principal_minor', 'status'],
  zones: ['id', 'branch_id', 'name'],
  customers: ['id', 'branch_id', 'full_name', 'zone_id'],
  field_survey_checks: [
    'id',
    'customer_account_id',
    'worker_id',
    'surveyed_at',
    'passbook_balance_minor',
    'system_balance_minor',
    'difference_minor',
    'status',
  ],
  passbook_checks: [
    'id',
    'customer_account_id',
    'checked_at',
    'passbook_balance_minor',
    'system_balance_minor',
    'difference_minor',
    'status',
  ],
};

/** GL account code MoneyManager uses for the per-branch Vault (cash on hand). */
export const VAULT_ACCOUNT_CODE = '10001';
