// Loan/investment consistency. The reference snapshot has zero rows in
// loans/loan_repayments/loan_schedule_items/loan_penalties/investments/
// investment_payouts (this business has not disbursed any loans or
// investments yet) - so there is real data to validate an empty-table case
// against, but no non-trivial cross-checks can be exercised. This rule only
// does the one check the schema genuinely supports without inventing
// business logic: a loan/investment whose customer_account_id doesn't
// exist. If the tables are empty, it correctly returns no findings - that
// is a legitimate "nothing to check" result, not a fail-safe violation,
// because the adapter already validated the tables/columns exist (see
// SnapshotReader.validateSchema) before this rule runs.
import type { Finding, Rule } from './types';

export const loanInvestmentConsistencyRule: Rule = {
  ruleId: 'mm.loan_investment_consistency.v1',
  description:
    'Loans/investments referencing a nonexistent customer_account_id. Deeper schedule/repayment ' +
    'reconciliation is deferred - see documentation/moneymanager-monitoring.md limitations.',
  run: async ({ reader }) => {
    const findings: Finding[] = [];
    const accountIds = new Set((await reader.customerAccounts()).map((a) => a.id));

    for (const loan of await reader.loans()) {
      if (!accountIds.has(loan.customerAccountId)) {
        findings.push({
          findingType: 'LOAN_ORPHANED_CUSTOMER_ACCOUNT',
          severity: 'CRITICAL',
          entityType: 'loan',
          entityId: String(loan.id),
          expectedValue: null,
          actualValue: null,
          variance: null,
          businessDate: 'unknown',
          evidence: { loanRef: loan.loanRef, missingCustomerAccountId: loan.customerAccountId },
          ruleId: 'mm.loan_investment_consistency.v1',
        });
      }
    }

    for (const investment of await reader.investments()) {
      if (!accountIds.has(investment.customerAccountId)) {
        findings.push({
          findingType: 'INVESTMENT_ORPHANED_CUSTOMER_ACCOUNT',
          severity: 'CRITICAL',
          entityType: 'investment',
          entityId: String(investment.id),
          expectedValue: null,
          actualValue: null,
          variance: null,
          businessDate: 'unknown',
          evidence: {
            investmentRef: investment.investmentRef,
            missingCustomerAccountId: investment.customerAccountId,
          },
          ruleId: 'mm.loan_investment_consistency.v1',
        });
      }
    }

    return findings;
  },
};
