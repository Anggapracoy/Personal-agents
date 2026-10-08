
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../db";
import { connectedGoogleAccounts } from "../../db/schema";
import { googleReconnectRequired } from "./google-connection-health";
import { decryptSecret, encryptSecret } from "../harness/secrets";

const TOKEN_REFRESH_WINDOW_MS = 60_000;

export type ConnectedGoogleAccount = {
  id: string;
  email: string;
  name: string;
  enabled: boolean;
  connectedAt: string;
  needsReconnect?: boolean;
};

export type UsableGoogleConnection = ConnectedGoogleAccount & {
  accessToken: string;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function upsertConnectedGoogleAccount(input: {
  ownerEmail: string;
  googleSubject: string;
  email: string;
  name?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  scopes?: string | null;

}) {
  const ownerEmail = normalizeEmail(input.ownerEmail);
  const email = normalizeEmail(input.email);
  const db = getDb();
  const [existing] = await db.select().from(connectedGoogleAccounts).where(and(
    eq(connectedGoogleAccounts.ownerEmail, ownerEmail),
    eq(connectedGoogleAccounts.googleSubject, input.googleSubject),
  )).limit(1);
  const now = new Date();
  const values = {
    ownerEmail,
    googleSubject: input.googleSubject,
    email,
    name: input.name?.trim() || email.split("@")[0]!,
    encryptedAccessToken: encryptSecret(input.accessToken),
    encryptedRefreshToken: input.refreshToken
      ? encryptSecret(input.refreshToken)
      : existing?.encryptedRefreshToken ?? null,
    accessTokenExpiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    scopes: input.scopes ?? "",
    enabled: true,
    reconnectRequiredAt: null,
    updatedAt: now,
  };
  let account: typeof connectedGoogleAccounts.$inferSelect;
  if (existing) {
    const [updated] = await db.update(connectedGoogleAccounts).set(values)
      .where(eq(connectedGoogleAccounts.id, existing.id)).returning();
    account = updated!;
  } else {
    const [created] = await db.insert(connectedGoogleAccounts).values({ ...values, createdAt: now }).returning();
    account = created!;
  }

  if (process.env.ENABLE_GOOGLE_PUSH === "true") {
    try {
      const { ensureGoogleSourceWatches } = await import("../google-push");
      await ensureGoogleSourceWatches(account.id);
    } catch (error) {
      // A watch can be retried by the daily renewal endpoint. Never make a
      // successful Google sign-in fail because Pub/Sub or Calendar is down.
      console.error("[google-push] initial watch registration failed", error instanceof Error ? error.message : String(error));
    }
  }
  return account;
}

export async function listConnectedGoogleAccounts(ownerEmailInput: string): Promise<ConnectedGoogleAccount[]> {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const rows = await getDb().select({
    id: connectedGoogleAccounts.id,
    email: connectedGoogleAccounts.email,
    name: connectedGoogleAccounts.name,
    enabled: connectedGoogleAccounts.enabled,
    createdAt: connectedGoogleAccounts.createdAt,
    reconnectRequiredAt: connectedGoogleAccounts.reconnectRequiredAt,
  }).from(connectedGoogleAccounts).where(eq(connectedGoogleAccounts.ownerEmail, ownerEmail));
  return rows.map(({ reconnectRequiredAt, ...row }) => ({ ...row, needsReconnect: Boolean(reconnectRequiredAt), connectedAt: row.createdAt.toISOString() }));
}

async function refreshConnection(row: typeof connectedGoogleAccounts.$inferSelect) {
  const refreshToken = row.encryptedRefreshToken ? decryptSecret(row.encryptedRefreshToken) : null;
  const markReconnect = async () => {
    // An older refresh must not mark newly authorized credentials as broken.
    await getDb().update(connectedGoogleAccounts).set({ reconnectRequiredAt: new Date() })
      .where(and(eq(connectedGoogleAccounts.id, row.id), eq(connectedGoogleAccounts.encryptedAccessToken, row.encryptedAccessToken), isNull(connectedGoogleAccounts.reconnectRequiredAt)));
  };
  if (!refreshToken) { await markReconnect(); return null; }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID ?? "",
      client_secret: process.env.AUTH_GOOGLE_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (googleReconnectRequired(response.status, body)) await markReconnect();
    return null;
  }
  const token = await response.json() as { access_token: string; expires_in: number; refresh_token?: string };
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  await getDb().update(connectedGoogleAccounts).set({
    encryptedAccessToken: encryptSecret(token.access_token),
    encryptedRefreshToken: token.refresh_token ? encryptSecret(token.refresh_token) : row.encryptedRefreshToken,
    accessTokenExpiresAt: expiresAt,
    reconnectRequiredAt: null,
    updatedAt: new Date(),
  }).where(and(eq(connectedGoogleAccounts.id, row.id), eq(connectedGoogleAccounts.encryptedAccessToken, row.encryptedAccessToken)));
  return token.access_token;
}

export async function getUsableGoogleConnections(ownerEmailInput: string): Promise<UsableGoogleConnection[]> {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const rows = await getDb().select().from(connectedGoogleAccounts).where(and(
    eq(connectedGoogleAccounts.ownerEmail, ownerEmail),
    eq(connectedGoogleAccounts.enabled, true),
  )).orderBy(asc(connectedGoogleAccounts.createdAt));
  const usable = (await Promise.all(rows.map(async (row) => {
    if (row.reconnectRequiredAt) return null;
    let accessToken = decryptSecret(row.encryptedAccessToken);
    if (!row.accessTokenExpiresAt || row.accessTokenExpiresAt.getTime() <= Date.now() + TOKEN_REFRESH_WINDOW_MS) {
      accessToken = await refreshConnection(row) ?? "";
    }
    if (!accessToken) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      enabled: row.enabled,
      connectedAt: row.createdAt.toISOString(),
      accessToken,
    } satisfies UsableGoogleConnection;
  }))).filter((item): item is UsableGoogleConnection => Boolean(item));

  return usable;
}

