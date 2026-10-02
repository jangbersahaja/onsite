import {
  storeResetPasswordLink,
  takeResetPasswordLink,
} from "@/lib/reset-password-delivery";
import assert from "node:assert/strict";
import test from "node:test";

test("reset links can only be taken once using their request ID", () => {
  storeResetPasswordLink("request-one", "https://example.test/reset/one");
  storeResetPasswordLink("request-two", "https://example.test/reset/two");

  assert.equal(
    takeResetPasswordLink("request-one"),
    "https://example.test/reset/one",
  );
  assert.equal(takeResetPasswordLink("request-one"), null);
  assert.equal(
    takeResetPasswordLink("request-two"),
    "https://example.test/reset/two",
  );
});
