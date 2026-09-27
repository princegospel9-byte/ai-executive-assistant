import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import { SnapshotReader } from '../client/snapshot';
import { runAllRules } from '../rules';
import { buildFixtureDb, type FixtureDb } from './fixtureDb';

let fixture: FixtureDb;

function open(): SnapshotReader {
  return SnapshotReader.open(fixture.path);
}

afterEach(() => {
  fixture?.close();
});

function seedCleanData(db: DatabaseSync) {
  db.exec(`insert into branches values (1, 'JACOL', 'Jacol Susu Enterprise')`);
  db.exec(`insert into gl_accounts values (1, 1, '10001', 'Vault', 'ASSET', 500)`);
  db.exec(`insert into gl_accounts values (2, 1, '20003', 'Savings Control', 'LIABILITY', 500)`);
  db.exec(
    `insert into customer_accounts values (1, 1, 1, '1000000001', 'A B', 'Random', 500, 'ACTIVE', 0)`
  );
  db.exec(
    `insert into customer_ledger_entries values
     (1, 1, 1, '2026-09-01', 'RCT-0001', 'r1', 'DEPOSIT', 0, 500, 500, 'DEPOSIT', 'b1', null)`
  );
  db.exec(
    `insert into ledger_entries values
     (1, 1, '2026-09-01', 'r1', 'Collection', 1, 500, 0, null, 'b1', 'DEPOSIT', 1)`
  );
  db.exec(
    `insert into ledger_entries values
     (2, 1, '2026-09-01', 'r1', 'Collection', 2, 0, 500, null, 'b1', 'DEPOSIT', 1)`
  );
}

describe('deterministic rules against a clean fixture', () => {
  beforeEach(() => {
    fixture = buildFixtureDb(seedCleanData);
  });

  it('produces no findings for internally-consistent data, other than the always-emit office-records finding', async () => {
    const reader = open();
    const results = await runAllRules({ reader }); // no officeRecordsConfig -> "not configured"
    reader.close();

    const findings = results.flatMap((r) => r.findings);
    const errors = results.filter((r) => r.error);
    assert.deepStrictEqual(errors, []);
    // mm.office_records_comparison.v1 always emits exactly one finding
    // (see its file header) - every other rule, including
    // mm.field_survey_passbook_checks.v1, is silent on clean data, so a
    // clean fixture with no office-records config wired up should produce
    // exactly this one "not configured" finding.
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].findingType, 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_NOT_CONFIGURED');
    assert.strictEqual(findings[0].severity, 'WARNING');
  });

  it('is deterministic: running twice against the same snapshot yields identical findings', async () => {
    const reader1 = open();
    const results1 = (await runAllRules({ reader: reader1 })).flatMap((r) => r.findings);
    reader1.close();

    const reader2 = open();
    const results2 = (await runAllRules({ reader: reader2 })).flatMap((r) => r.findings);
    reader2.close();

    assert.deepStrictEqual(results2, results1);
  });
});

describe('balance reconciliation', () => {
  beforeEach(() => {
    fixture = buildFixtureDb((db) => {
      seedCleanData(db);
      // Corrupt the stored balance so it disagrees with the ledger history.
      db.exec(`update customer_accounts set current_balance_minor = 999 where id = 1`);
    });
  });

  it('flags a mismatch between stored balance and latest ledger balance', async () => {
    const reader = open();
    const results = await runAllRules({ reader });
    reader.close();

    const findings = results.flatMap((r) => r.findings);
    const mismatch = findings.find((f) => f.findingType === 'BALANCE_MISMATCH');
    assert.ok(mismatch);
    assert.strictEqual(mismatch.expectedValue, 500);
    assert.strictEqual(mismatch.actualValue, 999);
    assert.strictEqual(mismatch.variance, 499);
    assert.strictEqual(mismatch.entityId, '1');
  });
});

describe('duplicate transaction detection', () => {
  beforeEach(() => {
    fixture = buildFixtureDb((db) => {
      seedCleanData(db);
      // Same account/date/amount/details posted a second time.
      db.exec(
        `insert into customer_ledger_entries values
         (2, 1, 1, '2026-09-01', 'RCT-0002', 'r2', 'DEPOSIT', 0, 500, 1000, 'DEPOSIT', 'b2', null)`
      );
    });
  });

  it('flags the duplicate group', async () => {
    const reader = open();
    const results = await runAllRules({ reader });
    reader.close();

    const findings = results.flatMap((r) => r.findings);
    const dup = findings.find((f) => f.findingType === 'DUPLICATE_LEDGER_ENTRY_GROUP');
    assert.ok(dup);
    assert.strictEqual(dup.actualValue, 2);
  });
});

