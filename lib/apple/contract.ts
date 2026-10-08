import { z } from "zod";
import { appleOperations } from "./catalog";
export const appleRequestSchema = z.object({
  operation: z.enum(appleOperations),
  parameters: z.record(z.string().max(40), z.union([z.string().max(100_000), z.number().finite(), z.boolean(), z.array(z.string().max(500)).max(100), z.null()])),
  purpose: z.string().min(1).max(300),
}).strict();
export type AppleRequest = z.infer<typeof appleRequestSchema>;
/** Keep path validation identical in native code. Only paths beneath the selected folder. */
export function safeAppleFilePath(path: string) {
  return Boolean(path && path.length <= 500 && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") && path.split("/").every((part) => part !== ".." && part !== "." && part !== ""));
}
export function validateAppleRequest(value: unknown): AppleRequest {
  const input = appleRequestSchema.parse(value);
  const p = input.parameters;
  if (input.operation === "photos.save" && !z.string().uuid().safeParse(p.artifactId).success) throw new Error("A real image artifact ID is required.");
  if (Object.keys(p).length > 20) throw new Error("Too many parameters.");
  if (p.limit != null && (typeof p.limit !== "number" || !Number.isInteger(p.limit) || p.limit < 1 || p.limit > 100)) throw new Error("limit must be 1–100.");
  for (const name of ["latitude", "destinationLatitude"]) if (p[name] != null && (typeof p[name] !== "number" || Math.abs(p[name]) > 90)) throw new Error("Invalid latitude.");
  for (const name of ["longitude", "destinationLongitude"]) if (p[name] != null && (typeof p[name] !== "number" || Math.abs(p[name]) > 180)) throw new Error("Invalid longitude.");
  if ((input.operation === "files.read" || input.operation === "files.write") && (typeof p.path !== "string" || !safeAppleFilePath(p.path))) throw new Error("Use a relative path inside the connected folder.");
  for (const name of ["start", "end", "date"]) if (p[name] != null && (typeof p[name] !== "string" || !Number.isFinite(Date.parse(p[name])) || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(p[name]))) throw new Error(`${name} must be an ISO date with timezone.`);
  if (typeof p.start === "string" && typeof p.end === "string" && Date.parse(p.end) <= Date.parse(p.start)) throw new Error("end must be after start.");
  return input;
}
