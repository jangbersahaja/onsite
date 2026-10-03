import { timingSafeEqual } from "node:crypto";
import { hashOneTimeToken } from "@/lib/one-time-token";

export type StaffDeviceStatus = "pending" | "active" | "revoked";

export function isStaffDeviceRequired(role: string) {
  return role === "staff";
}

export function getStaffDeviceCookieName(userId: string) {
  return `shiftline_staff_device_${hashOneTimeToken(userId).slice(0, 16)}`;
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
