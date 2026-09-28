// Ported from moneymanager-standalone-src/src/shared/lib/dates.ts
// (nextIsoDate only - the one helper lib/moneymanager actually needs),
// verbatim in meaning: MoneyManager's own date-range queries rely on this
// exact "day after" semantics for turning an inclusive upper bound into a
// safe exclusive one, so reusing it here keeps office-records comparisons
// (lib/moneymanager/office-records/) and the zone/withdrawal SQL in
// lib/moneymanager/client/snapshot.ts consistent with MoneyManager's own
// query behavior, not a reinterpretation of it.
export function nextIsoDate(date: string): string {
  const datePart = date.slice(0, 10);
  const parts = datePart.split('-').map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

const MIN_PLAUSIBLE_YEAR = 2000;
const MAX_PLAUSIBLE_YEAR = 2100;

/** Extracted from lib/moneymanager/rules/dataIntegrity.ts's original local
 * isImplausibleDate (same logic, moved here so it has exactly one
 * implementation instead of being duplicated by
 * SnapshotReader.dataAsOfDate() - dataIntegrity.ts now imports this instead
 * of defining its own copy; no behavior change). entry_date is stored as
 * free-form text (not a strict sqlite DATE type), so a corrupted value like
 * "0202-03-06" - which the reference snapshot genuinely contains - parses
 * as a Date object without throwing, so it has to be caught by range-
 * checking instead. */
export function isImplausibleDate(raw: string): boolean {
  const yearMatch = /^(\d{1,4})-/.exec(raw);
  if (!yearMatch) return true;
  const year = Number(yearMatch[1]);
  if (!Number.isFinite(year)) return true;
  if (year < MIN_PLAUSIBLE_YEAR || year > MAX_PLAUSIBLE_YEAR) return true;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime());
}
