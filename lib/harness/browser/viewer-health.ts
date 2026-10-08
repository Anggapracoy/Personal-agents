export type ViewerHealth = "connected" | "reconnect" | "unavailable" | "mode_changed";

export function viewerHealth(state: {
  expiresAt?: number;
  live?: Record<string, { control?: boolean; expiresAt?: number; transport?: { key: string; token: string } }>;
}, transports: Record<string, string>, targetKey: string, control: boolean, now = Date.now() / 1000): ViewerHealth {
  if (!state.expiresAt || state.expiresAt <= now) return "unavailable";
  const live = state.live?.[targetKey];
  if (!live) return "unavailable";
  // An expired takeover no longer owns the page. Let the passive viewer mint
  // a fresh stream instead of permanently reporting a control-mode change.
  if (!live.expiresAt || live.expiresAt <= now) return "unavailable";
  if (Boolean(live.control) !== control) return "mode_changed";
  if (!live.transport || transports[live.transport.key] !== live.transport.token) return "reconnect";
  return "connected";
}
