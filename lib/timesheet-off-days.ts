// Staff only started using the onsite app on this date, so earlier days are never off days.
export const ONSITE_TRACKING_START_DATE = "2026-09-26";

export function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

/**
 * Returns the YYYY-MM-DD dates in `max(start, from)` through `min(to, today)` that have no shift.
 */
export function getOffDayDateKeys({
  from,
  to,
  today,
  workedDateKeys,
}: {
  from?: string | null;
  to?: string | null;
  today: string;
  workedDateKeys: Iterable<string>;
}) {
  const worked = new Set(workedDateKeys);
  const start = [ONSITE_TRACKING_START_DATE, from ?? ""].sort().at(-1) ?? "";
  const end = [to || today, today].sort()[0] ?? today;
  const offDays: string[] = [];
  if (start > end) return offDays;

  for (let date = start; date <= end; date = addDaysToDateKey(date, 1)) {
    if (!worked.has(date)) offDays.push(date);
  }
  return offDays;
}
