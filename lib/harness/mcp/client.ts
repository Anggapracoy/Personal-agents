import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { classifyToolRisk, executeGuardedAction } from "../actions";
import type { RunStore } from "../types";
import { isAlwaysApproved, sensitiveApprovalCategoryForAction } from "../../approval-preferences";
import { composioConfigured, composioClient, connectorSession, connectorRuntimeSession, usableConnectors, connectorDetails, isConnectorConnected, requireAdditionalConnector, isAdditionalConnector } from "../../composio/service";

export function assertConnectorTool(slug: string) {
  if (!/^[A-Z][A-Z0-9_]{1,199}$/.test(slug) || slug.startsWith("COMPOSIO_")) throw new Error("Choose an app tool returned by connector_search. Meta tools and remote code execution are not available.");
}

/** Discover lazily and guard each concrete app action, rather than a meta-tool batch. */
export async function loadMcpTools(input: { runId: string; userId: string; stepId: string; store: RunStore; signal?: AbortSignal }, dependencies = { composioConfigured, composioClient, connectorSession, connectorRuntimeSession, usableConnectors, connectorDetails, isConnectorConnected }) {
  const { composioConfigured, composioClient, connectorSession, connectorRuntimeSession, usableConnectors, connectorDetails, isConnectorConnected } = dependencies;
  if (!composioConfigured()) return { tools: {} as ToolSet, unavailable: [] as string[], close: async () => undefined };
  const allowed = async () => {
    await connectorSession(input.userId);
    const available = await usableConnectors(input.userId);
    const connected = { accounts: available.accounts.filter(a => isAdditionalConnector(a.toolkit.slug)), enabled: available.enabled.filter(isAdditionalConnector) };
    return { ...connected, slugs: [...new Set([...connected.accounts.map(a => a.toolkit.slug), ...connected.enabled])] };
  };
  const schema = async (slug: string) => {
    assertConnectorTool(slug);
    const access = await allowed();
    const definition = await composioClient().tools.getRawComposioToolBySlug(slug, undefined, { signal: input.signal });
    if (definition.toolkit?.slug) requireAdditionalConnector(definition.toolkit.slug);
    if (!definition.toolkit?.slug || !access.slugs.includes(definition.toolkit.slug)) throw new Error("This app is not connected. Use connector_request_connection to offer an inline Connect card.");
    return { definition, access };
  };
  const tools: ToolSet = {
    connector_request_connection: tool({
      description: "Offer an inline Connect card for an app the user wants to use but has not connected. Never use this tool for Gmail, Google Calendar, Google Super, or Exa: use Dash’s built-in Google connection/tools or web search tools instead. Use the app's catalog slug (for example notion) and a short task-specific reason. The user signs in securely; the server verifies the connection and resumes you automatically. Never request credentials in chat or send the user to Settings when this card can connect the app. Make this the only tool call in the turn, then stop and wait. Do not request a connection after the user declines it. If the connector reports that Dash must finish setup, explain that it is unavailable and offer browser access when appropriate; do not retry or ask the user for developer credentials.",
      inputSchema: z.object({ toolkit: z.string().regex(/^[a-z0-9_-]{1,100}$/), reason: z.string().min(1).max(300) }),
      execute: async ({ toolkit, reason }, options) => {
        requireAdditionalConnector(toolkit);
        const app = await connectorDetails(input.userId, toolkit);
        if (await isConnectorConnected(input.userId, app.slug)) return { connected: true, toolkit: app.slug };
        return executeGuardedAction({ ...input, toolName: "connector_request_connection", risk: "write_external", preview: `Connect ${app.name}\n${reason}`, args: { toolkit: app.slug, name: app.name, ...(app.logo ? { logo: app.logo } : {}), reason }, signal: options.abortSignal ?? input.signal,
          execute: async () => {
            if (!await isConnectorConnected(input.userId, app.slug)) throw new Error("The app is not connected yet.");
            return { connected: true, toolkit: app.slug };
          },
        });
      },
    }),
    connector_search: tool({
      description: "Find actions in the user's connected apps. Search by the task you need to perform. Returns the current tool names and input schemas; use connector_schema for a full schema if needed, then connector_execute. If the needed app is missing, use connector_request_connection to offer an inline Connect card. Gmail and Google Calendar are excluded: use Dash’s existing Google connection and dedicated tools. Connections are optional. Never request passwords or API keys in chat. Use the existing Gmail and Calendar tools for those services when available.",
      inputSchema: z.object({ query: z.string().min(1).max(1000) }),
      execute: async ({ query }) => {
        const access = await allowed();
        if (!access.slugs.length) return { connectedApps: [], message: "No additional apps connected. For Gmail/Google Calendar use Dash’s built-in Google tools and reconnect flow; for Exa use built-in web search. For other supported apps use connector_request_connection." };
        const session = await connectorRuntimeSession(input.userId, access);
        const result = await session.search({ query, toolkits: access.slugs });
        // Provider execution/workbench guidance is not part of Dash's tool contract.
        const toolSchemas = Object.fromEntries(Object.entries(result.toolSchemas).filter(([slug, schema]) => !slug.startsWith("COMPOSIO_") && access.slugs.includes(schema.toolkit.toLowerCase())).map(([slug, schema]) => [slug, { toolSlug: slug, description: schema.description, inputSchema: schema.inputSchema, needsFullSchema: !schema.hasFullSchema }]));
        return { connectedApps: access.slugs, toolSchemas, ...(Object.keys(toolSchemas).length ? {} : { message: "No matching actions found in the connected apps. Try a more specific search." }) };
      },
    }),
    connector_schema: tool({
      description: "Read the full input schema of a connected app tool before executing it. Tool names must come from connector_search.",
      inputSchema: z.object({ toolSlug: z.string().min(1).max(200) }),
      execute: async ({ toolSlug }) => {
        const { definition } = await schema(toolSlug);
        return { toolSlug: definition.slug, description: definition.description, inputSchema: definition.inputParameters };
      },
    }),
    connector_execute: tool({
      description: "Execute one discovered app action using its exact schema. Sends, purchases, deletions and other consequential writes use Dash's normal approval flow. Never claim success when an action needs approval or reports an error. Do not retry a possibly completed write without checking its outcome.",
      inputSchema: z.object({ toolSlug: z.string().min(1).max(200), arguments: z.record(z.string(), z.unknown()), accountId: z.string().optional() }),
      execute: async ({ toolSlug, arguments: args, accountId }, options) => {
        const { definition, access } = await schema(toolSlug);
        const accounts = access.accounts.filter(a => a.toolkit.slug === definition.toolkit!.slug);
        if (accountId && !accounts.some(a => a.id === accountId)) throw new Error("That account is not connected for this user and app.");
        if (!accountId && accounts.length > 1) return { needsAccountSelection: true, accounts: accounts.map(a => ({ id: a.id, label: a.alias || "Connected account" })) };
        const account = accountId ?? accounts[0]?.id;
        const toolName = `composio__${toolSlug}`;
        const risk = classifyToolRisk(toolName);
        const category = sensitiveApprovalCategoryForAction(toolName, args);
        return executeGuardedAction({ ...input, toolName, risk,
          alwaysApproved: category ? await isAlwaysApproved(input.userId, category) : false,
          preview: `${definition.name}\n${JSON.stringify(args, null, 2)}`,
          args: { toolSlug, arguments: args, ...(account ? { accountId: account } : {}) }, signal: options.abortSignal ?? input.signal,
          execute: async stored => {
            // Recheck access on resume: a disconnected account cannot be revived by approval.
            const current = await usableConnectors(input.userId);
            if (account ? !current.accounts.some(a => a.id === account) : !current.enabled.includes(definition.toolkit!.slug)) throw new Error("This app was disconnected. Reconnect it in Settings before continuing.");
            const session = await connectorRuntimeSession(input.userId, current);
            const result = await session.execute(toolSlug, stored.arguments as Record<string, unknown>, account ? { account } : undefined);
            if (result.error) throw new Error("The connected app could not complete this action. Check its outcome before retrying.");
            return { data: result.data };
          },
        });
      },
    }),
  };
  return { tools, unavailable: [] as string[], close: async () => undefined };
}
