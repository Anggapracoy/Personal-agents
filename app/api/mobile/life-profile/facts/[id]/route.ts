import { NextResponse } from "next/server";
import { currentUserEmail } from "../../../../../../lib/auth/session";
import { deleteLifeFact } from "../../../../../../lib/life-profile";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid fact." }, { status: 400 });
  const deleted = await deleteLifeFact(email, id);
  return deleted
    ? NextResponse.json({ deleted: true })
    : NextResponse.json({ error: "Fact not found." }, { status: 404 });
}
