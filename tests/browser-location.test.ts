import assert from "node:assert/strict";
import test from "node:test";
import { requestCurrentLocation } from "../lib/browser-location";

function position(accuracy = 10): GeolocationPosition {
  return {
    coords: {
      latitude: 1.2834,
      longitude: 103.8501,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: Date.now(),
    toJSON: () => ({}),
  };
}

test("requests a fresh high-accuracy location and returns clock evidence", async () => {
  const fix = await requestCurrentLocation({
    getCurrentPosition(success, _error, options) {
      assert.deepEqual(options, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 30_000,
      });
      success(position());
    },
  });
  assert.deepEqual(fix, {
    latitude: 1.2834,
    longitude: 103.8501,
    accuracy: 10,
  });
});

test("surfaces denied location permission", async () => {
  await assert.rejects(
    requestCurrentLocation({
      getCurrentPosition(_success, error) {
        error?.({
          code: 1,
          message: "denied",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      },
    }),
    /Location permission was denied.*Enable location access/,
  );
});

test("surfaces unavailable GPS instead of silently failing", async () => {
  await assert.rejects(
    requestCurrentLocation({
      getCurrentPosition(_success, error) {
        error?.({
          code: 2,
          message: "unavailable",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      },
    }),
    /could not get a reliable location/,
  );
});

test("times out even when the browser never invokes a callback", async () => {
  await assert.rejects(
    requestCurrentLocation({ getCurrentPosition() {} }, 5),
    /Location check timed out/,
  );
});

test("a late browser callback cannot resume a timed-out clock request", async () => {
  let respond: PositionCallback | undefined;
  let continued = false;
  const request = requestCurrentLocation(
    {
      getCurrentPosition(success) {
        respond = success;
      },
    },
    5,
  ).then(() => {
    continued = true;
  });
  await assert.rejects(request, /Location check timed out/);
  respond?.(position());
  await Promise.resolve();
  assert.equal(continued, false);
});

test("surfaces synchronous browser errors", async () => {
  await assert.rejects(
    requestCurrentLocation({
      getCurrentPosition() {
        throw new Error("Location API unavailable");
      },
    }),
    /Location API unavailable/,
  );
});
