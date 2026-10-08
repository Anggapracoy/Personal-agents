import test from "node:test";
import assert from "node:assert/strict";
import { presentResultInputSchema } from "../lib/harness/result-schema";
import { recordAgentResult } from "../lib/harness/model";
import { MemoryRunStore } from "../lib/harness/store";

const base = { outcome: "completed", summary: "Plan ready.", details: "Plan ready.", verified: true, externalChange: false };

test("present_result accepts blocks with omitted optional fields and keeps their order", () => {
  const parsed = presentResultInputSchema.parse({ ...base, blocks: [
    { type: "table", columns: ["Option", "Time"], rows: [{ cells: ["Train", "5 hr"], best: true }] },
    { type: "stats", items: [{ label: "Days", value: "3" }] },
    { type: "timeline", items: [{ title: "Check in" }] },
    { type: "callout", tone: "warning", text: "Dates assumed." },
  ] });
  assert.deepEqual(parsed.blocks.map((block: { type: string }) => block.type), ["table", "stats", "timeline", "callout"]);
});

test("present_result rejects unknown block types and nested sections", () => {
  assert.throws(() => presentResultInputSchema.parse({ ...base, blocks: [{ type: "script", code: "x" }] }));
  assert.throws(() => presentResultInputSchema.parse({ ...base, blocks: [{ type: "section", title: "A", blocks: [{ type: "section", title: "B", blocks: [] }] }] }));
});

test("recorded blocks keep order, drop unusable links and unknown actions, and pad short table rows", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "test", decisionId: null, category: "social", title: "Trip", request: "Plan a trip", metadata: {} });
  const input = presentResultInputSchema.parse({
    ...base,
    followUpActions: [{ id: "hotels", label: "Find hotels", description: "Search", intent: "Find hotels", actionType: "research", requiresFreshEvidence: true }],
    blocks: [
      { type: "link_card", title: "Insecure", url: "http://example.com" },
      { type: "table", columns: ["A", "B", "C"], rows: [{ cells: ["1"] }] },
      { type: "image_row", images: [{ url: "http://example.com/a.jpg" }, { url: "https://example.com/b.jpg" }] },
      { type: "action", actionIds: ["hotels", "missing"] },
      { type: "action", actionIds: ["missing"] },
      { type: "text", style: "paragraph", text: "Last." },
    ],
  });
  assert.equal((await recordAgentResult(store, run.id, input)).accepted, true);
  const blocks = (await store.getRun(run.id))!.result!.blocks!;
  assert.deepEqual(blocks.map((block: { type: string }) => block.type), ["table", "image_row", "action", "text"]);
  assert.deepEqual((blocks[0] as { rows: { cells: string[] }[] }).rows[0].cells, ["1", "", ""]);
  assert.equal((blocks[1] as { images: unknown[] }).images.length, 1);
  assert.deepEqual((blocks[2] as { actionIds: string[] }).actionIds, ["hotels"]);
});

test("History threads include the saved result blocks after the outcome text", async () => {
  const { historyThreadItems } = await import("../app/history-thread");
  const blocks = [{ type: "text" as const, style: "paragraph" as const, text: "Hi" }];
  const items = historyThreadItems({ id: "h1", subtitle: "Sub", outcome: "Done", completedAt: "2026-01-01T00:00:00Z", result: { outcome: "completed", summary: "s", details: "d", verified: true, externalChange: false, facts: [], links: [], moneySaved: null, blocks } } as never);
  assert.deepEqual(items.map(item => item.kind).slice(-2), ["agent", "blocks"]);
  assert.equal(historyThreadItems({ id: "h2", subtitle: "Sub", outcome: "Done", completedAt: "2026-01-01T00:00:00Z" } as never).some(item => item.kind === "blocks"), false);
});

test("event, contact, draft and key_value blocks parse and unsafe contact details are dropped", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "test", decisionId: null, category: "social", title: "Trip", request: "Plan", metadata: {} });
  const input = presentResultInputSchema.parse({ ...base, blocks: [
    { type: "key_value", items: [{ label: "Code", value: "AB12", copyable: true }] },
    { type: "draft", channel: "email", status: "draft", to: ["a@example.com"], body: "Hello" },
    { type: "event", title: "Show", startIso: "not a date", calendarActionId: "missing" },
    { type: "contact", name: "Desk", phone: "javascript:alert(1)", email: "x@example.com" },
    { type: "contact", name: "Nobody", phone: "tel:evil" },
  ] });
  assert.equal((await recordAgentResult(store, run.id, input)).accepted, true);
  const blocks = (await store.getRun(run.id))!.result!.blocks! as Array<Record<string, unknown>>;
  assert.deepEqual(blocks.map(block => block.type), ["key_value", "draft", "event", "contact"]);
  assert.equal(blocks[2].startIso, null);
  assert.equal(blocks[2].calendarActionId, null);
  assert.equal(blocks[3].phone, null);
  assert.equal(blocks[3].email, "x@example.com");
});

test("consecutive titled timelines and sections group into one accordion in the agent's order", async () => {
  const { groupBlocks, timelineSummary } = await import("../lib/harness/result-blocks");
  const parsed = presentResultInputSchema.parse({ ...base, blocks: [
    { type: "text", style: "heading", text: "Trip" },
    { type: "timeline", title: "Wednesday", summary: "Old Montreal", items: [{ title: "Walk" }] },
    { type: "timeline", title: "Thursday", items: [{ title: "Lookout" }, { title: "Dinner" }] },
    { type: "section", title: "Links", blocks: [{ type: "link_card", title: "Directory", url: "https://example.com" }] },
    { type: "timeline", items: [{ title: "Untitled stays a plain list" }] },
    { type: "timeline", title: "Friday", items: [{ title: "Home" }] },
  ] });
  const groups = groupBlocks(parsed.blocks);
  assert.deepEqual(groups.map(group => group.kind === "accordion" ? `accordion:${group.rows.map(row => row.index).join(",")}` : `single:${group.index}`), ["single:0", "accordion:1,2,3", "single:4", "accordion:5"]);
  const [, accordion] = groups;
  assert.equal(accordion.kind === "accordion" && timelineSummary(accordion.rows[0].block as never), "Old Montreal");
  assert.equal(accordion.kind === "accordion" && timelineSummary(accordion.rows[1].block as never), "Lookout, Dinner");
});
