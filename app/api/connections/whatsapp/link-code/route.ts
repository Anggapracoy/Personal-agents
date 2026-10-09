import postgres from "postgres";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { createWhatsAppLinkCode } from "../../../../../lib/channels/whatsapp-linking";

export const runtime = "nodejs";

declare global { var __anakbuahWhatsAppLinkSql: ReturnType<typeof postgres> | undefined; }

function database() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return globalThis.__anakbuahWhatsAppLinkSql ??= postgres(url, { prepare: false, max: 2 });
}

export async function POST() {
  const session = await auth();
  const ownerEmail = session?.user?.email?.trim().toLowerCase();
  if (!ownerEmail) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const sql = database();
  if (!sql) return NextResponse.json({ error: "WhatsApp linking is not configured." }, { status: 503 });
  const result = await createWhatsAppLinkCode(sql, ownerEmail);
  return NextResponse.json({ code: result.code, expiresAt: result.expiresAt.toISOString(), instruction: `Send LINK ${result.code} to the Anakbuah WhatsApp number.` }, { status: 201 });
}
