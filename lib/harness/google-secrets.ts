import { getGoogleConnectionAccessToken, getPrimaryGoogleCredentials } from "../auth/google-connections";
import type { RunStore } from "./types";

/** Stash the Google connection the thread should act as. Secrets are wiped when the thread goes idle, so every dispatch that may use Google re-attaches them. */
export async function attachGoogleSecrets(store: RunStore, runId: string, userId: string, sessionAccessToken: string | undefined, sourceAccountId: string | null) {
  await store.putSecrets(runId, await prepareGoogleSecrets(userId, sessionAccessToken, sourceAccountId));
}

/** Resolve credentials independently; attach only after accepting the reply. */
export async function prepareGoogleSecrets(userId: string, sessionAccessToken: string | undefined, sourceAccountId: string | null, connections = { getPrimaryGoogleCredentials, getGoogleConnectionAccessToken }) {
  const explicitConnection = sourceAccountId && sourceAccountId !== "session" ? sourceAccountId : null;
  const primary = explicitConnection ? null : await connections.getPrimaryGoogleCredentials(userId);
  const connectionId = explicitConnection ?? primary?.connectionId;
  const accessToken = explicitConnection ? await connections.getGoogleConnectionAccessToken(userId, explicitConnection)
    : primary ? primary.accessToken : sessionAccessToken;
  return { ...(connectionId ? { google_connection_id: connectionId } : {}), ...(accessToken ? { google_access_token: accessToken } : {}) } as Record<string, string>;
}

export function sourceAccountIdOf(metadata: Record<string, unknown>) {
  const executionContext = metadata.executionContext as { sourceAccountId?: unknown; emailProvider?: unknown } | undefined;
  if (executionContext?.emailProvider === "icloud") return null;
  return typeof executionContext?.sourceAccountId === "string" ? executionContext.sourceAccountId : null;
}
