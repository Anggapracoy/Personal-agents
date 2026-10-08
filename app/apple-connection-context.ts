import { hasNativeAppleConnections, requestNativeApple } from "./native-bridge";

/** Fetch at Send, including follow-ups after changing Settings or system permissions. */
export async function currentAppleConnections() {
  if (!hasNativeAppleConnections()) return { availability: "unavailable" as const, connections: [] };
  try {
    const result = await requestNativeApple("status");
    return { availability: "available" as const, connections: result.connections ?? [] };
  } catch { return { availability: "unknown" as const, connections: [] }; }
}