describe('missing/orphaned transaction detection', () => {
  beforeEach(() => {
    fixture = buildFixtureDb((db) => {
      seedCleanData(db);
      // A ledger entry pointing at a customer_account_id that doesn't exist.
      db.exec(
        `insert into customer_ledger_entries values
         (3, 1, 999, '2026-09-02', 'RCT-0003', 'r3', 'DEPOSIT', 0, 200, 200, 'DEPOSIT', 'b3', null)`
      );
    });
  });

  it('flags the orphaned customer_ledger_entry', async () => {
    const reader = open();
    const results = await runAllRules({ reader });
    reader.close();

    const findings = results.flatMap((r) => r.findings);
    const orphan = findings.find((f) => f.findingType === 'ORPHANED_CUSTOMER_LEDGER_ENTRY');
    assert.ok(orphan);
    assert.strictEqual(orphan.entityId, '3');
  });
});

describe('vault reconciliation', () => {
  beforeEach(() => {
    fixture = buildFixtureDb((db) => {
      seedCleanData(db);
      // Stored Vault balance no longer matches its own movement total.
      db.exec(`update gl_accounts set balance_minor = 12345 where account_code = '10001'`);
    });
  });

  it('flags the Vault balance mismatch', async () => {
    const reader = open();
    const results = await runAllRules({ reader });
    reader.close();

    const findings = results.flatMap((r) => r.findings);
    const mismatch = findings.find((f) => f.findingType === 'VAULT_BALANCE_MISMATCH');
    assert.ok(mismatch);
    assert.strictEqual(mismatch.actualValue, 12345);
    assert.strictEqual(mismatch.expectedValue, 500); // 500 dr - 0 cr
  });

  it('flags a missing Vault account outright rather than staying silent', async () => {
    const noVaultFixture = buildFixtureDb((db) => {
      db.exec(`insert into branches values (1, 'JACOL', 'Jacol Susu Enterprise')`);
    });
    const reader = SnapshotReader.open(noVaultFixture.path);
    const results = await runAllRules({ reader });
    reader.close();
    noVaultFixture.close();

    const findings = results.flatMap((r) => r.findings);
    assert.ok(findings.some((f) => f.findingType === 'VAULT_ACCOUNT_NOT_FOUND'));
  });
});

describe('GL reconciliation', () => {
  beforeEach(() => {
    fixture = buildFixtureDb((db) => {
      seedCleanData(db);
      // Unbalance the batch: dr 500 but cr only 400.
      db.exec(`update ledger_entries set cr_minor = 400 where id = 2`);
    });
  });

  it('flags the batch imbalance and the global imbalance', async () => {
    const reader = open();
    const results = await runAllRules({ reader });
    reader.close();

    const findings = results.flatMap((r) => r.findings);
    assert.ok(findings.some((f) => f.findingType === 'GL_BATCH_IMBALANCE'));
    assert.ok(findings.some((f) => f.findingType === 'GL_GLOBAL_IMBALANCE'));
  });
});

describe('customer balance mismatch is distinct from Vault mismatch', () => {
  it('both can fire independently from the same fixture', async () => {
    fixture = buildFixtureDb((db) => {
      seedCleanData(db);
      db.exec(`update customer_accounts set current_balance_minor = 1 where id = 1`);
      db.exec(`update gl_accounts set balance_minor = 1 where account_code = '10001'`);
    });
    const reader = open();
    const results = await runAllRules({ reader });
    reader.close();
    const findings = results.flatMap((r) => r.findings);
    assert.ok(findings.some((f) => f.findingType === 'BALANCE_MISMATCH'));
    assert.ok(findings.some((f) => f.findingType === 'VAULT_BALANCE_MISMATCH'));
  });
});

describe('withdrawal consistency', () => {
  beforeEach(() => {
    fixture = buildFixtureDb((db) => {
      seedCleanData(db);
      db.exec(
        `insert into customer_ledger_entries values
         (4, 1, 1, '2026-09-03', 'RCT-0004', 'r4', 'Withdrawal', 300, 0, 200, 'Withdrawal', 'b4', null)`
      );
      // amount_minor (250) disagrees with the ledger entry's dr_minor (300).
      db.exec(
        `insert into withdrawal_records values
         (4, 1, 1, 500, 250, 0, 200, null, null, '2026-09-03T10:00:00.000Z')`
      );
    });
  });

  it('flags the withdrawal amount mismatch', async () => {
    const reader = open();
    const results = await runAllRules({ reader });
    reader.close();

    const findings = results.flatMap((r) => r.findings);
    const mismatch = findings.find((f) => f.findingType === 'WITHDRAWAL_AMOUNT_MISMATCH');
    assert.ok(mismatch);
    assert.strictEqual(mismatch.expectedValue, 300);
    assert.strictEqual(mismatch.actualValue, 250);
  });
});

