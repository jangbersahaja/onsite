export const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024;

export const PROFILE_PHOTO_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ProfilePhotoContentType =
  (typeof PROFILE_PHOTO_CONTENT_TYPES)[number];

export function detectProfilePhotoContentType(
  header: Uint8Array,
): ProfilePhotoContentType | null {
  if (
    header.length >= 3 &&
    header[0] === 0xff &&
    header[1] === 0xd8 &&
    header[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    header.length >= 12 &&
    String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...header.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function profilePhotoExtension(contentType: ProfilePhotoContentType) {
  return contentType === "image/jpeg"
    ? "jpg"
    : contentType === "image/png"
      ? "png"
      : "webp";
}

export function validateProfilePhotoBytes(size: number, header: Uint8Array) {
  if (size === 0) return { error: "Choose an image to upload." } as const;
  if (size > MAX_PROFILE_PHOTO_BYTES) {
    return { error: "Profile photos must be 2 MB or smaller." } as const;
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
