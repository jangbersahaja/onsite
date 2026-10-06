import { hashPin, isValidPin, verifyPin } from "@/lib/pin";
import assert from "node:assert/strict";
import test from "node:test";

const pepper = "a-server-only-pepper-with-at-least-32-bytes";

test("accepts exactly six ASCII digits", () => {
  assert.equal(isValidPin("012345"), true);
  assert.equal(isValidPin("12345"), false);
  assert.equal(isValidPin("1234567"), false);
  assert.equal(isValidPin("123456\n"), false);
  assert.equal(isValidPin("12a456"), false);
  assert.equal(isValidPin("１２３４５６"), false);
});

test("hashes PINs with a per-value salt and verifies them safely", () => {
  const firstHash = hashPin("012345", pepper);
  const secondHash = hashPin("012345", pepper);

  assert.notEqual(firstHash, secondHash);
  assert.equal(verifyPin("012345", firstHash, pepper), true);
  assert.equal(verifyPin("999999", firstHash, pepper), false);
  assert.equal(verifyPin("012345", firstHash, "different-pepper-value"), false);
  assert.equal(verifyPin("12345", firstHash, pepper), false);
});

test("rejects malformed hashes", () => {
  assert.equal(verifyPin("012345", "not-a-hash", pepper), false);
  assert.equal(verifyPin("012345", "hmac-sha256$bad$bad", pepper), false);
});
