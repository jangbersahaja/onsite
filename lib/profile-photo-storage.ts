import "server-only";

import { del, put } from "@vercel/blob";
import { validateProfilePhotoBytes } from "@/lib/profile-photo";

export class ProfilePhotoValidationError extends Error {}

export async function validateProfilePhotoFile(file: File) {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const validation = validateProfilePhotoBytes(file.size, header);
  if ("error" in validation) {
    throw new ProfilePhotoValidationError(validation.error);
  }
  return validation;
}

export async function uploadProfilePhoto(userId: string, file: File) {
  const { contentType, extension } = await validateProfilePhotoFile(file);
  const blob = await put(`profile-photos/${userId}.${extension}`, file, {
    access: "private",
    addRandomSuffix: true,
    cacheControlMaxAge: 60,
    contentType,
  });
  return blob.pathname;
}

export async function deleteProfilePhoto(pathname: string) {
  await del(pathname);
}
