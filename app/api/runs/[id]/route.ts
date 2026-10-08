import { NextResponse } from "next/server";
import { getOwnedRunSnapshot } from "../../../../lib/auth/session";
import { getRunStore } from "../../../../lib/harness/store";
import { threadItems } from "../../../../lib/harness/thread";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await getOwnedRunSnapshot(id);
  if (owned.status === 401) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!owned.snapshot) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const messages = await getRunStore().listMessages(id);
  return NextResponse.json({ ...owned.snapshot, threadItems: threadItems(owned.snapshot, messages) }, { headers: { "cache-control": "private, no-store" } });
}
