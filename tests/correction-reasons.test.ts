import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CORRECTION_REASON_CODES,
  isCorrectionReasonCode,
} from "../lib/correction-reasons";
import { enDialogs } from "../lib/i18n/messages/en/dialogs";
import { idDialogs } from "../lib/i18n/messages/id/dialogs";
import { msDialogs } from "../lib/i18n/messages/ms/dialogs";

test("accepts only the curated reason codes", () => {
  for (const code of CORRECTION_REASON_CODES) {
    assert.equal(isCorrectionReasonCode(code), true);
  }
  assert.equal(isCorrectionReasonCode("bad_code"), false);
  assert.equal(isCorrectionReasonCode(""), false);
  assert.equal(isCorrectionReasonCode(null), false);
});

test("every reason code has a label in each locale", () => {
  for (const messages of [enDialogs, idDialogs, msDialogs]) {
    for (const code of CORRECTION_REASON_CODES) {
      assert.ok(messages.correction.reasonOptions[code].length > 0);
    }
  }
});
