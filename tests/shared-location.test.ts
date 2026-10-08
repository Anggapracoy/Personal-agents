import assert from "node:assert/strict";
import test from "node:test";
import { messageWithLocation, sharedLocationUrl, splitLocationMessage, validSharedLocation } from "../lib/shared-location";

const location = { latitude: 43.6532, longitude: -79.3832, accuracy: 24.5, capturedAt: "2026-09-06T15:00:00.000Z" };

test("a location attachment retains prompt, coordinates, accuracy, and time through the ordinary message path", () => {
  const message = messageWithLocation("Find lunch near me", location);
  assert.match(message, /43\.653200,-79\.383200/);
  assert.match(message, /2026-09-06T15:00:00.000Z/);
  const decoded = splitLocationMessage(message);
  assert.equal(decoded.text, "Find lunch near me");
  assert.deepEqual(decoded.location, { ...location, accuracy: 25 });
  assert.equal(sharedLocationUrl(decoded.location!), "https://maps.apple.com/?ll=43.653200,-79.383200");
});

test("a person can send only a location or remove it without changing their text", () => {
  assert.deepEqual(splitLocationMessage(messageWithLocation("", location)), { text: "", location: { ...location, accuracy: 25 } });
  assert.equal(messageWithLocation("Find lunch near me", null), "Find lunch near me");
});

test("invalid coordinates and map links cannot become location attachments", () => {
  for (const bad of [{ ...location, latitude: 91 }, { ...location, longitude: Infinity }, { ...location, latitude: "43" }, { ...location, accuracy: -1 }, { ...location, capturedAt: "unknown" }]) {
    assert.equal(validSharedLocation(bad), false);
  }
  for (const message of [messageWithLocation("", location).replace("43.653200", "143.653200"), messageWithLocation("", location).replace("maps.apple.com", "example.com")]) {
    assert.deepEqual(splitLocationMessage(message), { text: message, location: null });
  }
});
