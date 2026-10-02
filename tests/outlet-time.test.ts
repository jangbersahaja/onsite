import {
  csvCell,
  formatOutletDateTime,
  isDateOnly,
  outletDateTimeToISOString,
  parseDateRange,
  serializeCsv,
} from "@/lib/outlet-time";
import assert from "node:assert/strict";
import test from "node:test";

test("date filters require real calendar dates", () => {
  assert.equal(isDateOnly("2026-10-02"), true);
  assert.equal(isDateOnly("2026-02-30"), false);
  assert.equal(isDateOnly("10/02/2026"), false);
  assert.deepEqual(parseDateRange("2026-10-02", "2026-10-02"), {
    from: "2026-10-02",
    to: "2026-10-02",
  });
  assert.equal(parseDateRange("2026-10-03", "2026-10-02"), null);
});

test("outlet-local edits preserve the intended instant", () => {
  const instant = outletDateTimeToISOString(
    "2026-10-02T09:30",
    "Asia/Kuala_Lumpur",
  );
  assert.equal(instant, "2026-10-02T01:30:00.000Z");
  assert.equal(
    formatOutletDateTime(instant, "Asia/Kuala_Lumpur"),
    "2026-10-02T09:30",
  );
});

test("CSV cells quote separators and neutralize formula prefixes", () => {
  assert.equal(csvCell("Cafe, Kuala Lumpur"), '"Cafe, Kuala Lumpur"');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(
    serializeCsv(["name", "hours"], [["A, B", 8]]),
    'name,hours\r\n"A, B",8',
  );
});
