// Cross-checks the customer-facing deposit total for a date (sum of
// customer_ledger_entries tagged DEPOSIT) against the Vault-side GL
// movement recorded for deposits that same date (ledger_entries with
// source = 'DEPOSIT' posted to the Vault account). These two streams are
// populated by different code paths in MoneyManager, so agreement is a
// meaningful daily consistency signal.
import type { Finding, Rule } from './types';

export const dailyTotalsRule: Rule = {
  ruleId: 'mm.daily_totals.v1',
  description: 'Daily customer-ledger DEPOSIT totals vs Vault-side DEPOSIT GL movement totals.',
  run: async ({ reader }) => {
    const findings: Finding[] = [];

    for (const day of await reader.dailyDepositTotals()) {
      const variance = day.customerLedgerDepositsMinor - day.vaultDepositMovementMinor;
      if (variance !== 0) {
        findings.push({
          findingType: 'DAILY_DEPOSIT_TOTAL_MISMATCH',
          severity: Math.abs(variance) >= 500_00 ? 'HIGH' : 'WARNING',
          entityType: 'business_date',
          entityId: day.date,
          expectedValue: day.customerLedgerDepositsMinor,
          actualValue: day.vaultDepositMovementMinor,
          variance,
          businessDate: day.date,
          evidence: {
            note:
              'Not every customer collection is necessarily posted to the GL via a DEPOSIT-sourced ledger_entries row in this snapshot - ' +
              'a nonzero variance may reflect that scope gap rather than a lost transaction. Review before treating as confirmed.',
          },
          ruleId: 'mm.daily_totals.v1',
        });
      }
    }

    return findings;
  },
};
