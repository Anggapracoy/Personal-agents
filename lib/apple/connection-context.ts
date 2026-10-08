import { z } from "zod";
import { appleSources, type AppleConnection } from "./catalog";

const connectionSchema = z.object({
  id: z.enum(appleSources.map(source => source.id)),
  enabled: z.boolean(),
  status: z.enum(["connected", "limited", "disconnected", "denied", "unavailable"]),
});
export type AppleConnectionContext = { availability: "available" | "unavailable" | "unknown"; checkedAt: string; connections: AppleConnection[] };
/** Accept only known status fields; device descriptions never become prompt instructions. */
export function normalizeAppleConnections(value: unknown, now = new Date()): AppleConnectionContext {
  const result = z.object({ availability: z.enum(["available", "unavailable", "unknown"]), connections: z.array(connectionSchema).max(12) }).safeParse(value);
  if (!result.success || (result.data.availability === "available" && (result.data.connections.length !== appleSources.length || new Set(result.data.connections.map(source => source.id)).size !== appleSources.length))) {
    return { availability: "unknown", checkedAt: now.toISOString(), connections: [] };
  }
  return { availability: result.data.availability, checkedAt: now.toISOString(), connections: result.data.availability === "available" ? result.data.connections : [] };
}
export function appleConnectionPrompt(value: unknown, now = new Date()) {
  const snapshot = normalizeAppleConnections(value, now);
  const checkedAt = value && typeof value === "object" && "checkedAt" in value && typeof value.checkedAt === "string" ? value.checkedAt : "";
  const age = now.getTime() - Date.parse(checkedAt);
  const rules = "The Apple tool catalog describes capabilities, not connection status. Use the device snapshot to answer which sources are connected. Name the connected sources directly; do not ask the user to reconnect an enabled source or vaguely say 'whichever you approved'. For a requested task that needs a disconnected source, call apple_device with the intended operation so the app can show its inline Connect option; do not redirect to Dash Settings. Connection is not proof that an operation succeeded: execution still checks permission and must return a real receipt. Requested Apple reads and changes, including Health, run without a separate action approval once connected. This snapshot applies only to the iPhone that sent the message.";
  if (snapshot.availability !== "available" || !Number.isFinite(age) || age < -60_000 || age > 10 * 60_000) return `${rules}\nNo fresh Apple connection snapshot is available for this message. Do not infer disconnected or connected from the presence of apple_device, past messages, or an older phone. If asked for connection status, explain that the current device state could not be checked.`;
  const name = (source: AppleConnection) => appleSources.find(item => item.id === source.id)!.name;
  const connected = snapshot.connections.filter(source => source.enabled && source.status === "connected").map(name);
  const limited = snapshot.connections.filter(source => source.enabled && source.status === "limited").map(source => `${name(source)} (${source.id === "health" ? "enabled; iOS keeps read permission private, so individual data access is only known when requested" : "connected with access to selected items"})`);
  const remaining = snapshot.connections.filter(source => !source.enabled || !["connected", "limited"].includes(source.status)).map(source => `${name(source)}: ${source.status === "denied" ? "permission denied" : source.status === "unavailable" ? "unavailable on this device" : "not connected"}`);
  return `${rules}\nCurrent Apple sources reported by this iPhone at ${new Date(checkedAt).toISOString()}:\nConnected: ${connected.join(", ") || "none"}.\nLimited: ${limited.join("; ") || "none"}.\nOther sources: ${remaining.join("; ") || "none"}.`;
}