describe('data integrity: implausible dates', () => {
  beforeEach(() => {
    fixture = buildFixtureDb((db) => {
      seedCleanData(db);
      db.exec(
        `insert into customer_ledger_entries values
         (5, 1, 1, '0202-03-06', 'RCT-0005', 'r5', 'DEPOSIT', 0, 100, 600, 'DEPOSIT', 'b5', null)`
      );
    });
  });

  it('flags the malformed entry_date', async () => {
    const reader = open();
    const results = await runAllRules({ reader });
    reader.close();

    const findings = results.flatMap((r) => r.findings);
    const bad = findings.find(
      (f) => f.findingType === 'IMPLAUSIBLE_ENTRY_DATE' && f.entityId === '5'
    );
    assert.ok(bad);
  });
});

describe('Field survey / passbook checks - clean case', () => {
  beforeEach(() => {
    fixture = buildFixtureDb(seedCleanData);
  });

  it('emits nothing when there are no survey/passbook mismatches (silent-when-clean, unlike officeRecordsComparison)', async () => {
    const reader = open();
    const results = await runAllRules({ reader });
    reader.close();

    const findings = results.flatMap((r) => r.findings);
    const fieldSurveyFindings = findings.filter((f) => f.ruleId === 'mm.field_survey_passbook_checks.v1');
    assert.deepStrictEqual(fieldSurveyFindings, []);
  });
});

describe('Field survey / passbook checks - field survey mismatch', () => {
  beforeEach(() => {
    fixture = buildFixtureDb((db) => {
      seedCleanData(db);
      // System shows more than the field-verified passbook - an OVER
      // mismatch, the direction MoneyManager's own schema singles out.
      db.exec(
        `insert into field_survey_checks values
         (1, 1, 4, '2026-09-10T07:33:27.507Z', 10000, 16000, 6000, 'MISMATCH')`
      );
    });
  });

  it('flags the mismatch under the honest FIELD_SURVEY_MISMATCH finding type', async () => {
    const reader = open();
    const results = await runAllRules({ reader });
    reader.close();

    const findings = results.flatMap((r) => r.findings);
    const mismatch = findings.find((f) => f.findingType === 'FIELD_SURVEY_MISMATCH');
    assert.ok(mismatch);
    assert.strictEqual(mismatch.ruleId, 'mm.field_survey_passbook_checks.v1');
    assert.strictEqual(mismatch.expectedValue, 10000);
    assert.strictEqual(mismatch.actualValue, 16000);
    assert.strictEqual(mismatch.variance, 6000);
    assert.strictEqual(mismatch.entityId, '1');
  });
});

describe('Field survey / passbook checks - open passbook check', () => {
  beforeEach(() => {
    fixture = buildFixtureDb((db) => {
      seedCleanData(db);
      db.exec(
        `insert into passbook_checks values
         (1, 1, '2026-09-18T09:33:25.670Z', 104100, 102100, -2000, 'OPEN')`
      );
      // A resolved mismatch must NOT be flagged - staff already handled it.
      db.exec(
        `insert into passbook_checks values
         (2, 1, '2026-09-18T09:00:18.625Z', 130000, 128000, -2000, 'RESOLVED')`
      );
    });
  });

  it('flags only the OPEN mismatch, not the RESOLVED one', async () => {
    const reader = open();
    const results = await runAllRules({ reader });
    reader.close();

    const findings = results.flatMap((r) => r.findings);
    const openFindings = findings.filter((f) => f.findingType === 'PASSBOOK_CHECK_OPEN');
    assert.strictEqual(openFindings.length, 1);
    assert.strictEqual(openFindings[0].evidence && (openFindings[0].evidence as { passbookCheckId: number }).passbookCheckId, 1);
  });
});

describe('Office Records comparison - not configured (default)', () => {
  beforeEach(() => {
    fixture = buildFixtureDb(seedCleanData);
  });

  it('always emits exactly one NOT_CONFIGURED finding when no config is supplied to RuleContext', async () => {
    const reader = open();
    const results = await runAllRules({ reader }); // no officeRecordsConfig passed
    reader.close();

    const findings = results.flatMap((r) => r.findings);
    const officeFindings = findings.filter((f) => f.ruleId === 'mm.office_records_comparison.v1');
    assert.strictEqual(officeFindings.length, 1);
    assert.strictEqual(officeFindings[0].findingType, 'SAVINGS_COMPARE_WITH_OFFICE_RECORDS_NOT_CONFIGURED');
    assert.strictEqual(officeFindings[0].severity, 'WARNING');
  });
});

describe('Field survey / passbook checks - determinism across repeated runs', () => {
  it('produces the exact same findings twice', async () => {
    fixture = buildFixtureDb((db) => {
      seedCleanData(db);
      db.exec(
        `insert into field_survey_checks values
         (1, 1, 4, '2026-09-10T07:33:27.507Z', 10000, 16000, 6000, 'MISMATCH')`
      );
    });

    const reader1 = open();
    const findings1 = (await runAllRules({ reader: reader1 })).flatMap((r) => r.findings);
    reader1.close();

    const reader2 = open();
    const findings2 = (await runAllRules({ reader: reader2 })).flatMap((r) => r.findings);
    reader2.close();

    assert.deepStrictEqual(findings2, findings1);
  });
});