export async function getPrimaryGoogleConnectionId(ownerEmailInput: string) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const [row] = await getDb().select({ id: connectedGoogleAccounts.id }).from(connectedGoogleAccounts).where(and(
    eq(connectedGoogleAccounts.ownerEmail, ownerEmail),
    eq(connectedGoogleAccounts.enabled, true),
  )).orderBy(asc(connectedGoogleAccounts.createdAt)).limit(1);
  return row?.id ?? null;
}

/** Resolve the selected primary account and its token in one read. */
export async function getPrimaryGoogleCredentials(ownerEmailInput: string) {
  const [row] = await getDb().select().from(connectedGoogleAccounts).where(and(
    eq(connectedGoogleAccounts.ownerEmail, normalizeEmail(ownerEmailInput)),
    eq(connectedGoogleAccounts.enabled, true),
  )).orderBy(asc(connectedGoogleAccounts.createdAt)).limit(1);
  if (!row || row.reconnectRequiredAt) return null;
  const accessToken = row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_WINDOW_MS
    ? decryptSecret(row.encryptedAccessToken) : await refreshConnection(row);
  return { connectionId: row.id, accessToken };
}

export async function getGoogleConnectionAccessToken(ownerEmailInput: string, connectionId: string, options: { forceRefresh?: boolean } = {}) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const [row] = await getDb().select().from(connectedGoogleAccounts).where(and(
    eq(connectedGoogleAccounts.ownerEmail, ownerEmail),
    eq(connectedGoogleAccounts.id, connectionId),
    eq(connectedGoogleAccounts.enabled, true),
  )).limit(1);
  if (!row || row.reconnectRequiredAt) return null;
  if (!options.forceRefresh && row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_WINDOW_MS) {
    return decryptSecret(row.encryptedAccessToken);
  }
  return refreshConnection(row);
}

export async function setGoogleConnectionEnabled(ownerEmailInput: string, connectionId: string, enabled: boolean) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const [owned] = await getDb().select({ id: connectedGoogleAccounts.id }).from(connectedGoogleAccounts).where(and(
    eq(connectedGoogleAccounts.ownerEmail, ownerEmail),
    eq(connectedGoogleAccounts.id, connectionId),
  )).limit(1);
  if (!owned) return false;
  if (!enabled) {
    const { stopGoogleSourceWatches } = await import("../google-push");
    await stopGoogleSourceWatches(connectionId).catch(() => undefined);
  }
  const [updated] = await getDb().update(connectedGoogleAccounts).set({ enabled, updatedAt: new Date() }).where(and(
    eq(connectedGoogleAccounts.ownerEmail, ownerEmail),
    eq(connectedGoogleAccounts.id, connectionId),
  )).returning({ id: connectedGoogleAccounts.id });
  if (updated && enabled && process.env.ENABLE_GOOGLE_PUSH === "true") {
    const { ensureGoogleSourceWatches } = await import("../google-push");
    await ensureGoogleSourceWatches(connectionId).catch(() => undefined);
  }
  return Boolean(updated);
}

async function revokeGoogleToken(token: string | null) {
  if (!token) return false;
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    cache: "no-store",
  }).catch(() => null);
  return Boolean(response?.ok);
}

export async function removeGoogleConnection(ownerEmailInput: string, connectionId: string, options: { revoke?: boolean } = {}) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const [owned] = await getDb().select().from(connectedGoogleAccounts).where(and(
    eq(connectedGoogleAccounts.ownerEmail, ownerEmail),
    eq(connectedGoogleAccounts.id, connectionId),
  )).limit(1);
  if (!owned) return false;
  const { stopGoogleSourceWatches } = await import("../google-push");
  await stopGoogleSourceWatches(connectionId).catch(() => undefined);
  if (options.revoke !== false) {
    const refreshToken = owned.encryptedRefreshToken ? decryptSecret(owned.encryptedRefreshToken) : null;
    const accessToken = decryptSecret(owned.encryptedAccessToken);
    await revokeGoogleToken(refreshToken || accessToken).catch(() => false);
  }
  const [removed] = await getDb().delete(connectedGoogleAccounts).where(and(
    eq(connectedGoogleAccounts.ownerEmail, ownerEmail),
    eq(connectedGoogleAccounts.id, connectionId),
  )).returning({ id: connectedGoogleAccounts.id });
  return Boolean(removed);
}

export async function removeAllGoogleConnections(ownerEmailInput: string) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const rows = await getDb().select({ id: connectedGoogleAccounts.id }).from(connectedGoogleAccounts)
    .where(eq(connectedGoogleAccounts.ownerEmail, ownerEmail));
  let removed = 0;
  for (const row of rows) if (await removeGoogleConnection(ownerEmail, row.id)) removed += 1;
  return removed;
}

/** Checks old saved credentials when the app opens; temporary failures stay retryable. */
export async function checkGoogleConnectionHealth(ownerEmail: string) {
  const accounts = await listConnectedGoogleAccounts(ownerEmail);
  await Promise.allSettled(accounts.filter(account => account.enabled && !account.needsReconnect)
    .map(account => getGoogleConnectionAccessToken(ownerEmail, account.id)));
  return listConnectedGoogleAccounts(ownerEmail);
}
