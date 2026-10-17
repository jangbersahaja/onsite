import {
  detectProfilePhotoContentType,
  MAX_PROFILE_PHOTO_BYTES,
  profilePhotoExtension,
} from "@/lib/profile-photo";

export const MAX_OUTLET_PHOTO_BYTES = MAX_PROFILE_PHOTO_BYTES;

export function outletPhotoPathPrefix(outletId: string) {
  return `outlet-photos/${outletId}-`;
}

export function outletPhotoUrl(outletId: string, imagePath: string | null) {
  return imagePath
    ? `/api/outlet-photos/${encodeURIComponent(outletId)}`
    : null;
}

export function validateOutletPhotoBytes(size: number, header: Uint8Array) {
  if (size === 0) return { error: "Choose an image to upload." } as const;
  if (size > MAX_OUTLET_PHOTO_BYTES) {
    return { error: "Outlet photos must be 2 MB or smaller." } as const;
  }
  const contentType = detectProfilePhotoContentType(header);
  if (!contentType) {
    return { error: "Choose a JPEG, PNG, or WebP image." } as const;
  }
  return {
    contentType,
    extension: profilePhotoExtension(contentType),
  } as const;
}
