import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const keyLength = 64;
const scryptOptions = {
  N: 32_768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};

function deriveKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, scryptOptions, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, saltValue, keyValue, extra] = storedHash.split("$");
  if (algorithm !== "scrypt" || !saltValue || !keyValue || extra) return false;

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(keyValue, "base64url");
    if (salt.length !== 16 || expected.length !== keyLength) return false;
    const actual = await deriveKey(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
