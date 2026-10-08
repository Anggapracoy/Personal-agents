import { jsonSchema, zodSchema } from "ai";
import { z } from "zod";
import { scheduleDefinitionSchema } from "./timing";

function decodeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

// Only recover serialization mistakes. Never invent an omitted cadence or date.
function normalizeDefinition(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const definition = { ...value } as Record<string, unknown>;
  if (typeof definition.recurrence === "string") definition.recurrence = decodeJson(definition.recurrence);
  for (const key of ["firstRunAt", "endAt"]) {
    if (definition[key] === "null") definition[key] = null;
  }
  return definition;
}

function providerSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(providerSchema);
  if (!value || typeof value !== "object") return value;
  const node = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, providerSchema(child)])) as Record<string, any>;
  // Expose nullable types directly instead of hiding them behind union wrappers.
  if (node.anyOf?.length === 2) {
    const concrete = node.anyOf.find((branch: any) => branch.type !== "null");
    if (node.anyOf.some((branch: any) => branch.type === "null") && concrete?.type) {
      delete node.anyOf;
      return { ...node, ...concrete, type: [concrete.type, "null"] };
    }
  }
  if (node.oneOf?.length === 2 && node.oneOf.every((branch: any) => branch.type === "object" && ["cron", "interval"].includes(branch.properties?.type?.const))) {
    return { type: "object", properties: { type: { type: "string", enum: ["cron", "interval"] }, expression: { type: "string", maxLength: 120 }, minutes: { type: "integer", minimum: 1, maximum: 525600 } }, required: ["type"], additionalProperties: false };
  }
  return node;
}

function inputSchema<T>(schema: z.ZodType<T>, normalize: (value: unknown) => unknown) {
  // Advertise the canonical schema; decode at the SDK validation boundary,
  // before execute runs, then apply exactly the same strict field validation.
  return jsonSchema<T>(async () => providerSchema(await zodSchema(schema).jsonSchema) as Awaited<ReturnType<typeof zodSchema>["jsonSchema"]>, {
    validate(value) {
      const result = schema.safeParse(normalize(value));
      return result.success ? { success: true, value: result.data } : { success: false, error: result.error };
    },
  });
}

export const scheduleCreateInputSchema = inputSchema(scheduleDefinitionSchema, normalizeDefinition);
const updateSchema = z.object({ id: z.string().uuid(), status: z.enum(["active", "paused", "cancelled"]).nullable(), definition: scheduleDefinitionSchema.nullable() });
export const scheduleUpdateInputSchema = inputSchema(updateSchema, value => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const update = { ...value } as Record<string, unknown>;
  update.definition = normalizeDefinition(update.definition);
  return update;
});
