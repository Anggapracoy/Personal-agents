import { withRequestBodyLimit } from "../../../../../lib/request-body-limit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedRunSnapshot } from "../../../../../lib/auth/session";
import { resumeRun } from "../../../../../lib/harness/resume";
import { getRunStore } from "../../../../../lib/harness/store";
import { getCloudBrowser } from "../../../../../lib/harness/browser/registry";
import { completeVaultSelection } from "../../../../../lib/harness/vault-selection";
import { getVaultItemSummary } from "../../../../../lib/vault";

const releaseSchema = z.strictObject({
  actionId: z.string().uuid(),
  itemId: z.string().uuid(),
  envelope: z.strictObject({ encryptedKey: z.string().min(64).max(2_000), sealed: z.string().min(24).max(12_000) }),
});

// The body contains ciphertext for a one-time private key held only inside the
// current E2B browser sandbox. This request path receives ciphertext only;
// plaintext never enters the app server, database, action log, or model input.
async function POSTHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = releaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid one-time vault release." }, { status: 400 });
  const owned = await getOwnedRunSnapshot(id);
  if (owned.status === 401) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!owned.snapshot || !owned.email) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const store = getRunStore();
  const action = await store.getAction(parsed.data.actionId, id);
  if (action?.toolName === "vault_request_item") {
    const item = await getVaultItemSummary(owned.email, parsed.data.itemId);
    if (!item) return NextResponse.json({ error: "That saved item is unavailable." }, { status: 409 });
    try {
      await completeVaultSelection({ store, runId: id, actionId: action.id, owner: owned.email, item, browser: getCloudBrowser(owned.email, id) }, parsed.data.envelope);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "The saved item could not be unlocked." }, { status: 409 });
    }
    await resumeRun(store, id, `The user chose and unlocked the requested ${item.kind === "payment_card" ? "card" : "login"} (itemId ${item.id}). Use this exact item and continue secure typing; the same-site unlock is available for 10 minutes.`);
    return NextResponse.json(await store.getSnapshot(id));
  }
  if (!action || action.status !== "proposed" || !["vault_fill_login", "vault_fill_payment"].includes(action.toolName)) return NextResponse.json({ error: "This device unlock is no longer pending." }, { status: 409 });
  if (action.input.itemId !== parsed.data.itemId || action.input.recipientAlgorithm !== "RSA-OAEP-256+A256GCM") return NextResponse.json({ error: "The one-time recipient changed." }, { status: 409 });
  const item = await getVaultItemSummary(owned.email, parsed.data.itemId);
  const expectedKind = action.toolName === "vault_fill_login" ? "login" : "payment_card";
  if (!item || item.kind !== expectedKind) return NextResponse.json({ error: "That on-device vault item is unavailable." }, { status: 409 });
  await store.putSecret(id, `device_vault:${action.id}`, JSON.stringify(parsed.data.envelope));
  const approved = await store.approveAction(action.id, id, owned.email);
  if (!approved) {
    await store.deleteSecret(id, `device_vault:${action.id}`);
    return NextResponse.json({ error: "This device unlock is no longer pending." }, { status: 409 });
  }
  await resumeRun(store, id, "The user unlocked the requested item on their phone. Call the same fill tool again with identical input; the runtime will inject it.");
  return NextResponse.json(await store.getSnapshot(id));
}

export const POST = withRequestBodyLimit(POSTHandler, 1048576);
