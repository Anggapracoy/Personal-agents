import { NextResponse } from "next/server";
import { currentUserEmail } from "../../../../lib/auth/session";
import { deleteVaultItem, saveVaultItemMetadata } from "../../../../lib/vault";
import { vaultMetadataSchema } from "../../../../lib/vault-schema";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  const parsed = vaultMetadataSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid vault metadata.", issues: parsed.error.issues }, { status: 400 });
  const item = await saveVaultItemMetadata({ ownerEmail: email, id, ...parsed.data });
  return NextResponse.json({ item }, { headers: { "cache-control": "private, no-store" } });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!await deleteVaultItem(email, id)) return NextResponse.json({ error: "Vault item not found." }, { status: 404 });
  return NextResponse.json({ deleted: true }, { headers: { "cache-control": "private, no-store" } });
}
