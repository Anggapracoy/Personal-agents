import { appleSources, type AppleConnection, type AppleSource } from "../lib/apple/catalog";

export function appleActionSource(operation: string) {
  return appleSources.find(source => source.id === operation.split(".")[0]);
}
export function usableAppleConnection(connection?: AppleConnection) {
  return Boolean(connection?.enabled && ["connected", "limited"].includes(connection.status));
}
/** Connecting grants source access, then resumes this exact requested action, never a reconstructed request. */
export async function connectAndContinueAppleAction(service: AppleSource, input: {
  connect: (service: AppleSource) => Promise<AppleConnection[]>;
  onConnected: (connection: AppleConnection) => void;
  isCurrent: () => boolean;
  execute: () => Promise<boolean>;
}) {
  const connections = await input.connect(service);
  if (!input.isCurrent()) return false;
  const connection = connections.find(source => source.id === service);
  if (connection) input.onConnected(connection);
  if (!usableAppleConnection(connection)) throw new Error("Access wasn’t granted. This request is still waiting.");
  return input.execute();
}

export function appleActionValue(key: string, value: unknown) {
  if (["date", "start", "end"].includes(key) && typeof value === "string" && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value))) {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}
