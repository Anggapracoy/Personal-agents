import { getRunStore } from "../../../../../lib/harness/store";
import { getOwnedRunSnapshot } from "../../../../../lib/auth/session";
import { threadItems } from "../../../../../lib/harness/thread";

const terminal = new Set(["done", "failed", "cancelled"]);
const streamLifetimeMs = 4 * 60 * 1000;
const heartbeatIntervalMs = 15 * 1000;
const progressPollIntervalMs = 750;
const replyPollIntervalMs = 100;
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await getOwnedRunSnapshot(id);
  if (owned.status === 401) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!owned.snapshot) return Response.json({ error: "Run not found" }, { status: 404 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now();
      let lastHeartbeatAt = startedAt;
      let last = "";
      controller.enqueue(encoder.encode("retry: 1000\n\n"));
      while (!request.signal.aborted && Date.now() - startedAt < streamLifetimeMs) {
        const snapshot = await getRunStore().getSnapshot(id);
        if (!snapshot) { controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "Run not found" })}\n\n`)); break; }
        // Let scheduled finalization decide whether a check should produce a visible reply.
        if (snapshot.metadata.scheduleExecution && terminal.has(snapshot.status)) {
          await new Promise((resolve) => setTimeout(resolve, progressPollIntervalMs));
          continue;
        }
        const messages = await getRunStore().listMessages(id);
        const serialized = JSON.stringify({ ...snapshot, threadItems: threadItems(snapshot, messages) });
        if (serialized !== last) { controller.enqueue(encoder.encode(`event: snapshot\ndata: ${serialized}\n\n`)); last = serialized; }
        if (terminal.has(snapshot.status) || (snapshot.status === "paused" && snapshot.metadata.automaticPause)) break;
        if (Date.now() - lastHeartbeatAt >= heartbeatIntervalMs) {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
          lastHeartbeatAt = Date.now();
        }
        // The chat displays completed message records, not response deltas.
        // Once an answer is being generated, pick up its saved record promptly
        // instead of making a finished reply wait another full progress poll.
        const pollIntervalMs = snapshot.status === "running" && snapshot.metadata.replyTyping === true ? replyPollIntervalMs : progressPollIntervalMs;
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      if (!request.signal.aborted) controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
