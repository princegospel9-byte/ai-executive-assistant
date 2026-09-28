// Regression test for a real bug found during the Phase 4A architecture
// audit: n8n/Agents/Agent - Orchestrate Request.json's "Build Context
// Bundle" node fetched mm_findings.evidence (and, as of Phase 4A,
// classification/classification_reason) but never actually interpolated
// them into the text handed to the AI - making the existing
// agent_reconciliation prompt's "check the evidence note" instruction
// unenforceable, since the AI had literally never seen it.
//
// This test executes the ACTUAL jsCode string embedded in the real n8n
// workflow JSON (not a hand-written mirror of it that could silently drift
// from the real file) via node:vm, with a stubbed `$()` helper standing in
// for n8n's node-reference accessor - the same approach the real n8n
// runtime uses to expose upstream node data to a Code node, just outside
// n8n itself. A future edit that removes the evidence/classification
// rendering again would fail this test, not just look wrong on inspection.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

type N8nItem = { json: Record<string, unknown> };

function loadBuildContextBundleCode(): string {
  const path = join(process.cwd(), 'n8n', 'Agents', 'Agent - Orchestrate Request.json');
  const workflow = JSON.parse(readFileSync(path, 'utf8')) as { nodes: { name: string; parameters: { jsCode?: string } }[] };
  const node = workflow.nodes.find((n) => n.name === 'Build Context Bundle');
  if (!node || typeof node.parameters.jsCode !== 'string') {
    throw new Error('Build Context Bundle node (or its jsCode) not found in the real n8n workflow JSON.');
  }
  return node.parameters.jsCode;
}

/** Runs the real Build Context Bundle jsCode with a stubbed `$()` n8n
 * node-reference accessor. `fetchResults` maps upstream node name -> the
 * items that node would have output (n8n's own {json: ...} item shape). */
function runBuildContextBundle(fetchResults: Record<string, N8nItem[]>): { context_by_key: Record<string, string> } {
  const code = loadBuildContextBundleCode();
  const dollar = (nodeName: string) => ({
    all: () => fetchResults[nodeName] ?? [],
    first: () => (fetchResults[nodeName] ?? [])[0],
  });
  const sandbox: { $: typeof dollar; __result?: unknown } = { $: dollar };
  vm.createContext(sandbox);
  // The real n8n Code node body is a bare script ending in `return [...]` -
  // n8n itself wraps it in a function at runtime; do the same here.
  new vm.Script(`__result = (function() {\n${code}\n})();`).runInContext(sandbox);
  return (sandbox.__result as { json: { context_by_key: Record<string, string> } }[])[0].json;
}

const EMPTY_UPSTREAM_NODES: Record<string, N8nItem[]> = {
  'Fetch Active Agents': [],
  'Fetch Active Pipeline': [],
  'Fetch Business Memory': [],
  'Fetch Recent Finance Entries': [],
  'Fetch Pending Tasks': [],
  'Fetch Recent Automation Runs': [],
  'Fetch Open Support Tickets': [],
};

describe('n8n Build Context Bundle - MoneyManager findings rendering (regression for the evidence-not-rendered bug)', () => {
  it('renders evidence content and the Phase 4A classification into the AI-facing context text', () => {
    const finding = {
      severity: 'HIGH',
      rule_id: 'mm.vault_reconciliation.v1',
      finding_type: 'VAULT_BALANCE_MISMATCH',
      entity_type: 'gl_account',
      entity_id: '1',
      business_date: 'unknown',
      expected_value: 500,
      actual_value: 1000,
      variance: 500,
      classification: 'POSSIBLE_DISCREPANCY',
      classification_reason: 'ledger_entries scope gap documented on this rule',
      evidence: {
        note: 'ledger_entries is a narrower stream than customer_ledger_entries for some account types',
        accountName: 'Vault',
      },
    };

    const output = runBuildContextBundle({
      ...EMPTY_UPSTREAM_NODES,
      'Fetch Recent MM Findings': [{ json: finding }],
    });

    const reconciliationText = output.context_by_key.reconciliation;
    assert.ok(
      reconciliationText.includes('POSSIBLE_DISCREPANCY'),
      'context text must include the Phase 4A classification, not just severity'
    );
    assert.ok(
      reconciliationText.includes('ledger_entries is a narrower stream'),
      'context text must include evidence.note content - this is the exact bug: evidence was selected from Supabase but never rendered into the text the AI actually reads'
    );
    assert.ok(reconciliationText.includes('Vault'), 'context text must include other evidence fields too (accountName), not just note');

    // Same rendered text is shared across all 3 MoneyManager agent personas
    // (transaction_integrity/reconciliation/business_performance), per the
    // existing Build Context Bundle design.
    assert.strictEqual(output.context_by_key.transaction_integrity, reconciliationText);
    assert.strictEqual(output.context_by_key.business_performance, reconciliationText);
  });

  it('falls back to a clear "no findings" message when there are none, not an empty/broken string', () => {
    const output = runBuildContextBundle({ ...EMPTY_UPSTREAM_NODES, 'Fetch Recent MM Findings': [] });
    assert.ok(output.context_by_key.reconciliation.includes('No open MoneyManager monitoring findings.'));
  });
});
