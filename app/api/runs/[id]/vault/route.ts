import { withRequestBodyLimit } from "../../../../../lib/request-body-limit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedRunSnapshot } from "../../../../../lib/auth/session";
import { getRunStore } from "../../../../../lib/harness/store";
import { getCloudBrowser } from "../../../../../lib/harness/browser/registry";
import { prepareVaultSelection } from "../../../../../lib/harness/vault-selection";
import { getVaultItemSummary } from "../../../../../lib/vault";

const requestSchema = z.strictObject({ actionId: z.string().uuid(), itemId: z.string().uuid() });

async function POSTHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid device vault item." }, { status: 400 });
  const owned = await getOwnedRunSnapshot(id);
  if (owned.status === 401) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!owned.snapshot || !owned.email) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const item = await getVaultItemSummary(owned.email, parsed.data.itemId);
  if (!item) return NextResponse.json({ error: "That saved item is unavailable." }, { status: 409 });
  try {
    const challenge = await prepareVaultSelection({ store: getRunStore(), runId: id, actionId: parsed.data.actionId, owner: owned.email, item, browser: getCloudBrowser(owned.email, id) });
    return NextResponse.json(challenge);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "That saved item could not be selected." }, { status: 409 });
  }
}

export const POST = withRequestBodyLimit(POSTHandler, 1048576);
