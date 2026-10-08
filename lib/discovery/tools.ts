import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { exaAnswer, exaSearch, exaFetch, exaSearchSchema, exaFetchSchema } from "../exa";
import type { DecisionEmailInput } from "../agent";
import { fetchGmailMessage, type GoogleEvent } from "../google";
import { getCloudBrowser } from "../harness/browser/registry";
import { E2BSandboxProvider } from "../harness/sandbox/e2b";
import type { DiscoveryAuditEntry } from "./types";
import { getDiscoveryCache, setDiscoveryCache } from "./cache";
import { createTemporalContext } from "../temporal";

type ResearchLane = "google" | "public" | "browser" | "sandbox";

function createSemaphore(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = async () => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
      waiting.shift()?.();
    };
  };
  return {
    acquire,
    async run<T>(operation: () => Promise<T>): Promise<T> {
      const release = await acquire();
      try { return await operation(); } finally { release(); }
    },
  };
}

export type DiscoveryResearchContext = {
  cache: Map<string, Promise<unknown>>;
  schedule: Record<ResearchLane, <T>(operation: () => Promise<T>) => Promise<T>>;
  acquireBrowser: () => Promise<() => void>;
  searchRecentEmails: (query: string, maxResults: number) => DecisionEmailInput[];
  browserWarmup: Promise<void>;
  evidenceVersion: string;
};

