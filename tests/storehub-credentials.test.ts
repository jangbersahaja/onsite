import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decryptStoreHubToken,
  encryptStoreHubToken,
  getStoreHubCredentialKey,
} from "../lib/storehub-credentials";

const KEY_BASE64 = Buffer.alloc(32, 7).toString("base64");
const OUTLET_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_OUTLET_ID = "22222222-2222-4222-8222-222222222222";

describe("storehub credentials", () => {
  it("round-trips a token for the same outlet", () => {
    const key = getStoreHubCredentialKey({
      STOREHUB_CREDENTIAL_KEY: KEY_BASE64,
    });
    const payload = encryptStoreHubToken("secret-token", OUTLET_ID, key);

    assert.notEqual(payload.ciphertext, "secret-token");
    assert.equal(decryptStoreHubToken(payload, OUTLET_ID, key), "secret-token");
  });

  it("uses a fresh IV for every encryption", () => {
    const key = getStoreHubCredentialKey({
      STOREHUB_CREDENTIAL_KEY: KEY_BASE64,
    });
    const first = encryptStoreHubToken("same", OUTLET_ID, key);
    const second = encryptStoreHubToken("same", OUTLET_ID, key);

    assert.notEqual(first.iv, second.iv);
    assert.notEqual(first.ciphertext, second.ciphertext);
  });

  it("rejects decryption for a different outlet", () => {
    const key = getStoreHubCredentialKey({
      STOREHUB_CREDENTIAL_KEY: KEY_BASE64,
    });
    const payload = encryptStoreHubToken("secret-token", OUTLET_ID, key);

    assert.throws(() => decryptStoreHubToken(payload, OTHER_OUTLET_ID, key));
  });

  it("rejects tampered ciphertext", () => {
    const key = getStoreHubCredentialKey({
      STOREHUB_CREDENTIAL_KEY: KEY_BASE64,
    });
    const payload = encryptStoreHubToken("secret-token", OUTLET_ID, key);
    const bytes = Buffer.from(payload.ciphertext, "base64");
    bytes[0] ^= 0xff;

    assert.throws(() =>
      decryptStoreHubToken(
        { ...payload, ciphertext: bytes.toString("base64") },
        OUTLET_ID,
        key,
      ),
    );
  });

  it("throws when the key is missing", () => {
    assert.throws(
      () => getStoreHubCredentialKey({}),
      /STOREHUB_CREDENTIAL_KEY/,
    );
  });

  it("throws when the key is not 32 bytes", () => {
    assert.throws(
      () =>
        getStoreHubCredentialKey({
          STOREHUB_CREDENTIAL_KEY: Buffer.alloc(16).toString("base64"),
        }),
      /32 bytes/,
    );
  });
});
