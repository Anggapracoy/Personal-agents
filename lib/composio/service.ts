import { Composio } from "@composio/core";
import { createHash } from "node:crypto";
import postgres from "postgres";

// One policy for catalog visibility, agent discovery, connection cards and execution.
const BUILT_IN_GOOGLE_CONNECTORS = new Set(["gmail", "googlecalendar", "google_calendar", "googlesuper"]);
const HIDDEN_CONNECTORS = new Set([
  "exa", "composio", "composio_search",
  "aweber",
  "azure_monitor_activity_log",
  "blackboard",
  "box_mcp",
  "buffer",
  "clio_manage",
  "clover",
  "constant_contact",
  "contacts_plus",
  "coupa",
  "cradl_ai",
  "d2lbrightspace",
  "docusign",
  "dribbble",
  "egnyte",
  "epic_games",
  "gagelist",
  "google_admin",
  "google_chat",
  "google_data_studio",
  "googlecontacts",
  "googleforms",
  "gusto",
  "help_scout",
  "highlevel",
  "jobber",
  "kintone_rest",
  "kommo",
  "lightspeed",
  "linkedin_ads",
  "microsoft_power_bi",
  "microsoft_todo",
  "netsuite",
  "onenote",
  "paypal",
  "personio",
  "railway_mcp",
  "ramp",
  "reloadly",
  "salesforce_service_cloud",
  "sap_successfactors",
  "sharepoint_graph",
  "shopify",
  "spotify",
  "tiktok",
  "snapchat",
  "snowflake",
  "soundcloud",
  "vimeo",
  "wild_apricot",
  "wordpress_com",
  "workday",
  "xero",
  "zoom_chat",
  "zoominfo",
]);
export const isAdditionalConnector = (slug: string) => !BUILT_IN_GOOGLE_CONNECTORS.has(slug.toLowerCase()) && !HIDDEN_CONNECTORS.has(slug.toLowerCase());
export function requireAdditionalConnector(slug: string) {
  const normalized = slug.toLowerCase();
  if (normalized === "exa") throw new Error("Use Dash’s built-in web_search_exa and web_fetch_exa tools; no extra connection is needed.");
  if (BUILT_IN_GOOGLE_CONNECTORS.has(normalized)) throw new Error("Use Dash’s existing Google connection and Gmail/Calendar tools. For other Google services, choose their individual connector.");
  if (HIDDEN_CONNECTORS.has(normalized)) throw new Error("This connector is not available in Dash. Do not offer a connection for it.");
}

export class ConnectorSetupRequiredError extends Error {
  constructor(name: string) {
    super(`${name} isn’t available to connect in Dash yet.`);
    this.name = "ConnectorSetupRequiredError";
  }
}

export async function requireConnectorAuthSetup(slug: string, name: string, client = composioClient()) {
  const toolkit = await client.toolkits.get(slug);
  if (toolkit.composioManagedAuthSchemes?.length) return;
  // API-key and other user-supplied auth can use the hosted form when no
  // application-level credentials are required.
  if (toolkit.authConfigDetails?.some(auth => auth.fields.authConfigCreation.required.every(field => field.default !== undefined && field.default !== null && field.default !== ""))) return;
  const configs = await client.authConfigs.list({ toolkit: slug, showDisabled: false });
  if (configs.items.some(config => config.status === "ENABLED" && config.isEnabledForToolRouter !== false)) return;
  throw new ConnectorSetupRequiredError(name);
}

export function connectorFailureMessage(error: unknown, fallback: string) {
  return error instanceof ConnectorSetupRequiredError ? error.message : fallback;
}