function recentEmailSearch(emails: DecisionEmailInput[], query: string, maxResults: number) {
  const normalized = query.toLowerCase();
  const from = normalized.match(/from:\s*\(?["']?([^\s)"']+)/)?.[1];
  const subject = normalized.match(/subject:\s*\(?["']?([^\s)"']+)/)?.[1];
  const ignored = new Set(["from", "to", "subject", "in", "label", "newer_than", "older_than", "after", "before", "has", "is", "or"]);
  const terms = normalized
    .replace(/\b(?:from|to|subject|in|label|newer_than|older_than|after|before|has|is):[^\s)]+/g, " ")
    .match(/[a-z0-9][a-z0-9._@-]{2,}/g)?.filter((term) => !ignored.has(term)) ?? [];
  return emails.map((email, index) => {
    const sender = email.from.toLowerCase();
    const title = email.subject.toLowerCase();
    const haystack = `${sender}\n${email.to}\n${title}\n${email.snippet}\n${email.body}`.toLowerCase();
    let score = 0;
    if (from) score += sender.includes(from) ? 20 : -100;
    if (subject) score += title.includes(subject) ? 15 : -100;
    for (const term of terms) if (haystack.includes(term)) score += title.includes(term) || sender.includes(term) ? 5 : 1;
    return { email, score, index };
  }).filter((match) => match.score > 0 || (terms.length === 0 && !from && !subject))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxResults)
    .map((match) => match.email);
}

function emailSearchResult(email: DecisionEmailInput) {
  return {
    id: email.id,
    threadId: email.threadId,
    subject: email.subject,
    from: email.from,
    to: email.to,
    date: email.date,
    snippet: email.snippet.slice(0, 600),
    labels: email.labels,
    links: email.links.slice(0, 8),
    confirmationNumbers: email.confirmationNumbers,
  };
}

export function createDiscoveryResearchContext(input: { userId?: string; emails?: DecisionEmailInput[]; warmBrowser?: boolean } = {}): DiscoveryResearchContext {
  const google = createSemaphore(4);
  const publicWeb = createSemaphore(4);
  const browser = createSemaphore(1);
  const sandbox = createSemaphore(3);
  const recentEmails = input.emails ?? [];
  const evidenceVersion = recentEmails.map((email) => `${email.id}:${email.date}`).sort().join("|");
  const browserWarmup = input.userId && input.warmBrowser
    ? getCloudBrowser(input.userId).warm(input.userId).catch((error) => {
      console.warn("[decision-discovery] cloud browser warmup failed", { error: error instanceof Error ? error.message : String(error) });
    })
    : Promise.resolve();
  return {
    cache: new Map(),
    schedule: {
      // These are scan-wide limits. They let independent candidates overlap
      // without turning one 150-message refresh into an API or sandbox burst.
      google: (operation) => google.run(operation),
      public: (operation) => publicWeb.run(operation),
      browser: (operation) => browser.run(operation),
      sandbox: (operation) => sandbox.run(operation),
    },
    acquireBrowser: browser.acquire,
    searchRecentEmails: (query, maxResults) => recentEmailSearch(recentEmails, query, maxResults),
    browserWarmup,
    evidenceVersion,
  };
}

function encoded(value: string) { return encodeURIComponent(value); }

function publicUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Discovery only reads public HTTPS URLs");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) throw new Error("Private network targets are blocked");
  return url;
}

function compact(value: unknown, limit = 50_000): unknown {
  if (typeof value === "string") return value.slice(0, limit);
  const serialized = JSON.stringify(value);
  if (serialized.length <= limit) return value;
  return { truncated: true, preview: serialized.slice(0, limit) };
}

async function googleApi<T>(accessToken: string, url: string, signal?: AbortSignal) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store", signal });
  const payload = await response.json().catch(() => null) as T | { error?: { message?: string } } | null;
  if (!response.ok) throw new Error((payload as { error?: { message?: string } } | null)?.error?.message ?? `Google API request failed (${response.status}).`);
  return payload as T;
}

function eventText(event: GoogleEvent) {
  return `${event.summary ?? ""} ${event.description ?? ""} ${event.location ?? ""}`.toLowerCase();
}

export function createDiscoveryToolRegistry(input: {
  userId: string;
  accessToken: string;
  emailReader?: (id: string) => Promise<DecisionEmailInput>;
  emailSearcher?: (query: string, limit: number) => Promise<DecisionEmailInput[]>;
  events: GoogleEvent[];
  userTimeZone?: unknown;
  signal?: AbortSignal;
  context?: DiscoveryResearchContext;
}) {
  const audit: DiscoveryAuditEntry[] = [];
  const browser = getCloudBrowser(input.userId);
  const sandbox = new E2BSandboxProvider();
  let sandboxCreated = false;
  let toolCallCount = 0;
  let gmailSearchCount = 0;
  const context = input.context ?? createDiscoveryResearchContext();
  let releaseBrowserSession: (() => void) | undefined;

  const runInBrowserSession = async <T>(operation: () => Promise<T>) => {
    // The browser profile is persistent and stateful. Hold the scan-wide lease
    // for this candidate's entire browser session so another concurrent agent
    // cannot replace its page between open/inspect/follow calls.
    releaseBrowserSession ??= await context.acquireBrowser();
    return operation();
  };

  const run = async <T>(name: string, args: Record<string, unknown>, operation: () => Promise<T>, options: { lane?: ResearchLane; cache?: boolean; durableTtlMs?: number; durableVersion?: string } = {}): Promise<unknown> => {
    const callNumber = ++toolCallCount;
    if (callNumber > 12) {
      const message = "Discovery research tool budget reached (12 calls). Synthesize the evidence already collected.";
      audit.push({ tool: name, input: args, result: { error: message }, ok: false });
      console.warn("[decision-discovery] tool blocked", { tool: name, callNumber, error: message });
      throw new Error(message);
    }
    const startedAt = Date.now();
    console.info("[decision-discovery] tool start", { tool: name, callNumber, inputKeys: Object.keys(args) });
    try {
      const execute = async () => {
        const durableKey = `${options.durableVersion ?? ""}:${JSON.stringify(args)}`;
        if (options.durableTtlMs) {
          const durable = await getDiscoveryCache<unknown>(input.userId, `tool:${name}`, durableKey);
          if (durable !== null) return durable;
        }
        const result = options.lane === "browser"
          ? await runInBrowserSession(operation)
          : options.lane
            ? await context.schedule[options.lane](operation)
            : await operation();
        // Tool results are fed back into the research model on every step. Returning
        // an 80k Gmail body or DOM snapshot repeatedly can exhaust a provider's
        // context/TPM before the model can synthesize a verdict.
        const modelResult = compact(result, 6_000);
        if (options.durableTtlMs) await setDiscoveryCache(input.userId, `tool:${name}`, durableKey, modelResult, options.durableTtlMs);
        return modelResult;
      };
      const cacheKey = options.cache ? `${name}:${JSON.stringify(args)}` : "";
      let pending = cacheKey ? context.cache.get(cacheKey) : undefined;
      const cacheHit = Boolean(pending);
      if (!pending) {
        pending = execute();
        if (cacheKey) {
          context.cache.set(cacheKey, pending);
          pending.catch(() => context.cache.delete(cacheKey));
        }
      }
      const modelResult = await pending;
      audit.push({ tool: name, input: args, result: modelResult, ok: true });
      console.info("[decision-discovery] tool complete", { tool: name, ok: true, cacheHit, durationMs: Date.now() - startedAt });
      return modelResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      audit.push({ tool: name, input: args, result: { error: message }, ok: false });
      console.warn("[decision-discovery] tool complete", { tool: name, ok: false, durationMs: Date.now() - startedAt, error: message });
      throw error;
    }
  };

  const tools: ToolSet = {
    check_current_time: tool({
      description: "Return the authoritative current server time in UTC and in the user's saved timezone. Read-only. Use when deciding whether a deadline, booking, event, offer, or relative date is still actionable; never infer the current time from message timestamps.",
      inputSchema: z.object({}),
      execute: async () => run("check_current_time", {}, async () => createTemporalContext(input.userTimeZone)),
    }),
    web_search_exa: tool({
      description: "Find public web sources with excerpts and URLs so you can compare evidence and form your own answer. Use exa_answer when a quick synthesized answer is enough. Read-only.",
      inputSchema: exaSearchSchema,
      execute: async (args, options) => run("web_search_exa", args, () => exaSearch({ ...args, signal: options.abortSignal ?? input.signal }), { lane: "public" }),
    }),
    web_fetch_exa: tool({
      description: "Read specific public webpages without opening a browser. Returns up to 20,000 characters per page and per-page status; missing or failed content is not evidence. Use the browser for interactive or signed-in pages and actions. Read-only.",
      inputSchema: exaFetchSchema,
      execute: async (args, options) => run("web_fetch_exa", args, () => exaFetch({ ...args, signal: options.abortSignal ?? input.signal }), { lane: "public" }),
    }),
    exa_answer: tool({
      description: "Search the current public web with Exa and return a synthesized answer with HTTPS citations. Use for broad current research, then verify consequential or exact claims against direct sources. Personal account facts still require Gmail, Calendar, or an authenticated browser page. Read-only.",
      inputSchema: z.object({
        query: z.string().min(1).max(2_000),
        includeText: z.boolean().default(false),
      }),
      execute: async ({ query, includeText }, options) => run("exa_answer", { query, includeText }, () => exaAnswer({ query, includeText, signal: options.abortSignal ?? input.signal }), { lane: "public", cache: true, durableTtlMs: 6 * 60 * 60 * 1_000 }),
    }),
    gmail_search_messages: tool({
      description: "Search Gmail evidence. Start with scope=recent_scan, which searches the shared 150-message scan index instantly without another Gmail request. Escalate to scope=account_history only when a longer usage/purchase history is genuinely necessary. Read-only.",
      inputSchema: z.object({ query: z.string().min(1).max(500), maxResults: z.number().int().min(1).max(25).default(10), scope: z.enum(["recent_scan", "account_history"]).default("recent_scan") }),
      execute: async ({ query, maxResults, scope }, options) => run("gmail_search_messages", { query, maxResults, scope }, async () => {
        gmailSearchCount += 1;
        if (gmailSearchCount > 3) return { query, scope, count: 0, messages: [], source: "search_budget", note: "Three targeted Gmail searches were already completed. Synthesize the collected evidence or read a returned message." };
        const recentMatches = context.searchRecentEmails(query, maxResults);
        if (scope === "recent_scan") return { query, scope, count: recentMatches.length, messages: recentMatches.map(emailSearchResult), source: "shared_recent_email_index" };
        if (input.emailSearcher) { const messages = await input.emailSearcher(query, maxResults); return { query, scope, count: messages.length, messages: messages.map(emailSearchResult), source: "connected_mail_history" }; }
        const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
        const list = await googleApi<{ messages?: Array<{ id: string }> }>(input.accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, options.abortSignal ?? input.signal);
        const ids = (list.messages ?? []).slice(0, maxResults);
        const messages = new Array<Awaited<ReturnType<typeof fetchGmailMessage>>>(ids.length);
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(3, ids.length) }, async () => {
          while (next < ids.length) {
            const index = next++;
            messages[index] = await fetchGmailMessage(input.accessToken, ids[index]!.id);
          }
        }));
        return { query, scope, count: messages.length, messages: messages.map(emailSearchResult), recentMatchCount: recentMatches.length, source: "gmail_account_history" };
      }, { lane: "google", cache: true, durableTtlMs: scope === "recent_scan" ? 30 * 60 * 1_000 : 15 * 60 * 1_000, durableVersion: scope === "recent_scan" ? context.evidenceVersion : "account-history" }),
    }),
    gmail_read_message: tool({
      description: "Read one complete connected Gmail message by its stable message ID. Read-only.",
      inputSchema: z.object({ messageId: z.string().min(1).max(300) }),
      execute: async ({ messageId }) => run<DecisionEmailInput>("gmail_read_message", { messageId }, () => input.emailReader ? input.emailReader(messageId) : fetchGmailMessage(input.accessToken, messageId), { lane: "google", cache: true }),
    }),
    calendar_search_events: tool({
      description: "Search the user's supplied upcoming Calendar events for plans, conflicts, trips, and relevant commitments. Read-only.",
      inputSchema: z.object({ query: z.string().max(200).default(""), maxResults: z.number().int().min(1).max(100).default(30) }),
      execute: async ({ query, maxResults }) => run("calendar_search_events", { query, maxResults }, async () => {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        const events = input.events.filter((event) => terms.length === 0 || terms.every((term) => eventText(event).includes(term))).slice(0, maxResults);
        return { count: events.length, events };
      }, { cache: true }),
    }),
    calendar_get_event: tool({
      description: "Read one connected Google Calendar event by ID. Read-only.",
      inputSchema: z.object({ eventId: z.string().min(1).max(1024) }),
      execute: async ({ eventId }, options) => run("calendar_get_event", { eventId }, () => googleApi<Record<string, unknown>>(input.accessToken, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encoded(eventId)}`, options.abortSignal ?? input.signal), { lane: "google", cache: true }),
    }),
    weather_lookup: tool({
      description: "Look up a public weather forecast for a named place and date. Forecasts beyond the provider horizon are reported as unavailable; never treat unavailable weather as evidence.",
      inputSchema: z.object({ location: z.string().min(2).max(200), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
      execute: async ({ location, date }, options) => run("weather_lookup", { location, date }, async () => {
        const geocode = await fetch(publicUrl(`https://geocoding-api.open-meteo.com/v1/search?name=${encoded(location)}&count=1&language=en&format=json`), { signal: options.abortSignal ?? input.signal }).then((response) => response.json()) as { results?: Array<{ name: string; latitude: number; longitude: number; country?: string; admin1?: string }> };
        const place = geocode.results?.[0];
        if (!place) return { available: false, reason: "Location was not found" };
        const url = publicUrl(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&daily=weather_code,precipitation_probability_max,precipitation_sum,wind_speed_10m_max&timezone=auto&start_date=${date}&end_date=${date}`);
        const response = await fetch(url, { signal: options.abortSignal ?? input.signal });
        if (!response.ok) return { available: false, reason: `Forecast unavailable (${response.status})`, sourceUrl: url.toString() };
        const forecast = await response.json() as Record<string, unknown>;
        return { available: true, place, forecast, sourceUrl: url.toString() };
      }, { lane: "public", cache: true }),
    }),
    api_fetch: tool({
      description: "Read public JSON or text from an HTTPS URL. Use direct source pages and APIs for terms, policies, prices, forecasts, and eligibility. Read-only.",
      inputSchema: z.object({ url: z.url() }),
      execute: async ({ url }, options) => run("api_fetch", { url }, async () => {
        const safe = publicUrl(url);
        const response = await fetch(safe, { headers: { "user-agent": "DecisionFeedDiscovery/1.0" }, signal: options.abortSignal ?? input.signal });
        return { status: response.status, ok: response.ok, url: response.url, contentType: response.headers.get("content-type"), body: (await response.text()).slice(0, 80_000) };
      }, { lane: "public", cache: true }),
    }),
    browser_open: tool({
      description: "LAST RESORT after Gmail/Calendar/Exa/direct API evidence: open a page whose dynamic or authenticated DOM is still necessary in the persistent Browserless cloud browser. Do not use it for facts a fast tool can establish. Read-only discovery must never submit, buy, book, cancel, send, or change anything.",
      inputSchema: z.object({ url: z.url() }),
      execute: async ({ url }) => run("browser_open", { url }, async () => {
        const fastEvidenceCollected = audit.some((entry) => entry.ok && !entry.tool.startsWith("browser_"));
        if (!fastEvidenceCollected) return { blocked: true, instruction: "Collect fast Gmail, Calendar, Exa, API, weather, or sandbox evidence before opening the browser." };
        await context.browserWarmup;
        const page = await browser.open(input.userId, publicUrl(url).toString());
        return { title: page.title, url: page.url, snapshot: page.formatted.slice(0, 80_000) };
      }, { lane: "browser" }),
    }),
    browser_inspect: tool({
      description: "Inspect the current Browserless cloud-browser page without changing it.",
      inputSchema: z.object({ reason: z.string().min(1).max(300) }),
      execute: async ({ reason }) => run("browser_inspect", { reason }, async () => {
        const page = await browser.snapshot();
        return { title: page.title, url: page.url, snapshot: page.formatted.slice(0, 80_000) };
      }, { lane: "browser" }),
    }),
    browser_follow_link: tool({
      description: "Follow a normal anchor link in the Browserless browser. Buttons, forms, login, checkout, cancellation, booking, submission, and other mutations are blocked in discovery.",
      inputSchema: z.object({ ref: z.string().regex(/^e\d{1,4}$/), purpose: z.string().min(1).max(300) }),
      execute: async ({ ref, purpose }) => run("browser_follow_link", { ref, purpose }, async () => {
        const element = await browser.describeRef(ref);
        if (element.tag !== "a" || !element.href) throw new Error("Discovery can only follow ordinary anchor links");
        if (/\b(log\s*out|delete|remove|cancel|confirm|buy|checkout|pay|book|reserve|renew|subscribe|submit|apply|accept|authorize)\b/i.test(`${element.name ?? ""} ${element.href}`)) throw new Error("Potentially consequential links are blocked during discovery");
        const page = await browser.click(ref);
        return { title: page.title, url: page.url, snapshot: page.formatted.slice(0, 80_000) };
      }, { lane: "browser" }),
    }),
    browser_scroll: tool({
      description: "Scroll the E2B browser and return a fresh read-only snapshot.",
      inputSchema: z.object({ deltaY: z.number().int().min(-5000).max(5000) }),
      execute: async ({ deltaY }) => run("browser_scroll", { deltaY }, async () => {
        const page = await browser.scroll(deltaY);
        return { title: page.title, url: page.url, snapshot: page.formatted.slice(0, 80_000) };
      }, { lane: "browser" }),
    }),
    sandbox_run: tool({
      description: "Run a Python or JavaScript research/calculation script in an isolated E2B terminal with outbound internet. It has no credentials or browser cookies and cannot change user accounts. Use for public research, calculations, and comparing terms.",
      inputSchema: z.object({ language: z.enum(["python", "javascript"]), script: z.string().min(1).max(60_000), timeoutSeconds: z.number().int().min(5).max(180).default(90) }),
      execute: async ({ language, script, timeoutSeconds }) => run("sandbox_run", { language, script, timeoutSeconds }, async () => {
        if (!sandboxCreated) { await sandbox.create(); sandboxCreated = true; }
        const filename = language === "python" ? "discovery.py" : "discovery.js";
        await sandbox.writeFile(filename, new TextEncoder().encode(script));
        const result = await sandbox.exec(language === "python" ? `python /workspace/${filename}` : `node /workspace/${filename}`, { timeoutMs: timeoutSeconds * 1_000 });
        return { exitCode: result.exitCode, stdout: result.stdout.slice(-40_000), stderr: result.stderr.slice(-10_000), networkAccess: "unrestricted" };
      }, { lane: "sandbox" }),
    }),
  };

  return {
    tools,
    audit,
    async dispose() {
      releaseBrowserSession?.();
      if (sandboxCreated) await sandbox.destroy();
    },
  };
}
