import { parseSharedIntakeFiles } from "../../../lib/shared-intake-input";
import { withRequestBodyLimit } from "../../../lib/request-body-limit";
import { enforceApiQuota } from "../../../lib/api-quota";
import { NextResponse } from "next/server";
import { currentUserEmail } from "../../../lib/auth/session";
import { createSharedIntake, type SharedIntakeFile } from "../../../lib/shared-intake";

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;
const MAX_FILES = 6;

async function parseMultipart(request: Request) {
  const form = await request.formData();
  const files: SharedIntakeFile[] = [];
  for (const value of form.getAll("files").slice(0, MAX_FILES)) {
    if (!(value instanceof File) || value.size === 0) continue;
    if (value.size > MAX_FILE_BYTES) throw new Error(`${value.name} is larger than 3 MB.`);
    files.push({ name: value.name, mimeType: value.type || "application/octet-stream", size: value.size, dataBase64: Buffer.from(await value.arrayBuffer()).toString("base64") });
  }
  return {
    text: String(form.get("text") ?? ""),
    url: String(form.get("url") ?? "") || undefined,
    sourceApp: String(form.get("sourceApp") ?? "manual"),
    files,
  };
}

async function parseJson(request: Request) {
  const body = await request.json() as { requestId?: unknown; text?: unknown; url?: unknown; sourceApp?: unknown; files?: unknown };
  const files = parseSharedIntakeFiles(body.files);
  return { requestId: typeof body.requestId === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(body.requestId) ? body.requestId : undefined, text: String(body.text ?? ""), url: typeof body.url === "string" ? body.url : undefined, sourceApp: String(body.sourceApp ?? "iPhone"), files };
}

async function POSTHandler(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const limited = await enforceApiQuota(email, "upload");
  if (limited) return limited;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const input = contentType.includes("multipart/form-data") ? await parseMultipart(request) : await parseJson(request);
    const total = input.files.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_TOTAL_BYTES) return NextResponse.json({ error: "Shared files are larger than 3 MB in total." }, { status: 413 });
    if (!input.text.trim() && !input.url && input.files.length === 0) return NextResponse.json({ error: "Share some text, a link, image, or file." }, { status: 400 });
    if (input.text.length > 40_000) return NextResponse.json({ error: "Shared text is too long." }, { status: 413 });
    return NextResponse.json(await createSharedIntake({ ownerEmail: email, ...input }), { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The shared item could not be processed." }, { status: 400 });
  }
}

export const POST = withRequestBodyLimit(POSTHandler, 6291456);
