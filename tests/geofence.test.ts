import assert from "node:assert/strict";
import test from "node:test";
import { distanceInMeters, verifyGeofence } from "../lib/geofence";

const outlet = { latitude: 1.2834, longitude: 103.8501 };

test("distance uses a spherical earth approximation", () => {
  const distance = distanceInMeters(
    { latitude: 0, longitude: 0 },
    { latitude: 0.001, longitude: 0 },
  );

  assert.ok(distance > 111 && distance < 112);
});

test("accepts a precise fix inside the geofence", () => {
  assert.deepEqual(verifyGeofence({ ...outlet, accuracy: 10 }, outlet), {
    allowed: true,
    distanceMeters: 0,
  });
});

test("rejects a fix whose uncertainty overlaps the radius", () => {
  const nearby = {
    latitude: outlet.latitude + 0.0006,
    longitude: outlet.longitude,
  };
  const result = verifyGeofence({ ...nearby, accuracy: 40 }, outlet);

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "outside_radius");
});

test("rejects inaccurate location fixes", () => {
  const result = verifyGeofence({ ...outlet, accuracy: 51 }, outlet);

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "poor_accuracy");
});
