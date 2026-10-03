import {
  detectProfilePhotoContentType,
  MAX_PROFILE_PHOTO_BYTES,
  profilePhotoExtension,
  validateProfilePhotoBytes,
} from "@/lib/profile-photo";
import assert from "node:assert/strict";
import test from "node:test";

test("profile photo type detection checks JPEG, PNG, and WebP signatures", () => {
  assert.equal(
    detectProfilePhotoContentType(new Uint8Array([0xff, 0xd8, 0xff, 0x00])),
    "image/jpeg",
  );
  assert.equal(
    detectProfilePhotoContentType(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
    "image/png",
  );
  assert.equal(
    detectProfilePhotoContentType(
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]),
    ),
    "image/webp",
  );
  assert.equal(
    detectProfilePhotoContentType(new Uint8Array([0x25, 0x50])),
    null,
  );
  assert.equal(MAX_PROFILE_PHOTO_BYTES, 2 * 1024 * 1024);
});

test("profile photo extensions follow the detected content type", () => {
  assert.equal(profilePhotoExtension("image/jpeg"), "jpg");
  assert.equal(profilePhotoExtension("image/png"), "png");
  assert.equal(profilePhotoExtension("image/webp"), "webp");
});

test("profile photo validation rejects empty, oversized, and unsupported files", () => {
  const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff]);
  assert.deepEqual(validateProfilePhotoBytes(0, jpegHeader), {
    error: "Choose an image to upload.",
  });
  assert.deepEqual(
    validateProfilePhotoBytes(MAX_PROFILE_PHOTO_BYTES + 1, jpegHeader),
    { error: "Profile photos must be 2 MB or smaller." },
  );
  assert.deepEqual(validateProfilePhotoBytes(12, new Uint8Array(12)), {
    error: "Choose a JPEG, PNG, or WebP image.",
  });
  assert.deepEqual(validateProfilePhotoBytes(12, jpegHeader), {
    contentType: "image/jpeg",
    extension: "jpg",
  });
});
