// Finding dedup strategy: a stable identity key derived from
// (ruleId, entityType, entityId, businessDate, findingType) - the same five
// fields identify "the same underlying problem" across repeated runs
// against an unchanged snapshot. Hashed with sha256 purely to get a fixed-
// width, storage-friendly, non-PII string for the mm_findings.dedupe_key
// unique column - not for any security property.
//
// This key deliberately excludes expectedValue/actualValue/variance: if a
// later run recomputes a slightly different variance for the same
// underlying entity+date+rule (e.g. more ledger rows arrived), it is still
// "the same finding progressing", not a new one - the mm_findings row for
// that dedupe_key gets its actual/expected/variance fields refreshed
// in-place by run.ts's upsert instead of a duplicate row being inserted.
import { createHash } from 'node:crypto';
import type { Finding } from './rules/types';

export function findingDedupeKey(finding: Finding): string {
  const parts = [finding.ruleId, finding.entityType, finding.entityId, finding.businessDate, finding.findingType];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
