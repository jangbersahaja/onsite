import {
  MAX_OUTLET_PHOTO_BYTES,
  outletPhotoPathPrefix,
  outletPhotoUrl,
  validateOutletPhotoBytes,
} from "@/lib/outlet-photo";
import assert from "node:assert/strict";
import test from "node:test";

const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const pngHeader = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const webpHeader = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const gifHeader = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

test("outlet photo limit matches the 4 MB rule", () => {
  assert.equal(MAX_OUTLET_PHOTO_BYTES, 4 * 1024 * 1024);
});

test("outlet photo accepts JPEG, PNG, and WebP", () => {
  assert.deepEqual(validateOutletPhotoBytes(1024, jpegHeader), {
    contentType: "image/jpeg",
    extension: "jpg",
  });
  assert.deepEqual(validateOutletPhotoBytes(1024, pngHeader), {
    contentType: "image/png",
    extension: "png",
  });
  assert.deepEqual(validateOutletPhotoBytes(1024, webpHeader), {
    contentType: "image/webp",
    extension: "webp",
  });
});

test("outlet photo rejects empty, oversized, and unsupported files", () => {
  assert.deepEqual(validateOutletPhotoBytes(0, jpegHeader), {
    error: "Choose an image to upload.",
  });
  assert.deepEqual(
    validateOutletPhotoBytes(MAX_OUTLET_PHOTO_BYTES + 1, jpegHeader),
    { error: "Outlet photos must be 4 MB or smaller." },
  );
  assert.deepEqual(validateOutletPhotoBytes(1024, gifHeader), {
    error: "Choose a JPEG, PNG, or WebP image.",
  });
});

test("outlet photo path prefix is scoped per outlet", () => {
  assert.equal(outletPhotoPathPrefix("abc"), "outlet-photos/abc-");
});

test("outlet photo URL is only set when an image path exists", () => {
  assert.equal(
    outletPhotoUrl("abc", "outlet-photos/abc-1.jpg"),
    "/api/outlet-photos/abc",
  );
  assert.equal(outletPhotoUrl("abc", null), null);
});
