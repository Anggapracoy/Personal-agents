import { z } from "zod";
import { resultBlocksSchema } from "./result-blocks";

export const resultSchema = z.object({
  outcome: z.enum(["completed", "no_action", "needs_user"]),
  summary: z.string().min(1).max(500),
  details: z.string().min(1).max(5_000),
  verified: z.boolean(),
  externalChange: z.boolean(),
  options: z.array(z.object({
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(160),
    description: z.string().min(1).max(1_000),
    status: z.string().min(1).max(240),
    sourceUrl: z.string().max(2048).nullable(),
    recommended: z.boolean(),
  })).max(8),
  followUpActions: z.array(z.object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(80),
    description: z.string().min(1).max(240),
    intent: z.string().min(1).max(1_000),
    actionType: z.enum(["approval", "research", "instant"]),
    optionId: z.string().max(120).nullable(),
    sourceUrl: z.string().max(2048).nullable(),
    requiresFreshEvidence: z.boolean(),
  })).max(6),
  // Avoid JSON Schema `format: uri`: some OpenAI reasoning models reject that
  // response format. HTTPS validation is applied after structured generation.
  facts: z.array(z.object({ label: z.string().min(1).max(120), value: z.string().min(1).max(1000), sourceUrl: z.string().max(2048).nullable() })).max(30),
  links: z.array(z.object({ label: z.string().min(1).max(120), url: z.string().max(2048) })).max(30),
  moneySaved: z.object({ amount: z.number().nonnegative(), currency: z.string().min(3).max(3), cadence: z.enum(["one_time", "monthly", "annual"]), basis: z.string().min(1).max(500) }).nullable(),
  recommendedNextStep: z.string().max(500).nullable(),
  blocks: resultBlocksSchema.optional(),
});

// Normalize only absent presentation metadata and the observed literal-null
// encoding mistake. Required outcome/evidence booleans and malformed objects
// remain errors; normalization must never manufacture a verified result.
export const presentResultInputSchema = resultSchema.extend({
  phase: z.enum(["update", "final"]).default("final").describe("Use update to publish blocks now and keep working; final records the completed response."),
  leadIn: z.string().trim().min(1).max(800).optional().describe("A short user-visible recommendation or introduction, rendered as a new assistant message immediately before the blocks. Normally include it for researched options and plans."),
  blocksOnly: z.boolean().default(false).describe("End with the rendered blocks and no separate text reply when those blocks fully answer the request."),
  options: resultSchema.shape.options.element.extend({ sourceUrl: resultSchema.shape.options.element.shape.sourceUrl.default(null) }).array().max(8).default([]),
  followUpActions: resultSchema.shape.followUpActions.element.extend({
    sourceUrl: resultSchema.shape.followUpActions.element.shape.sourceUrl.default(null),
    optionId: resultSchema.shape.followUpActions.element.shape.optionId.default(null),
  }).array().max(6).default([]),
  facts: resultSchema.shape.facts.element.extend({ sourceUrl: resultSchema.shape.facts.element.shape.sourceUrl.default(null) }).array().max(30).default([]),
  links: resultSchema.shape.links.default([]),
  blocks: resultBlocksSchema.default([]),
  moneySaved: resultSchema.shape.moneySaved.or(z.literal("null"))
    .transform(value => value === "null" ? null : value).default(null),
  recommendedNextStep: resultSchema.shape.recommendedNextStep
    .transform(value => value === "null" ? null : value).default(null),
});

export function resultInputForFeature(enabled: boolean) {
  return enabled ? presentResultInputSchema : presentResultInputSchema.omit({ blocks: true, blocksOnly: true, phase: true, leadIn: true });
}

export const blockMessageSchema = z.object({ blocks: resultBlocksSchema, followUpActions: resultSchema.shape.followUpActions });
