import "server-only";

import { validateOutletPhotoBytes } from "@/lib/outlet-photo";
import { del, put } from "@vercel/blob";

export class OutletPhotoValidationError extends Error {}

export async function validateOutletPhotoFile(file: File) {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const validation = validateOutletPhotoBytes(file.size, header);
  if ("error" in validation) {
    throw new OutletPhotoValidationError(validation.error);
  }
  return validation;
}

export async function uploadOutletPhoto(outletId: string, file: File) {
  const { contentType, extension } = await validateOutletPhotoFile(file);
  const blob = await put(`outlet-photos/${outletId}.${extension}`, file, {
    access: "private",
    addRandomSuffix: true,
    cacheControlMaxAge: 60,
    contentType,
  });
  return blob.pathname;
}

export async function deleteOutletPhoto(pathname: string) {
  await del(pathname);
}
