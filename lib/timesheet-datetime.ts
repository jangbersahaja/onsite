/** Wall-clock values in the `YYYY-MM-DDTHH:mm` shape used by datetime-local inputs. */
const localPattern = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
const LAST_MINUTE_OF_DAY = 23 * 60 + 59;
const SUGGESTED_SHIFT_MINUTES = 8 * 60;
const SUGGESTED_BREAK_MINUTES = 30;

function parse(value: string) {
  const match = localPattern.exec(value);
  if (!match) return null;
  return {
    date: match[1],
    minutes: Number(match[2]) * 60 + Number(match[3]),
  };
}

function format(date: string, minutes: number) {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const remainder = String(minutes % 60).padStart(2, "0");
  return `${date}T${hours}:${remainder}`;
}

/** Keeps the value on the same day, so a suggestion never crosses midnight. */
function addMinutesSameDay(value: string, minutes: number) {
  const parsed = parse(value);
  if (!parsed) return "";
  return format(
    parsed.date,
    Math.min(parsed.minutes + minutes, LAST_MINUTE_OF_DAY),
  );
}

export function datePart(value: string) {
  return parse(value)?.date ?? null;
}

export function withDatePart(value: string, date: string) {
  const parsed = parse(value);
  return parsed ? format(date, parsed.minutes) : value;
}

export function suggestClockOut(clockIn: string) {
  return addMinutesSameDay(clockIn, SUGGESTED_SHIFT_MINUTES);
}

export function suggestBreak(clockIn: string, previousEnd: string) {
  const date = datePart(clockIn);
  if (!date) return { startedAt: "", endedAt: "" };
  const startedAt =
    previousEnd && datePart(previousEnd) === date ? previousEnd : clockIn;
  return {
    startedAt,
    endedAt: addMinutesSameDay(startedAt, SUGGESTED_BREAK_MINUTES),
  };
}

/** Moves clock-out and breaks that sit on the previous clock-in date to the new one. */
export function relinkShiftToDate<
  T extends { startedAt: string; endedAt: string },
>(input: {
  fromDate: string | null;
  clockIn: string;
  clockOutAt: string;
  breaks: T[];
}) {
  const toDate = datePart(input.clockIn);
  if (!toDate) return { clockOutAt: input.clockOutAt, breaks: input.breaks };

  const move = (value: string) =>
    value && datePart(value) === input.fromDate
      ? withDatePart(value, toDate)
      : value;

  return {
    clockOutAt: input.clockOutAt
      ? move(input.clockOutAt)
      : suggestClockOut(input.clockIn),
    breaks: input.breaks.map((breakInterval) => ({
      ...breakInterval,
      startedAt: move(breakInterval.startedAt),
      endedAt: move(breakInterval.endedAt),
    })),
  };
}
