import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchSnippet } from "../lib/conversation-search";
import { appleOperationIsRead, appleOperationRunsInBackground, appleOperations } from "../lib/apple/catalog";

test("search snippets center on the match and trim at word boundaries", () => {
  const text = "Your table at L’Artusi is booked for Friday at 8. Confirmation number ABC123. See you there, and enjoy dinner with Sam!";
  const snippet = searchSnippet(text, "abc123");
  assert.match(snippet, /ABC123/);
  assert.ok(snippet.startsWith("…") && snippet.endsWith("…"));
  assert.equal(searchSnippet("Short receipt", "receipt"), "Short receipt");
});

test("background iPhone wake-ups only ever run reads, and the app and server agree on which", () => {
  const background = appleOperations.filter(appleOperationRunsInBackground);
  assert.ok(background.length > 0);
  for (const operation of background) assert.ok(appleOperationIsRead(operation), `${operation} must be read-only`);
  const swift = readFileSync(new URL("../ios/DecisionFeed/App/NotificationReply.swift", import.meta.url), "utf8");
  const declared = swift.match(/backgroundReads: Set<String> = \[([^\]]+)\]/)?.[1].match(/"([^"]+)"/g)?.map(value => value.slice(1, -1)) ?? [];
  assert.deepEqual([...declared].sort(), [...background].sort());
});
