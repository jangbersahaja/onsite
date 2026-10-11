import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedStoreHubToken = {
  ciphertext: string;
  iv: string;
  tag: string;
};

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export function getStoreHubCredentialKey(
  env: Record<string, string | undefined> = process.env,
) {
  const value = env.STOREHUB_CREDENTIAL_KEY?.trim();
  if (!value) {
    throw new Error("Set STOREHUB_CREDENTIAL_KEY to encrypt StoreHub tokens.");
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error(
      "STOREHUB_CREDENTIAL_KEY must be 32 bytes, base64 encoded.",
    );
  }
  return key;
}

export function encryptStoreHubToken(
  token: string,
  outletId: string,
  key: Buffer,
): EncryptedStoreHubToken {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(outletId, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptStoreHubToken(
  payload: EncryptedStoreHubToken,
  outletId: string,
  key: Buffer,
) {
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(outletId, "utf8"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
