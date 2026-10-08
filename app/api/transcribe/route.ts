import { withRequestBodyLimit } from "../../../lib/request-body-limit";

import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { enforceApiQuota } from "../../../lib/api-quota";

export const runtime = "nodejs";
export const maxDuration = 60;

const transcriptionModel = process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-transcribe";
const maximumAudioBytes = 4 * 1024 * 1024;
const supportedAudioTypes = new Set([
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);

async function POSTHandler(request: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const limited = await enforceApiQuota(session.user.email, "transcription");
  if (limited) return limited;
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "Voice input is temporarily unavailable." }, { status: 503 });

  const incoming = await request.formData();
  const file = incoming.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "An audio recording is required." }, { status: 400 });
  if (file.size > maximumAudioBytes) return NextResponse.json({ error: "That recording is too long. Try a shorter one." }, { status: 413 });
  const baseType = file.type.toLowerCase().split(";")[0];
  if (baseType && !supportedAudioTypes.has(baseType)) return NextResponse.json({ error: "That audio format isn’t supported." }, { status: 415 });

  const upstreamBody = new FormData();
  upstreamBody.set("file", file, file.name || "voice.webm");
  upstreamBody.set("model", transcriptionModel);
  upstreamBody.set("response_format", "json");

  const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: upstreamBody,
  });
  const payload = await upstream.json().catch(() => ({})) as { text?: string; usage?: { type?: string; seconds?: number }; error?: { message?: string } };
  if (!upstream.ok) {
    console.error("Voice transcription failed", { status: upstream.status, message: payload.error?.message ?? "Unknown OpenAI error" });
    return NextResponse.json({ error: "I couldn’t transcribe that recording. Try again." }, { status: 502 });
  }
  const text = payload.text?.trim();
  if (!text) return NextResponse.json({ error: "I didn’t hear any words in that recording." }, { status: 422 });
  return NextResponse.json({ text, model: transcriptionModel });
}

export const POST = withRequestBodyLimit(POSTHandler, 5242880);
