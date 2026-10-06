// Tests for scripts/mm-daily-report.ts's exit-code decision logic and its
// filesystem-based duplicate-run protection (lock + "already sent" marker).
// Importing the script does NOT re-run its CLI (main() is guarded to only
// run when this file is the process's entry module - see the bottom of the
// script) - only the exported helpers below are exercised here. Uses a
// unique, obviously-test-only (userId, businessDate) pair per test so this
// can safely run against the SAME .mm-daily-report-state/ directory a real
// invocation would use, without colliding with anything real; every test
// cleans up the file(s) it creates.
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  EXIT_CODES,
  decideExitCode,
  STATE_DIR,
  acquireRunLock,
  releaseRunLock,
  alreadySent,
  markSent,
} from '../../../scripts/mm-daily-report';

let counter = 0;
function freshKey() {
  counter++;
  return { userId: `test-cli-user-${process.pid}-${counter}`, businessDate: `1999-01-${String((counter % 28) + 1).padStart(2, '0')}` };
}

function cleanup(userId: string, businessDate: string) {
  const lock = join(STATE_DIR, `run-${userId}-${businessDate}.lock`);
  const marker = join(STATE_DIR, `sent-${userId}-${businessDate}.json`);
  if (existsSync(lock)) unlinkSync(lock);
  if (existsSync(marker)) unlinkSync(marker);
}

describe('decideExitCode - pure exit-code decision matrix', () => {
  it('monitoring completed, no send required -> SUCCESS', () => {
    assert.strictEqual(decideExitCode({ monitoringOk: true, sendRequired: false, sent: false }), EXIT_CODES.SUCCESS);
  });

  it('monitoring completed, send required and succeeded -> SUCCESS', () => {
    assert.strictEqual(decideExitCode({ monitoringOk: true, sendRequired: true, sent: true }), EXIT_CODES.SUCCESS);
  });

  it('monitoring completed, send required but failed -> NOTIFICATION_FAILURE', () => {
    assert.strictEqual(decideExitCode({ monitoringOk: true, sendRequired: true, sent: false }), EXIT_CODES.NOTIFICATION_FAILURE);
  });

  it('monitoring incomplete/failed, even if the send itself succeeded -> MONITORING_INCOMPLETE_OR_FAILED (takes priority)', () => {
    assert.strictEqual(decideExitCode({ monitoringOk: false, sendRequired: true, sent: true }), EXIT_CODES.MONITORING_INCOMPLETE_OR_FAILED);
  });

  it('monitoring incomplete/failed, no send required -> MONITORING_INCOMPLETE_OR_FAILED', () => {
    assert.strictEqual(decideExitCode({ monitoringOk: false, sendRequired: false, sent: false }), EXIT_CODES.MONITORING_INCOMPLETE_OR_FAILED);
  });
});

describe('duplicate-run protection - concurrency lock', () => {
  it('a second acquireRunLock for the same (userId, businessDate) is blocked while the first holds it', () => {
    const { userId, businessDate } = freshKey();
    try {
      const first = acquireRunLock(userId, businessDate);
      const second = acquireRunLock(userId, businessDate);
      assert.strictEqual(first, true, 'first acquire succeeds');
      assert.strictEqual(second, false, 'second concurrent acquire is blocked');
    } finally {
      cleanup(userId, businessDate);
    }
  });

  it('a different businessDate for the same user is never blocked by another date\'s lock', () => {
    const { userId, businessDate } = freshKey();
    const otherDate = '1999-02-01';
    try {
      assert.strictEqual(acquireRunLock(userId, businessDate), true);
      assert.strictEqual(acquireRunLock(userId, otherDate), true, 'a different business date is unaffected');
      releaseRunLock(userId, otherDate);
    } finally {
      cleanup(userId, businessDate);
    }
  });

  it('releasing the lock allows a subsequent run to acquire it again - a failed run remains retryable', () => {
    const { userId, businessDate } = freshKey();
    try {
      assert.strictEqual(acquireRunLock(userId, businessDate), true);
      // Simulate the run failing (never calls markSent) - main()'s `finally` always releases:
      releaseRunLock(userId, businessDate);
      assert.strictEqual(alreadySent(userId, businessDate), null, 'a failed run never creates a sent marker');
      assert.strictEqual(acquireRunLock(userId, businessDate), true, 'the lock can be re-acquired immediately for a retry');
    } finally {
      cleanup(userId, businessDate);
    }
  });
});

describe('duplicate-run protection - "already sent" idempotency marker', () => {
  it('alreadySent is null before markSent is ever called', () => {
    const { userId, businessDate } = freshKey();
    try {
      assert.strictEqual(alreadySent(userId, businessDate), null);
    } finally {
      cleanup(userId, businessDate);
    }
  });

  it('markSent makes a subsequent alreadySent check recognize the run as already completed/sent', () => {
    const { userId, businessDate } = freshKey();
    try {
      markSent(userId, businessDate, 'run-abc-123');
      const result = alreadySent(userId, businessDate);
      assert.ok(result, 'alreadySent returns a value after markSent');
      assert.strictEqual(result!.runId, 'run-abc-123');
      assert.ok(result!.sentAt.length > 0);
    } finally {
      cleanup(userId, businessDate);
    }
  });

  it('a successful repeat for the same (userId, businessDate) is distinguishable from a fresh one', () => {
    const { userId, businessDate } = freshKey();
    try {
      assert.strictEqual(alreadySent(userId, businessDate), null, 'first invocation: nothing sent yet');
      markSent(userId, businessDate, 'run-1');
      assert.ok(alreadySent(userId, businessDate), 'second invocation for the SAME date: recognized as already sent - a caller checking this never re-sends');
    } finally {
      cleanup(userId, businessDate);
    }
  });
});
