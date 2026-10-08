import { NextResponse } from "next/server";
import { currentUserEmail } from "../../../../lib/auth/session";
import { sameOrigin } from "../../../../lib/http-security";
import { getProfilePhoto, MAX_PHOTO_BYTES, normalizeProfilePhoto, saveProfilePhoto } from "../../../../lib/profile-photo";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try { return NextResponse.json({ image: await getProfilePhoto(email) }, { headers }); }
  catch { return NextResponse.json({ error: "Couldn't load your photo." }, { status: 503, headers }); }
}
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin changes are blocked." }, { status: 403 });
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!request.body || Number(request.headers.get("content-length") || 0) > MAX_PHOTO_BYTES) return NextResponse.json({ error: "Choose a photo smaller than 3 MB." }, { status: 413 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_PHOTO_BYTES) { await reader.cancel(); return NextResponse.json({ error: "Choose a photo smaller than 3 MB." }, { status: 413 }); }
      chunks.push(value);
    }
    let image: string;
    try { image = await normalizeProfilePhoto(Buffer.concat(chunks)); }
    catch { return NextResponse.json({ error: "Couldn't read that photo. Try a JPEG, PNG, or WebP image." }, { status: 400 }); }
    await saveProfilePhoto(email, image);
    return NextResponse.json({ image }, { headers });
  } catch { return NextResponse.json({ error: "Couldn't save your photo. Try again." }, { status: 503, headers }); }
}
