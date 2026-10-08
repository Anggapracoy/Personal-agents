/** Live end-to-end model probes, fictional chat only. Run with --env-file=.env.local. */
import { createAgentModel } from "../lib/harness/model";
import { runAgent } from "../lib/harness/run";
import { MemoryRunStore } from "../lib/harness/store";
import { threadItems } from "../lib/harness/thread";
import { reactionMessage } from "../lib/harness/reactions";

// These probes never use the application's durable database or user accounts.
delete process.env.DATABASE_URL;
delete process.env.INNGEST_EVENT_KEY;
const cases = [
  { id: "explicit-silence", request: "don't respond to this", expected: "silent" },
  { id: "social-thanks", request: "thx", expected: "social" },
  { id: "substantive-request", request: "can u find me three good names for a coffee shop", expected: "text" },
  { id: "reaction-approval", request: "coffee shop names", offer: "want me to suggest three names for your coffee shop?", expected: "text" },
  { id: "reaction-to-result", request: "coffee shop names", offer: "three ideas: Daybreak, Little Ritual, and Common Ground", expected: "social" },
  { id: "quiet-work", request: "think of three names for a coffee shop but don't respond", expected: "silent" },
];
let failures = 0;
for (const probe of cases) {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "conversation-eval@example.invalid", decisionId: null, category: "social", title: "Conversation probe", request: probe.request, metadata: { sourceType: "manual", userMessage: probe.request, modelProvider: "openai", modelId: "gpt-5.6-sol", reasoningEffort: "low" } });
  if (probe.offer) {
    const rows = await store.appendMessages(run.id, [{ role: "user", content: probe.request }, { role: "assistant", content: probe.offer }]);
    await store.appendMessages(run.id, [reactionMessage({ eventId: crypto.randomUUID(), messageId: rows[1].id, emoji: "👍" }, "user", probe.offer)]);
  }
  await runAgent({ store, runId: run.id, model: createAgentModel(store), signal: AbortSignal.timeout(90000) });
  const snapshot = (await store.getSnapshot(run.id))!;
  const items = threadItems(snapshot, await store.listMessages(run.id));
  const replies = items.filter(item => item.kind === "agent").map(item => item.text).filter(text => text !== probe.offer);
  const mode = snapshot.metadata.responseDisposition;
  const passed = snapshot.status === "done" && (probe.expected === "silent" ? mode === "silent" && replies.length === 0 && !snapshot.response && !snapshot.result : probe.expected === "text" ? mode === "text" && replies.some(text => text.length > 20) : replies.join(" ").length < 180);
  if (!passed) failures++;
  console.log(JSON.stringify({ probe: probe.id, passed, status: snapshot.status, mode, replies, reactions: items.flatMap(item => item.kind === "user" || item.kind === "agent" ? item.reactions ?? [] : []), error: snapshot.error }));
}
process.exitCode = failures ? 1 : 0;
