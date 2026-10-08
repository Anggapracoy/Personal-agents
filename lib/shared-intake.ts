
import { conversationOpeningGuidance } from "./conversation-copy";
import { createHash } from "node:crypto";
import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { sharedIntakes } from "../db/schema";
import type { Decision } from "./types";
import { getLifeProfile, type LifeMemory } from "./life-profile";
import { compactLifeMemory, lifeMemoryPrompt } from "./life-memory-context";

export type SharedIntakeFile = { name: string; mimeType: string; size: number; dataBase64: string };

export const intakeDecisionSchema = z.object({
  title: z.string().min(5).max(100),
  subtitle: z.string().min(1).max(600).describe(conversationOpeningGuidance),
  iconKind: z.enum(["plane", "doc", "plate", "tv", "tag", "wine", "card", "calendar", "key", "gift", "shield", "pin", "cart", "people"]).describe("The one everyday object that stands for this request."),
  category: z.enum(["schedule", "money", "food", "family", "shopping", "travel", "social"]),
  urgency: z.enum(["high", "medium", "low"]),
  whyThisAppeared: z.array(z.string().min(3).max(220)).min(1).max(4),
  options: z.array(z.object({
    label: z.string().min(2).max(44),
    sublabel: z.string().max(100).nullable(),
    actionType: z.enum(["instant", "approval", "research", "link", "no_action"]),
  })).min(2).max(4),
});

function firstUrl(text: string) {
  const candidate = text.match(/https:\/\/[^\s<>()]+/i)?.[0];
  if (!candidate) return undefined;
  try { return new URL(candidate).toString(); } catch { return undefined; }
}

function safeFileName(value: string) {
  return value.replace(/[\u0000-\u001f/\\]/g, "-").slice(0, 180) || "Shared item";
}

