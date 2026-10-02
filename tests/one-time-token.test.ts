import { createOneTimeToken, hashOneTimeToken } from "@/lib/one-time-token";
import assert from "node:assert/strict";
import test from "node:test";

test("creates opaque tokens and stores only a stable one-way digest", () => {
  const first = createOneTimeToken();
  const second = createOneTimeToken();

  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.tokenHash, hashOneTimeToken(first.token));
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(first.token, first.tokenHash);
  assert.notEqual(first.tokenHash, second.tokenHash);
});
