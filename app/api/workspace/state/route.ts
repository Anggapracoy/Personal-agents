import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserEmail } from "../../../../lib/auth/session";
import { getWorkspaceState, putWorkspaceState } from "../../../../lib/workspace-state";
import type { WorkspacePreferences, WorkspaceStateData } from "../../../../lib/types";

const preferencesSchema = z.object({
  appearance: z.enum(["system", "light", "dark"]),
  modelSettings: z.object({
    provider: z.enum(["anthropic", "openai", "meta"]),
    modelId: z.string().trim().min(1).max(120),
    reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]),
    defaultVersion: z.number().int().min(0).max(100).optional(),
  }),
});

const stateSchema = z.object({
  decisions: z.array(z.record(z.string(), z.unknown())).max(1000),
  tasks: z.array(z.record(z.string(), z.unknown())).max(1000),
  history: z.array(z.record(z.string(), z.unknown())).max(5000),
  discardedDecisionIds: z.array(z.string().max(500)).max(10000),
});

const updateSchema = z.object({
  expectedVersion: z.number().int().min(0),
  state: stateSchema,
  preferences: preferencesSchema,
});

export async function GET() {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  return NextResponse.json(await getWorkspaceState(email), {
    headers: { "cache-control": "private, no-store" },
  });
}

export async function PUT(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const raw = await request.text();
  if (raw.length > 2_500_000) return NextResponse.json({ error: "Workspace state is too large." }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw || "{}"); }
  catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid workspace state.", issues: parsed.error.issues }, { status: 400 });
  const result = await putWorkspaceState(
    email,
    parsed.data.state as WorkspaceStateData,
    parsed.data.preferences as WorkspacePreferences,
    parsed.data.expectedVersion,
  );
  if (result.conflict) return NextResponse.json({ error: "Workspace changed on another device.", current: result.current }, { status: 409 });
  return NextResponse.json({
    state: result.row.state,
    preferences: result.row.preferences,
    version: result.row.version,
    updatedAt: result.row.updatedAt.toISOString(),
  }, { headers: { "cache-control": "private, no-store" } });
}
