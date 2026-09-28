// Vault (GL account 10001, "Cash on Hand") reconciliation: the balance
// gl_accounts.balance_minor claims for the Vault should equal the sum of
// that account's own dr/cr movements in ledger_entries (dr increases cash,
// cr decreases it, matching the sample data: SALARY pays out of gl 1 as a
// credit, deposits post into gl 1 as a debit).
import { VAULT_ACCOUNT_CODE } from '../client/types';
import type { Finding, Rule } from './types';

export const vaultReconciliationRule: Rule = {
  ruleId: 'mm.vault_reconciliation.v1',
  description: "Per-branch Vault GL account (10001) stored balance vs computed movement total.",
  run: async ({ reader }) => {
    const findings: Finding[] = [];
    const glAccounts = await reader.glAccounts();
    const movements = await reader.glAccountMovementTotals();

    const vaultAccounts = glAccounts.filter((g) => g.accountCode === VAULT_ACCOUNT_CODE);

    if (vaultAccounts.length === 0) {
      // No Vault GL account at all is itself a finding, not silence.
      findings.push({
        findingType: 'VAULT_ACCOUNT_NOT_FOUND',
        severity: 'CRITICAL',
        entityType: 'gl_account',
        entityId: VAULT_ACCOUNT_CODE,
        expectedValue: null,
        actualValue: null,
        variance: null,
        businessDate: 'unknown',
        evidence: { reason: `No gl_accounts row with account_code ${VAULT_ACCOUNT_CODE} found.` },
        ruleId: 'mm.vault_reconciliation.v1',
      });
      return findings;
    }

    for (const vault of vaultAccounts) {
      const movement = movements.get(vault.id) ?? { drMinor: 0, crMinor: 0 };
      // ASSET account: computed balance = total debits - total credits.
      const computedBalance = movement.drMinor - movement.crMinor;
      const variance = vault.balanceMinor - computedBalance;

      if (variance !== 0) {
        findings.push({
          findingType: 'VAULT_BALANCE_MISMATCH',
          severity: Math.abs(variance) >= 1000_00 ? 'CRITICAL' : 'HIGH',
          entityType: 'gl_account',
          entityId: String(vault.id),
          expectedValue: computedBalance,
          actualValue: vault.balanceMinor,
          variance,
          businessDate: 'unknown',
          evidence: {
            branchId: vault.branchId,
            accountName: vault.accountName,
            totalDrMinor: movement.drMinor,
            totalCrMinor: movement.crMinor,
            note:
              'computedBalance = sum(ledger_entries.dr_minor) - sum(ledger_entries.cr_minor) for this GL account. ' +
              'ledger_entries only captures transactions that were posted to the GL (e.g. salary, some collections/withdrawals via mobile sync) - ' +
              'it is a narrower stream than customer_ledger_entries, so a variance here may reflect scope difference rather than a real error; ' +
              'treat as a flag for human review, not an automatic conclusion.',
          },
          ruleId: 'mm.vault_reconciliation.v1',
        });
      }
    }

    return findings;
  },
};
