import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "../lib/password";

test("password hashes verify without storing the original password", async () => {
  const password = "a sufficiently long password";
  const firstHash = await hashPassword(password);
  const secondHash = await hashPassword(password);

  assert.notEqual(firstHash, secondHash);
  assert.equal(firstHash.includes(password), false);
  assert.equal(await verifyPassword(password, firstHash), true);
  assert.equal(await verifyPassword("a different password", firstHash), false);
});

test("password verification rejects malformed stored hashes", async () => {
  assert.equal(await verifyPassword("password", "invalid"), false);
  assert.equal(await verifyPassword("password", "scrypt$bad$bad"), false);
});
