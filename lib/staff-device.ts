import { hashOneTimeToken } from "@/lib/one-time-token";
import { timingSafeEqual } from "node:crypto";

export type StaffDeviceStatus = "pending" | "active" | "revoked";

export function isStaffDeviceRequired(canAccessClock: boolean) {
  return canAccessClock;
}

export function getStaffDeviceCookieName(userId: string) {
  return `shiftline_staff_device_${hashOneTimeToken(userId).slice(0, 16)}`;
}

export function staffDeviceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  } as const;
}

export function matchesStaffDeviceToken(
  token: string | undefined,
  storedTokenHash: string | undefined,
) {
  if (
    !token ||
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    !storedTokenHash ||
    !/^[a-f0-9]{64}$/.test(storedTokenHash)
  ) {
    return false;
  }

  const candidateHash = Buffer.from(hashOneTimeToken(token), "hex");
  const expectedHash = Buffer.from(storedTokenHash, "hex");
  return timingSafeEqual(candidateHash, expectedHash);
}

export function isApprovedStaffDevice(
  token: string | undefined,
  status: StaffDeviceStatus | undefined,
  storedTokenHash: string | undefined,
) {
  return status === "active" && matchesStaffDeviceToken(token, storedTokenHash);
}
