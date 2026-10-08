import { NextResponse } from "next/server";
import { currentUserEmail } from "../../../lib/auth/session";
import { listVaultItems, saveVaultItemMetadata } from "../../../lib/vault";
import { vaultMetadataSchema } from "../../../lib/vault-schema";

export async function GET() {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  return NextResponse.json({ items: await listVaultItems(email) }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = vaultMetadataSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid vault metadata.", issues: parsed.error.issues }, { status: 400 });
  const item = await saveVaultItemMetadata({ ownerEmail: email, ...parsed.data });
  return NextResponse.json({ item }, { status: 201, headers: { "cache-control": "private, no-store" } });
}
