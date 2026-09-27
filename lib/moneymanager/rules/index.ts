import { balanceReconciliationRule } from './balanceReconciliation';
import { dailyTotalsRule } from './dailyTotals';
import { dataIntegrityRule } from './dataIntegrity';
import { duplicateTransactionsRule } from './duplicateTransactions';
import { fieldSurveyPassbookChecksRule } from './fieldSurveyPassbookChecks';
import { glReconciliationRule } from './glReconciliation';
import { loanInvestmentConsistencyRule } from './loanInvestmentConsistency';
import { missingTransactionsRule } from './missingTransactions';
import { officeRecordsComparisonRule } from './officeRecordsComparison';
import type { Finding, Rule, RuleContext } from './types';
import { vaultReconciliationRule } from './vaultReconciliation';
import { withdrawalConsistencyRule } from './withdrawalConsistency';

export const ALL_RULES: Rule[] = [
  balanceReconciliationRule,
  duplicateTransactionsRule,
  missingTransactionsRule,
  vaultReconciliationRule,
  glReconciliationRule,
  dailyTotalsRule,
  withdrawalConsistencyRule,
  loanInvestmentConsistencyRule,
  dataIntegrityRule,
  fieldSurveyPassbookChecksRule,
  officeRecordsComparisonRule,
];

export type RuleRunResult = {
  ruleId: string;
  findings: Finding[];
  error: string | null;
};

/** Runs every rule against the same RuleContext. A single rule throwing (a
 * bug, an unexpected null) or rejecting (officeRecordsComparisonRule's
 * network I/O - though that rule already catches its own fetch/parse
 * errors into findings, this is the last-resort safety net) does not abort
 * the whole run - it is recorded as a per-rule error and the run
 * orchestrator (lib/moneymanager/run.ts) decides whether that makes the
 * overall run 'incomplete'. Rules run in a fixed order.
 *
 * Ten of eleven rules are synchronous and side-effect-free (same source
 * content in, same Finding[] out, always) - officeRecordsComparisonRule is
 * the sole documented exception (see its file header). `rule.run` may
 * return a Promise or a plain array; awaiting a non-Promise value is a
 * no-op, so this one async-aware loop covers both without forcing the
 * other ten rules to become async. */
export async function runAllRules(ctx: RuleContext): Promise<RuleRunResult[]> {
  const results: RuleRunResult[] = [];
  for (const rule of ALL_RULES) {
    try {
      const findings = await rule.run(ctx);
      results.push({ ruleId: rule.ruleId, findings, error: null });
    } catch (err) {
      results.push({ ruleId: rule.ruleId, findings: [], error: (err as Error).message });
    }
  }
  return results;
}

export * from './types';
