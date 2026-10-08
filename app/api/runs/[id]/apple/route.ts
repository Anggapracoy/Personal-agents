import { withRequestBodyLimit } from "../../../../../lib/request-body-limit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedRunSnapshot } from "../../../../../lib/auth/session";
import { getRunStore } from "../../../../../lib/harness/store";
import { dispatchInteractiveRun } from "../../../../../lib/harness/dispatch";
import { sameOrigin } from "../../../../../lib/http-security";
import { claimAppleAction, finishAppleAction } from "../../../../../lib/apple/actions";
const schema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("claim"), actionId: z.string().uuid() }).strict(),
  z.object({ phase: z.literal("complete"), actionId: z.string().uuid(), token: z.string().uuid(), result: z.record(z.string(), z.unknown()) }).strict(),
]);
async function POSTHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin actions are blocked." }, { status: 403 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid conversation." }, { status: 400 });
  const owned = await getOwnedRunSnapshot(id);
  if (!owned.snapshot || !owned.email) return NextResponse.json({ error: "Conversation unavailable." }, { status: owned.status });
  if (Number(request.headers.get("content-length") ?? 0) > 2_000_000) return NextResponse.json({ error: "Result too large." }, { status: 413 });
  const text = await request.text();
  if (text.length > 2_000_000) return NextResponse.json({ error: "Result too large." }, { status: 413 });
  let value: unknown; try { value = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid result." }, { status: 400 }); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) return NextResponse.json({ error: "Invalid iPhone request." }, { status: 400 });
  const store = getRunStore();
  try {
    if (parsed.data.phase === "claim") return NextResponse.json(await claimAppleAction(store, id, parsed.data.actionId, owned.email));
    const { actionId, token, result } = parsed.data;
    const shouldResume = await finishAppleAction(store, id, actionId, owned.email, token, result);
    const current = await store.getRun(id);
    if ((shouldResume || current?.metadata.appleResumePending === actionId) && current?.status === "running") {
      await dispatchInteractiveRun(id, `apple-result:${actionId}`);
      await store.updateRunMetadata(id, { appleResumePending: null });
    }
    return NextResponse.json(await store.getSnapshot(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The iPhone action could not finish." }, { status: 409 });
  }
}

export const POST = withRequestBodyLimit(POSTHandler, 1048576);
