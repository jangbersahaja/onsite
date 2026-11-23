import { CORRECTION_EVENTS } from "@/lib/break-corrections";
import {
  CORRECTION_EVENT_LABELS,
  formatReviewDate,
  formatReviewDateTime,
  formatReviewRange,
  formatReviewTime,
  formatWaitingSince,
  isOverdue,
  mergeReviewList,
  sortOldestFirst,
} from "@/lib/review-requests";
import assert from "node:assert/strict";
import test from "node:test";

const MINUTE = 60_000;
const NOW = Date.parse("2026-05-10T12:00:00.000Z");

test("every correction event has a readable label", () => {
  for (const event of CORRECTION_EVENTS) {
    assert.ok(CORRECTION_EVENT_LABELS[event].length > 0, event);
    assert.ok(!CORRECTION_EVENT_LABELS[event].includes("_"), event);
  }
});

test("review timestamps use DD MMM YYYY and 24-hour HH:mm", () => {
  const value = "2026-11-13T14:05:00.000Z";
  assert.equal(formatReviewDate(value, "UTC"), "13 Nov 2026");
  assert.equal(formatReviewTime(value, "UTC"), "14:05");
  assert.equal(formatReviewDateTime(value, "UTC"), "13 Nov 2026, 14:05");
  assert.equal(
    formatReviewRange(
      "2026-11-13T14:00:00.000Z",
      "2026-11-13T22:00:00.000Z",
      "UTC",
    ),
    "13 Nov 2026, 14:00 – 22:00",
  );
  assert.equal(
    formatReviewRange(
      "2026-11-13T22:00:00.000Z",
      "2026-11-14T06:00:00.000Z",
      "UTC",
    ),
    "13 Nov 2026, 22:00 – 14 Nov 2026, 06:00",
  );
});

test("formatWaitingSince scales from minutes to days", () => {
  const at = (minutesAgo: number) =>
    new Date(NOW - minutesAgo * MINUTE).toISOString();
  assert.equal(formatWaitingSince(at(0), NOW), "Submitted just now");
  assert.equal(formatWaitingSince(at(45), NOW), "Waiting 45 min");
  assert.equal(formatWaitingSince(at(150), NOW), "Waiting 2 h");
  assert.equal(formatWaitingSince(at(60 * 49), NOW), "Waiting 2 d");
});

test("isOverdue flags requests waiting a full day or longer", () => {
  const at = (hoursAgo: number) =>
    new Date(NOW - hoursAgo * 60 * MINUTE).toISOString();
  assert.equal(isOverdue(at(23), NOW), false);
  assert.equal(isOverdue(at(24), NOW), true);
  assert.equal(isOverdue(new Date(NOW + MINUTE).toISOString(), NOW), false);
});

test("formatWaitingSince tolerates future timestamps from clock skew", () => {
  const future = new Date(NOW + 10 * MINUTE).toISOString();
  assert.equal(formatWaitingSince(future, NOW), "Submitted just now");
});

test("sortOldestFirst orders by createdAt without mutating the input", () => {
  const items = [
    { id: "b", createdAt: "2026-05-10T10:00:00.000Z" },
    { id: "a", createdAt: "2026-05-09T10:00:00.000Z" },
    { id: "c", createdAt: "2026-05-10T11:00:00.000Z" },
  ];
  const sorted = sortOldestFirst(items);
  assert.deepEqual(
    sorted.map((item) => item.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    items.map((item) => item.id),
    ["b", "a", "c"],
  );
});

test("mergeReviewList keeps previous items when a refresh fails", () => {
  const previous = { items: [{ id: "1" }], error: "" };
  const failed = { items: null, error: "Network down." };
  assert.deepEqual(mergeReviewList(previous, failed), {
    items: [{ id: "1" }],
    error: "Network down.",
  });
});

test("mergeReviewList replaces items on success and surfaces first-load errors", () => {
  const previous = { items: [{ id: "1" }], error: "" };
  const next = { items: [{ id: "2" }], error: "" };
  assert.deepEqual(mergeReviewList(previous, next), next);

  const firstFailure = { items: null, error: "Could not load." };
  assert.deepEqual(
    mergeReviewList({ items: null, error: "" }, firstFailure),
    firstFailure,
  );
});
