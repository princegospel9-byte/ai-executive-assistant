// General ledger reconciliation, three checks:
//  1. Global debits == credits across all of ledger_entries.
//  2. Per-batch (batch_no) debits == credits - each batch is meant to be
//     one balanced double-entry posting.
//  3. Each GL account's stored balance_minor vs its computed movement total
//     (asset/expense accounts: dr - cr; liability/income/equity: cr - dr).
import type { Finding, Rule } from './types';

const DEBIT_NATURE = new Set(['ASSET', 'EXPENSE']);

export const glReconciliationRule: Rule = {
  ruleId: 'mm.gl_reconciliation.v1',
  description: 'Debits vs credits balance globally, per batch, and per GL account.',
  run: ({ reader }) => {
    const findings: Finding[] = [];

    const totals = reader.ledgerTotals();
    const globalVariance = totals.drMinor - totals.crMinor;
    if (globalVariance !== 0) {
      findings.push({
        findingType: 'GL_GLOBAL_IMBALANCE',
        severity: 'CRITICAL',
        entityType: 'ledger',
        entityId: 'global',
        expectedValue: totals.crMinor,
        actualValue: totals.drMinor,
        variance: globalVariance,
        businessDate: 'unknown',
        evidence: { totalDrMinor: totals.drMinor, totalCrMinor: totals.crMinor },
        ruleId: 'mm.gl_reconciliation.v1',
      });
    }

    for (const batch of reader.ledgerBatchTotals()) {
      const variance = batch.drMinor - batch.crMinor;
      if (variance !== 0) {
        findings.push({
          findingType: 'GL_BATCH_IMBALANCE',
          severity: 'HIGH',
          entityType: 'ledger_batch',
          entityId: batch.batchNo,
          expectedValue: batch.crMinor,
          actualValue: batch.drMinor,
          variance,
          businessDate: 'unknown',
          evidence: { entryCount: batch.entryCount },
          ruleId: 'mm.gl_reconciliation.v1',
        });
      }
    }

    const movements = reader.glAccountMovementTotals();
    for (const account of reader.glAccounts()) {
      const movement = movements.get(account.id) ?? { drMinor: 0, crMinor: 0 };
      const computedBalance = DEBIT_NATURE.has(account.category)
        ? movement.drMinor - movement.crMinor
        : movement.crMinor - movement.drMinor;
      const variance = account.balanceMinor - computedBalance;
      if (variance !== 0) {
        findings.push({
          findingType: 'GL_ACCOUNT_BALANCE_MISMATCH',
          severity: Math.abs(variance) >= 1000_00 ? 'CRITICAL' : 'WARNING',
          entityType: 'gl_account',
          entityId: String(account.id),
          expectedValue: computedBalance,
          actualValue: account.balanceMinor,
          variance,
          businessDate: 'unknown',
          evidence: {
            accountCode: account.accountCode,
            accountName: account.accountName,
            category: account.category,
            totalDrMinor: movement.drMinor,
            totalCrMinor: movement.crMinor,
            note:
              'ledger_entries is a narrower stream than customer_ledger_entries for some account types; ' +
              'see mm.vault_reconciliation.v1 note on scope.',
          },
          ruleId: 'mm.gl_reconciliation.v1',
        });
      }
    }

    return findings;
  },
};
