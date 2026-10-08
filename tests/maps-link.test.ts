import test from "node:test";
import assert from "node:assert/strict";
import { actionableMapsLink } from "../lib/maps-link";

test("the restaurant link selects its exact coordinates as the directions destination", () => {
  const url = new URL(actionableMapsLink("https://maps.apple.com/?ll=43.6534,-79.3841"));
  assert.equal(url.hostname, "maps.apple.com");
  assert.equal(url.searchParams.get("daddr"), "43.6534,-79.3841");
  assert.equal(url.searchParams.has("ll"), false);
});
test("preserves destination label, origin, and travel mode while repairing a map-center link", () => {
  const url = new URL(actionableMapsLink("https://maps.apple.com/?ll=43.6534%2C-79.3841&q=Example+Restaurant&saddr=Toronto&dirflg=w"));
  assert.equal(url.searchParams.get("q"), "Example Restaurant");
  assert.equal(url.searchParams.get("saddr"), "Toronto");
  assert.equal(url.searchParams.get("dirflg"), "w");
  assert.equal(url.searchParams.get("daddr"), "43.6534,-79.3841");
});
test("preserves existing routes, place identifiers, searches and unrelated links", () => {
  for (const href of [
    "https://maps.apple.com/?daddr=100+Example+Street&ll=43.7,-79.4&dirflg=w",
    "https://maps.apple.com/?auid=123&ll=43.7,-79.4",
    "https://maps.apple.com/place?coordinate=43.7,-79.4&name=Restaurant",
    "https://maps.apple.com/?q=restaurants+near+Toronto",
    "https://maps.google.com/?ll=43.7,-79.4", "https://example.com/?ll=43.7,-79.4",
    "https://maps.apple.com.evil.test/?ll=43.7,-79.4", "javascript:alert(1)",
    "https://maps.apple.com/?ll=91,0", "https://maps.apple.com/?ll=0,181", "https://maps.apple.com/?ll=not-a-place",
  ]) assert.equal(actionableMapsLink(href), href);
});
