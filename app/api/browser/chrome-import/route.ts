import { NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { listLocalChromeProfiles, localChromeImportAvailable, readLocalChromeCookies } from "../../../../lib/browser/chrome-profile-import";
import { getCloudBrowser } from "../../../../lib/harness/browser/registry";

export const runtime = "nodejs";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

async function authenticatedUser() {
  const session = await auth();
  return session?.user?.email?.trim().toLowerCase() ?? null;
}

export async function GET(request: Request) {
  const userId = await authenticatedUser();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!localChromeImportAvailable(request.url)) return NextResponse.json({ error: "Chrome import is available only from the local Mac app." }, { status: 409 });
  try {
    return NextResponse.json({ profiles: await listLocalChromeProfiles() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chrome profiles could not be read.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await authenticatedUser();
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin Chrome import is blocked." }, { status: 403 });
  if (!localChromeImportAvailable(request.url)) return NextResponse.json({ error: "Chrome import is available only from the local Mac app." }, { status: 409 });
  const body = await request.json().catch(() => ({})) as { profileId?: unknown; domains?: unknown };
  try {
    const imported = await readLocalChromeCookies(body.profileId, body.domains);
    if (imported.cookies.length === 0) return NextResponse.json({ error: `No reusable Chrome sessions were found for ${imported.domains.join(", ")}. ${imported.skipped ? `${imported.skipped} device-bound or unreadable cookies were skipped.` : ""}`.trim() }, { status: 422 });
    const result = await getCloudBrowser(userId).importCookies(userId, imported.cookies);
    return NextResponse.json({ imported: result.imported, discovered: imported.discovered, skipped: imported.skipped, domains: imported.domains });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chrome sessions could not be imported.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
