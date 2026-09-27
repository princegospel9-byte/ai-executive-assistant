// Compares each customer_account's stored current_balance_minor against the
// balance the account's own ledger history claims (the balance_minor on its
// most recent non-voided customer_ledger_entries row). A mismatch means the
// account balance and its transaction trail have drifted apart.
import type { Finding, Rule } from './types';

export const balanceReconciliationRule: Rule = {
  ruleId: 'mm.balance_reconciliation.v1',
  description:
    "Customer account's current_balance_minor vs the balance on its latest ledger entry.",
  run: ({ reader }) => {
    const accounts = reader.customerAccounts();
    const latestByAccount = reader.latestLedgerBalancePerAccount();
    const findings: Finding[] = [];

    for (const account of accounts) {
      const latest = latestByAccount.get(account.id);

      if (!latest) {
        // No ledger history at all for an account that exists - only worth
        // flagging if the stored balance claims otherwise non-zero money.
        if (account.currentBalanceMinor !== 0) {
          findings.push({
            findingType: 'BALANCE_NO_LEDGER_HISTORY',
            severity: 'HIGH',
            entityType: 'customer_account',
            entityId: String(account.id),
            expectedValue: 0,
            actualValue: account.currentBalanceMinor,
            variance: account.currentBalanceMinor,
            businessDate: new Date(0).toISOString().slice(0, 10),
            evidence: {
              accountNo: account.accountNo,
              accountType: account.accountType,
              reason: 'Account has a non-zero balance but no customer_ledger_entries rows exist for it.',
            },
            ruleId: 'mm.balance_reconciliation.v1',
          });
        }
        continue;
      }

      const variance = account.currentBalanceMinor - latest.balanceMinor;
      if (variance !== 0) {
        findings.push({
          findingType: 'BALANCE_MISMATCH',
          severity: Math.abs(variance) >= 100_00 ? 'CRITICAL' : 'HIGH',
          entityType: 'customer_account',
          entityId: String(account.id),
          expectedValue: latest.balanceMinor,
          actualValue: account.currentBalanceMinor,
          variance,
          businessDate: latest.entryDate.slice(0, 10),
          evidence: {
            accountNo: account.accountNo,
            accountType: account.accountType,
            latestLedgerEntryId: latest.entryId,
          },
          ruleId: 'mm.balance_reconciliation.v1',
        });
      }
    }

    return findings;
  },
};
