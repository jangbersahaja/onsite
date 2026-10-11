import { describeDeviceFromUserAgent } from "@/lib/device-name";
import assert from "node:assert/strict";
import test from "node:test";

test("names the platform and browser from the user agent", () => {
  assert.equal(
    describeDeviceFromUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ),
    "iPhone · Safari",
  );
  assert.equal(
    describeDeviceFromUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36",
    ),
    "Android · Chrome",
  );
  assert.equal(
    describeDeviceFromUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 Edg/125.0",
    ),
    "Windows · Edge",
  );
});

test("returns null when the user agent is missing or unrecognized", () => {
  assert.equal(describeDeviceFromUserAgent(null), null);
  assert.equal(describeDeviceFromUserAgent("   "), null);
  assert.equal(describeDeviceFromUserAgent("curl/8.4.0"), null);
});
