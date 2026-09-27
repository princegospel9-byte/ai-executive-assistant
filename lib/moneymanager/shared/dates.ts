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
