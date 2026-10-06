import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function getPinPepper() {
  const pepper = process.env.PIN_PEPPER;
  return pepper && Buffer.byteLength(pepper, "utf8") >= 32 ? pepper : null;
}

export function isValidPin(pin: string) {
  return pin.length === 6 && /^[0-9]{6}$/.test(pin);
}

function derivePinHash(pin: string, salt: string, pepper: string) {
  return createHmac("sha256", pepper).update(`${salt}:${pin}`).digest();
}

export function hashPin(pin: string, pepper: string) {
  if (!isValidPin(pin)) throw new Error("PIN must contain exactly six digits.");

  const salt = randomBytes(16).toString("base64url");
  const hash = derivePinHash(pin, salt, pepper).toString("base64url");
  return `hmac-sha256$${salt}$${hash}`;
}

export function verifyPin(pin: string, storedHash: string, pepper: string) {
  if (!isValidPin(pin)) return false;

  const [algorithm, salt, hash, extra] = storedHash.split("$");
  if (algorithm !== "hmac-sha256" || !salt || !hash || extra) return false;

  try {
    const saltBytes = Buffer.from(salt, "base64url");
    const expectedHash = Buffer.from(hash, "base64url");
    if (saltBytes.length !== 16 || expectedHash.length !== 32) return false;
    return timingSafeEqual(derivePinHash(pin, salt, pepper), expectedHash);
  } catch {
    return false;
  }
}
