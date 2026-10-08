import { enforceApiQuota } from "../../../../../lib/api-quota";
import { NextResponse } from "next/server";
import { currentUserEmail } from "../../../../../lib/auth/session";
import { getRunStore } from "../../../../../lib/harness/store";
import { suggestConversationIdentity } from "../../../../../lib/harness/conversation-identity";

export const maxDuration = 20;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const limited = await enforceApiQuota(email, "title");
  if (limited) return limited;
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const store = getRunStore();
  const run = await store.getRun(id);
  if (!run || run.userId !== email) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  try {
    const identity = await suggestConversationIdentity(store, id, email);
    return NextResponse.json({ ...identity, updated: Boolean(identity), snapshot: await store.getSnapshot(id) }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    // Cosmetic metadata must never block or fail the user's actual conversation.
    return NextResponse.json({ title: null, category: null, updated: false });
  }
}
