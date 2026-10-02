const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const dateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function dateParts(value: string) {
  const match = datePattern.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (
    date.getUTCFullYear() !== parts[0] ||
    date.getUTCMonth() !== parts[1] - 1 ||
    date.getUTCDate() !== parts[2]
  ) {
    return null;
  }
  return parts;
}

export function isDateOnly(value: string) {
  return dateParts(value) !== null;
}

export function parseDateRange(from: string | null, to: string | null) {
  if ((from && !isDateOnly(from)) || (to && !isDateOnly(to))) return null;
  if (from && to && from > to) return null;
  return { from: from || undefined, to: to || undefined };
}

function zonedParts(value: Date | string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function formatOutletDateTime(value: Date | string, timezone: string) {
  const parts = zonedParts(value, timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function formatOutletTimestamp(value: Date | string, timezone: string) {
  return `${formatOutletDateTime(value, timezone).replace("T", " ")}:${zonedParts(value, timezone).second}`;
}

export function outletDateTimeToISOString(value: string, timezone: string) {
  const match = dateTimePattern.exec(value);
  if (!match) throw new Error("Enter a valid outlet time.");
  const parts = match.slice(1).map(Number);
  if (
    !dateParts(`${match[1]}-${match[2]}-${match[3]}`) ||
    parts[3] > 23 ||
    parts[4] > 59
  ) {
    throw new Error("Enter a valid outlet time.");
  }

  const targetUtc = Date.UTC(
    parts[0],
    parts[1] - 1,
    parts[2],
    parts[3],
    parts[4],
  );
  let candidate = targetUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = zonedParts(new Date(candidate), timezone);
    const observedUtc = Date.UTC(
      Number(observed.year),
      Number(observed.month) - 1,
      Number(observed.day),
      Number(observed.hour),
      Number(observed.minute),
    );
    const difference = targetUtc - observedUtc;
    if (difference === 0) return new Date(candidate).toISOString();
    candidate += difference;
  }

  throw new Error("That local time does not exist in the outlet timezone.");
}

export function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^\s*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeCsv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