let client: Composio | undefined;
let sql: ReturnType<typeof postgres> | undefined;
export const composioConfigured = () => Boolean(process.env.COMPOSIO_API_KEY);
export function composioClient() {
  if (!composioConfigured()) throw new Error("More connectors are not available yet.");
  return client ??= new Composio({ apiKey: process.env.COMPOSIO_API_KEY, allowTracking: false, disableVersionCheck: true });
}
const database = () => {
  if (!process.env.DATABASE_URL) throw new Error("Connector storage is unavailable.");
  return sql ??= postgres(process.env.DATABASE_URL, { prepare: false, max: 3, idle_timeout: 20 });
};
export const connectorUserId = (email: string) => `dash_${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;
const owner = (email: string) => email.trim().toLowerCase();
const pending = new Map<string, Promise<Awaited<ReturnType<Composio["use"]>> >>();
export async function connectorSession(email: string) {
  const key = owner(email);
  if (pending.has(key)) return pending.get(key)!;
  const load = (async () => {
    const db = database();
    const [row] = await db`select session_id from composio_sessions where owner_email=${key}`;
    if (row) return composioClient().use(row.session_id);
    const session = await composioClient().create(connectorUserId(key), { manageConnections: false, sandbox: { enable: false } });
    const [saved] = await db`insert into composio_sessions(owner_email,session_id) values(${key},${session.sessionId}) on conflict(owner_email) do update set owner_email=excluded.owner_email returning session_id`;
    return saved.session_id === session.sessionId ? session : composioClient().use(saved.session_id);
  })();
  pending.set(key, load);
  try { return await load; } finally { pending.delete(key); }
}
export async function enabledPublicToolkits(email: string): Promise<string[]> {
  const [row] = await database()`select enabled_toolkits from composio_sessions where owner_email=${owner(email)}`;
  return Array.isArray(row?.enabled_toolkits) ? row.enabled_toolkits : [];
}
export async function setPublicToolkit(email: string, slug: string, enabled: boolean) {
  const db = database();
  await db`update composio_sessions set enabled_toolkits=(select coalesce(jsonb_agg(distinct value),'[]'::jsonb) from jsonb_array_elements_text(enabled_toolkits || ${db.json(enabled ? [slug] : [])}) value where ${enabled} or value <> ${slug}) where owner_email=${owner(email)}`;
}
export async function ownedAccounts(email: string, options: { signal?: AbortSignal } = {}) {
  const items = [];
  let cursor: string | undefined;
  do {
    const page = await composioClient().connectedAccounts.list({ userIds: [connectorUserId(email)], limit: 100, cursor }, options);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}
export type ConnectorItem = { slug: string; name: string; logo?: string; noAuth: boolean; connected: boolean; accounts: Array<{ id: string; status: string; label: string }> };
export function connectorSearchQuery(search: string) {
  const query = search.trim();
  return query.toLowerCase() === "x" ? "twitter" : query;
}
/** Keep real identified accounts; anonymous expired attempts aren't extra accounts. */
export function visibleConnectorAccounts<T extends { status: string; isDisabled?: boolean; alias?: string | null; state?: { val?: unknown } }>(accounts: T[]): T[] {
  const identified = (account: T) => {
    const value = account.state?.val;
    const displayName = value && typeof value === "object" ? (value as Record<string, unknown>).displayName : undefined;
    return Boolean(account.alias || (typeof displayName === "string" && displayName.trim()));
  };
  const hasActive = accounts.some(account => account.status === "ACTIVE" && !account.isDisabled);
  let anonymousExpiredKept = false;
  let pendingKept = false;
  return accounts.filter(account => {
    if (account.status === "ACTIVE" || identified(account)) return true;
    if (account.status === "INITIATED" && !pendingKept) { pendingKept = true; return true; }
    if (account.status === "EXPIRED" && !hasActive && !anonymousExpiredKept) { anonymousExpiredKept = true; return true; }
    return false;
  });
}
export async function listConnectors(email: string, search = "", cursor?: string) {
  search = connectorSearchQuery(search);
  if (search.length > 0 && search.length < 3) return { connectedCount: 0, items: [], cursor: null, shortSearch: true };
  const session = await connectorSession(email);
  const [page, accounts, enabled] = await Promise.all([session.toolkits({ search: search || undefined, cursor, limit: 40 }), ownedAccounts(email), enabledPublicToolkits(email)]);
  const catalog = [...page.items];
  if (!search && !cursor) {
    const connectedSlugs = [...new Set([...enabled, ...accounts.filter(account => account.status === "ACTIVE" && !account.isDisabled).map(account => account.toolkit.slug)])].filter(isAdditionalConnector);
    const missing = connectedSlugs.filter(slug => !catalog.some(item => item.slug === slug));
    for (let start = 0; start < missing.length; start += 50) {
      const connected = await session.toolkits({ toolkits: missing.slice(start, start + 50), limit: 50 });
      catalog.unshift(...connected.items);
    }
  }
  return { connectedCount: new Set([...enabled.filter(isAdditionalConnector), ...accounts.filter(a => isAdditionalConnector(a.toolkit.slug) && a.status === "ACTIVE" && !a.isDisabled).map(a => a.toolkit.slug)]).size, items: catalog.filter(item => isAdditionalConnector(item.slug)).map(item => ({ slug: item.slug, name: item.name, logo: item.logo, noAuth: item.isNoAuth,
    connected: enabled.includes(item.slug) || accounts.some(a => a.toolkit.slug === item.slug && a.status === "ACTIVE" && !a.isDisabled),
    accounts: visibleConnectorAccounts(accounts.filter(a => a.toolkit.slug === item.slug)).map(a => ({ id: a.id, status: a.isDisabled ? "DISABLED" : a.status, label: a.alias || (typeof a.state?.val?.displayName === "string" ? a.state.val.displayName : "Connected account") })),
  } satisfies ConnectorItem)), cursor: page.cursor ?? null };
}
export async function connectToolkit(email: string, slug: string, callbackUrl: string) {
  requireAdditionalConnector(slug);
  const session = await connectorSession(email);
  const catalog = await session.toolkits({ toolkits: [slug] });
  const item = catalog.items.find(item => item.slug === slug);
  if (!item) throw new Error("That connector could not be found.");
  if (item.isNoAuth) { await setPublicToolkit(email, slug, true); return { connected: true }; }
  await requireConnectorAuthSetup(slug, item.name);
  let connection;
  try { connection = await session.authorize(slug, { callbackUrl }); }
  catch (error) {
    if (error instanceof Error && error.message.includes("ToolRouterV2_NoManagedAuth")) throw new ConnectorSetupRequiredError(item.name);
    throw error;
  }
  if (!connection.redirectUrl) throw new Error("This connector could not start sign-in.");
  const url = new URL(connection.redirectUrl);
  if (url.protocol !== "https:" || !(url.hostname === "composio.dev" || url.hostname.endsWith(".composio.dev"))) throw new Error("Unexpected connector sign-in address.");
  return { url: url.href };
}
export async function disconnectToolkit(email: string, slug: string, accountId?: string) {
  if (accountId) {
    const owned = (await ownedAccounts(email)).find(a => a.id === accountId && a.toolkit.slug === slug);
    if (!owned) throw new Error("Connection not found.");
    await composioClient().connectedAccounts.delete(owned.id);
  } else await setPublicToolkit(email, slug, false);
}
export async function usableConnectors(email: string) {
  const [accounts, enabled] = await Promise.all([ownedAccounts(email), enabledPublicToolkits(email)]);
  return { accounts: accounts.filter(a => isAdditionalConnector(a.toolkit.slug) && a.status === "ACTIVE" && !a.isDisabled), enabled: enabled.filter(isAdditionalConnector) };
}

export async function removeAllConnectorAccounts(email: string) {
  if (!composioConfigured()) return;
  for (const account of await ownedAccounts(email)) await composioClient().connectedAccounts.delete(account.id);
  if (process.env.DATABASE_URL) {
    const db = database();
    const [row] = await db`select session_id,runtime_session_id from composio_sessions where owner_email=${owner(email)}`;
    for (const id of [row?.session_id, row?.runtime_session_id].filter(Boolean)) {
      try { await composioClient().sessions.delete(id); }
      catch (error) { if (!(error && typeof error === "object" && "status" in error && error.status === 404)) throw error; }
    }
    await db`delete from composio_sessions where owner_email=${owner(email)}`;
  }
}

export async function connectorRuntimeSession(email: string, access: Awaited<ReturnType<typeof usableConnectors>>) {
  const db = database();
  const toolkits = [...new Set([...access.accounts.map(a => a.toolkit.slug), ...access.enabled])].sort();
  const connectedAccounts: Record<string, string[]> = {};
  for (const account of access.accounts) (connectedAccounts[account.toolkit.slug] ??= []).push(account.id);
  for (const ids of Object.values(connectedAccounts)) ids.sort();
  const fingerprint = JSON.stringify({ toolkits, connectedAccounts });
  return db.begin(async transaction => {
    const [row] = await transaction`select runtime_session_id,runtime_fingerprint from composio_sessions where owner_email=${owner(email)} for update`;
    if (!row) throw new Error("Connector session not initialized.");
    const config = { toolkits, connectedAccounts, manageConnections: false, sandbox: { enable: false }, multiAccount: { enable: true } };
    if (row.runtime_session_id) {
      const session = await composioClient().use(row.runtime_session_id);
      if (row.runtime_fingerprint !== fingerprint) {
        await session.update(config);
        await transaction`update composio_sessions set runtime_fingerprint=${fingerprint} where owner_email=${owner(email)}`;
      }
      return session;
    }
    const session = await composioClient().create(connectorUserId(email), config);
    await transaction`update composio_sessions set runtime_session_id=${session.sessionId},runtime_fingerprint=${fingerprint} where owner_email=${owner(email)}`;
    return session;
  });
}

export async function connectorDetails(email: string, slug: string) {
  if (!/^[a-z0-9_-]{1,100}$/.test(slug) || ["composio", "composio_search"].includes(slug)) throw new Error("Choose an app connector.");
  requireAdditionalConnector(slug);
  const session = await connectorSession(email);
  const page = await session.toolkits({ toolkits: [slug] });
  const item = page.items.find(item => item.slug === slug);
  if (!item) throw new Error("App connector not found. Use its catalog slug, such as notion.");
  if (!item.isNoAuth) await requireConnectorAuthSetup(slug, item.name);
  return { slug: item.slug, name: item.name, logo: item.logo, noAuth: item.isNoAuth };
}
export async function isConnectorConnected(email: string, slug: string) {
  const access = await usableConnectors(email);
  return access.enabled.includes(slug) || access.accounts.some(account => account.toolkit.slug === slug);
}