function compactTitle(value: string, limit = 100) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= limit) return normalized;
  const candidate = normalized.slice(0, limit + 1);
  const wordBoundary = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, wordBoundary > 0 ? wordBoundary : limit).trim()}…`;
}

export function fallbackDecision(text: string, files: SharedIntakeFile[]) {
  const subject = compactTitle(text.trim().split(/\n|[.!?]\s/)[0] || files[0]?.name || "Shared task");
  return intakeDecisionSchema.parse({
    title: subject.length < 5 ? `Handle ${subject}` : subject,
    subtitle: files.length ? `got ${files.length} ${files.length === 1 ? "file" : "files"}\n\nwhat do u want me to do with ${files.length === 1 ? "it" : "them"}?` : "got it, what do u want me to do with this?",
    iconKind: "doc",
    category: "social",
    urgency: "medium",
    whyThisAppeared: ["You shared this directly with Dash."],
    options: [
      { label: "Handle it", sublabel: "Let the agent complete the task", actionType: "approval" },
      { label: "Review first", sublabel: "Research the best next step", actionType: "research" },
    ],
  });
}

async function analyzeIntake(text: string, url: string | undefined, files: SharedIntakeFile[], lifeMemory: LifeMemory, ownerEmail: string) {
  const context = [
    text.trim() && `Shared text:\n${text.trim()}`,
    url && `Shared URL: ${url}`,
    files.length && `Shared files: ${files.map((file) => `${file.name} (${file.mimeType}, ${file.size} bytes)`).join(", ")}`,
  ].filter(Boolean).join("\n\n");
  const content: Array<Record<string, unknown>> = [{ type: "text", text: context || "The user shared an item with Dash." }];
  for (const file of files.slice(0, 4)) {
    if (file.mimeType.startsWith("image/")) content.push({ type: "image", image: Buffer.from(file.dataBase64, "base64"), mediaType: file.mimeType });
    else if (file.mimeType === "application/pdf") content.push({ type: "file", data: Buffer.from(file.dataBase64, "base64"), mediaType: file.mimeType, filename: file.name });
    else if (file.mimeType.startsWith("text/") && file.size <= 250_000) content.push({ type: "text", text: `Contents of ${file.name}:\n${Buffer.from(file.dataBase64, "base64").toString("utf8").slice(0, 20_000)}` });
  }
  try {
    const result = await generateText({
      model: openai(process.env.SHARED_INTAKE_MODEL_ID ?? "gpt-6-luna"),
      output: Output.object({ schema: intakeDecisionSchema }),
      system: [
        conversationOpeningGuidance,
        "You turn something a consumer deliberately shared into one concise life-decision card.",
        "The subtitle opens a personal conversation about what they shared. The title describes the real-world job or consequence, never the medium it came from.",
        "Return 2-4 mutually distinct outcome actions. Never use Reply, Forward, Draft, Open email, or other medium-centric actions.",
        "Use approval for actions that may submit, send, sign, purchase, cancel, book, or change external state; research for investigation; instant only for safe internal organization; and no_action when the user's choice requires Dash only to record the decision in History without starting an agent.",
        "The first option is the recommended primary outcome. Do not invent a deadline, price, person, or obligation that is not visible in the shared content.",
        lifeMemoryPrompt(lifeMemory),
      ].join("\n"),
      messages: [{ role: "user", content: [
        { type: "text", text: `Saved life context:\n${JSON.stringify(compactLifeMemory(lifeMemory))}` },
        ...content,
      ] as never }],
      providerOptions: { openai: { reasoningEffort: "medium", reasoningSummary: null } },
    });
    return result.output;
  } catch (error) {
    console.warn("[shared-intake] model analysis failed; using safe fallback", { error: error instanceof Error ? error.message : String(error) });
    return fallbackDecision(text, files);
  }
}

export async function createSharedIntake(input: {
  ownerEmail: string;
  requestId?: string;
  sourceApp: string;
  text: string;
  url?: string;
  files: SharedIntakeFile[];
}) {
  let cleanedText = input.text.trim().slice(0, 40_000);
  let sourceUrl = input.url || firstUrl(cleanedText);
  let files = input.files.map((file) => ({ ...file, name: safeFileName(file.name) }));
  const now = new Date();
  const intakeId = input.requestId ? sharedIntakeId(input.ownerEmail, input.requestId) : undefined;
  const [inserted] = await getDb().insert(sharedIntakes).values({
    ...(intakeId ? { id: intakeId } : {}),
    ownerEmail: input.ownerEmail.trim().toLowerCase(),
    sourceApp: input.sourceApp.trim().slice(0, 120) || "manual",
    textContent: cleanedText,
    sourceUrl: sourceUrl ?? null,
    files,
    analysis: {},
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().returning();
  const row = inserted ?? (intakeId ? (await getDb().select().from(sharedIntakes).where(and(eq(sharedIntakes.id, intakeId), eq(sharedIntakes.ownerEmail, input.ownerEmail.trim().toLowerCase()))))[0] : undefined);
  if (!row) throw new Error("Shared item could not be saved.");
  cleanedText = row.textContent;
  sourceUrl = row.sourceUrl ?? undefined;
  files = row.files;
  const lifeMemory = await getLifeProfile(input.ownerEmail);
  const existing = intakeDecisionSchema.safeParse(row.analysis);
  const analysis = existing.success ? existing.data : await analyzeIntake(cleanedText, sourceUrl, files, lifeMemory, input.ownerEmail);
  await getDb().update(sharedIntakes).set({ analysis, updatedAt: new Date() }).where(eq(sharedIntakes.id, row.id));
  const digest = createHash("sha256").update(row.id).digest("hex").slice(0, 16);
  const decision: Decision = {
    id: `shared-${digest}`,
    discoveryFingerprint: `shared:${row.id}`,
    sourceType: "manual",
    category: analysis.category,
    urgency: analysis.urgency,
    title: analysis.title,
    subtitle: analysis.subtitle,
    iconKind: analysis.iconKind,
    sourceLabel: row.sourceApp === "manual" ? "Added by you" : `Shared from ${row.sourceApp}`,
    whyThisAppeared: analysis.whyThisAppeared,
    originalContext: [`Shared directly with Dash.`, cleanedText, sourceUrl ? `URL: ${sourceUrl}` : "", files.length ? `Files: ${files.map((file) => file.name).join(", ")}` : ""].filter(Boolean).join("\n\n").slice(0, 24_000),
    executionContext: { sharedIntake: { intakeId: row.id, text: cleanedText, url: sourceUrl, files: files.map(({ name, mimeType, size }) => ({ name, mimeType, size })) } },
    options: analysis.options.map((option, index) => ({ id: `shared-option-${index + 1}`, ...option, sublabel: option.sublabel ?? undefined, isPrimary: index === 0 })),
    dismissLabel: "Do nothing",
    createdAt: row.createdAt.toISOString(),
  };
  return { intakeId: row.id, decision };
}

/** A repeated delivery is one intake; another intentional share gets a new request ID. */
export function sharedIntakeId(ownerEmail: string, requestId: string) {
  const hash = createHash("sha256").update(`${ownerEmail.trim().toLowerCase()}:${requestId}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function sharedIntakeFiles(ownerEmail: string, metadata: Record<string, unknown>) {
  const context = metadata.executionContext as Decision["executionContext"] | undefined;
  const intakeId = context?.sharedIntake?.intakeId;
  if (!intakeId) return [];
  if (!z.string().uuid().safeParse(intakeId).success) throw new Error("Invalid shared item.");
  const [row] = await getDb().select().from(sharedIntakes).where(and(eq(sharedIntakes.id, intakeId), eq(sharedIntakes.ownerEmail, ownerEmail.trim().toLowerCase())));
  if (!row) throw new Error("Shared item is unavailable for this account.");
  return row.files.map(normalizeSharedIntakeFile);
}

/** Older iPhone shares labeled public.image bytes as application/octet-stream. */
export function normalizeSharedIntakeFile({ name, mimeType, dataBase64 }: SharedIntakeFile) {
  const bytes = Buffer.from(dataBase64, "base64");
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) mimeType = "image/jpeg";
  else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mimeType = "image/png";
  else if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) mimeType = "image/gif";
  else if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") mimeType = "image/webp";
  return { name, mimeType, dataBase64 };
}
