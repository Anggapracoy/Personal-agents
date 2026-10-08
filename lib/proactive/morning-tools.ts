import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { getUsableGoogleConnections } from '../auth/google-connections';
import { createDiscoveryToolRegistry } from '../discovery/tools';
import type { MorningContext } from './morning-context';

export function morningAnchorRefs(context: MorningContext) {
  return new Set([...context.conversations.filter(x => x.authoredMessages===undefined?x.sourceType==='manual':x.authoredMessages.length>0).map(x => x.ref), ...context.facts.map(x => x.ref), ...context.calendar.map(x => x.ref), ...(context.opportunities??[]).filter(x=>x.due).map(x=>x.ref)]);
}

export async function createMorningTools(context: MorningContext, signal: AbortSignal) {
  const connections = await getUsableGoogleConnections(context.owner);
  const registry = createDiscoveryToolRegistry({ userId: context.owner, accessToken: connections[0]?.accessToken ?? '',
    userTimeZone: context.temporal.userTimeZone, signal,
    events: context.calendar.map(event => ({ id: event.id, summary: event.summary ?? undefined, location: event.location ?? undefined, start: event.start ?? undefined, end: event.end ?? undefined })),
  });
  const tools: ToolSet = { ...registry.tools };
  const search = registry.tools.web_search_exa;
  tools.web_search_exa = tool({
    description: search.description,
    inputSchema: (search.inputSchema as z.ZodObject).extend({personalAnchorRef:z.string().optional().describe('The exact due opportunity, user chat, confirmed fact, or calendar ref motivating this search.')}),
    execute: async (input: Record<string, unknown>, options) => { if(input.personalAnchorRef&&!morningAnchorRefs(context).has(String(input.personalAnchorRef)))return {error:'Unknown or not-due personal lead.'}; return search.execute!({ ...input, numResults: Math.min(Number(input.numResults) || 3, 3) }, options); },
  });
  // Gmail may corroborate an independently grounded lead, never supply the leads.
  for (const name of ['gmail_search_messages', 'gmail_read_message']) {
    if (!connections.length) { delete tools[name]; continue; }
    const original = registry.tools[name];
    tools[name] = anchoredMorningEmailTool(original, context, name);
  }
  if (!connections.length) delete tools.calendar_get_event;
  return { ...registry, tools };
}

export function anchoredMorningEmailTool(original: ToolSet[string], context: MorningContext, name: string) {
  return tool({
      description: `${original.description} VERIFICATION ONLY: first identify a specific chat, confirmed fact, or calendar plan. Never scan the inbox for suggestion ideas.`,
      inputSchema: (original.inputSchema as z.ZodObject).extend({ personalAnchorRef: z.string().describe('Exact non-email personal ref for the existing lead being verified.') }),
      execute: async (input: Record<string, unknown>, options) => {
        const { personalAnchorRef, ...args } = input;
        if (!morningAnchorRefs(context).has(String(personalAnchorRef))) return { error: 'A valid non-email personal lead is required before checking Gmail.' };
        // No inbox is preloaded; an explicit targeted history query is required.
        if (name === 'gmail_search_messages') args.scope = 'account_history';
        return original.execute!(args, options);
      },
    });
}

export function collectMorningUrls(value: unknown, urls: Set<string>) {
  if (typeof value === 'string' && /^https?:\/\/\S+$/.test(value)) urls.add(value);
  else if (Array.isArray(value)) value.forEach(item => collectMorningUrls(item, urls));
  else if (value && typeof value === 'object') {
    const compact = value as { truncated?: boolean; preview?: string };
    // The shared registry bounds large responses as a JSON preview. Preserve
    // explicit source URL fields from that preview, not arbitrary body links.
    if (compact.truncated && typeof compact.preview === 'string') {
      for (const match of compact.preview.matchAll(/"(?:url|sourceUrl)"\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
        try { collectMorningUrls(JSON.parse(match[1]), urls); } catch { /* incomplete preview field */ }
      }
    }
    Object.values(value).forEach(item => collectMorningUrls(item, urls));
  }
}
