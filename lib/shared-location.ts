/** A location the person explicitly attaches to a single conversation turn. */
export type SharedLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
};

export function validSharedLocation(value: unknown): value is SharedLocation {
  if (!value || typeof value !== "object") return false;
  const location = value as SharedLocation;
  return Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90
    && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180
    && Number.isFinite(location.accuracy) && location.accuracy >= 0
    && typeof location.capturedAt === "string" && Number.isFinite(Date.parse(location.capturedAt));
}

export function sharedLocationUrl(location: SharedLocation) {
  return `https://maps.apple.com/?ll=${location.latitude.toFixed(6)},${location.longitude.toFixed(6)}`;
}

export function sharedLocationAccuracy(location: SharedLocation) {
  const metres = Math.max(1, Math.ceil(location.accuracy));
  return metres >= 1000 ? `Within ${(metres / 1000).toFixed(1)} km` : `Within ${metres} m`;
}

/** Plain text keeps coordinates available to every model and existing reply path. */
export function messageWithLocation(text: string, location: SharedLocation | null) {
  if (!location || !validSharedLocation(location)) return text.trim();
  return [text.trim(), `My current location: ${sharedLocationUrl(location)}\nLocation captured: ${new Date(location.capturedAt).toISOString()} (accuracy: ${Math.ceil(location.accuracy)} metres).`].filter(Boolean).join("\n\n");
}

/** Render our location attachment as a card while retaining the full text for the agent. */
export function splitLocationMessage(text: string): { text: string; location: SharedLocation | null } {
  const match = /(?:^|\n\n)My current location: https:\/\/maps\.apple\.com\/\?ll=(-?\d+\.\d{6}),(-?\d+\.\d{6})\nLocation captured: (\d{4}-\d{2}-\d{2}T[\d:.]+Z) \(accuracy: (\d+) metres\)\.$/.exec(text);
  if (!match) return { text, location: null };
  const location: SharedLocation = { latitude: Number(match[1]), longitude: Number(match[2]), capturedAt: match[3], accuracy: Number(match[4]) };
  return validSharedLocation(location) ? { text: text.slice(0, match.index).trim(), location } : { text, location: null };
}
