import { createDecipheriv, createHash, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { asc } from "drizzle-orm";
import { getDb } from "../db";
import { connectedGoogleAccounts, discoveryScanStates } from "../db/schema";
import type { DecisionEmailInput } from "../lib/agent";
import { getUsableGoogleConnections } from "../lib/auth/google-connections";
import { discoverDecisionCards } from "../lib/discovery/harness";
import { prefilterEmails } from "../lib/discovery/prefilter";
import type { DiscoveryRefreshAuditEvent } from "../lib/discovery/types";
import { fetchDiscoveryEmails, fetchUpcomingEvents } from "../lib/google";
import { decryptSecret } from "../lib/harness/secrets";
import { createTemporalContext } from "../lib/temporal";
import { getLifeProfile } from "../lib/life-profile";

function loadEnvFile(file: string, keys?: Set<string>, overwrite = false) {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (keys && !keys.has(key)) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (overwrite || !(key in process.env)) process.env[key] = value;
  }
}

if (process.env.DISCOVERY_BENCHMARK_APP_ENV_FILE) loadEnvFile(resolve(process.env.DISCOVERY_BENCHMARK_APP_ENV_FILE), undefined, true);
loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.env.KODO_ENV_FILE ?? join(homedir(), "Kodo", ".env.local")), new Set(["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]));
loadEnvFile(resolve(process.env.KODO_ENV_FALLBACK_FILE ?? join(homedir(), "Kodo", ".env")), new Set(["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]));

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function readStdinEmails() {
  if (!process.argv.includes("--stdin-emails")) return undefined;
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let payload = "";
  for await (const line of lines) {
    payload = line;
    lines.close();
    break;
  }
  const parsed = JSON.parse(payload) as Array<Record<string, unknown>>;
  return parsed.map((email): DecisionEmailInput => ({
    id: String(email.id ?? ""),
    threadId: String(email.thread_id ?? email.threadId ?? email.id ?? ""),
    subject: String(email.subject ?? "(no subject)"),
    from: String(email.from_ ?? email.from ?? "unknown"),
    to: Array.isArray(email.to) ? email.to.map(String).join(", ") : String(email.to ?? ""),
    date: String(email.email_ts ?? email.date ?? new Date().toISOString()),
    snippet: String(email.snippet ?? ""),
    body: String(email.body ?? email.snippet ?? ""),
    links: [],
    confirmationNumbers: [],
    attachments: [],
    labels: Array.isArray(email.labels) ? email.labels.map(String) : [],
  })).filter((email) => email.id.length > 0);
}

function decryptChromeCookie(encrypted: Buffer, password: string, host: string) {
  const version = encrypted.subarray(0, 3).toString("ascii");
  if (version !== "v10" && version !== "v11") throw new Error(`Unsupported Chrome cookie encryption (${version || "unknown"}).`);
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  let plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
  const hostDigest = createHash("sha256").update(host).digest();
  if (plain.length >= hostDigest.length && timingSafeEqual(plain.subarray(0, hostDigest.length), hostDigest)) plain = plain.subarray(hostDigest.length);
  return plain.toString("utf8");
}

function productionSessionCookie(host: string) {
  const profile = process.env.DECISION_FEED_CHROME_PROFILE ?? "Default";
  const roots = [
    join(homedir(), "Library", "Application Support", "Google", "Chrome", profile, "Network", "Cookies"),
    join(homedir(), "Library", "Application Support", "Google", "Chrome", profile, "Cookies"),
  ];
  const source = roots.find(existsSync);
  if (!source) throw new Error("Chrome cookie database was not found.");
  const directory = mkdtempSync(join(tmpdir(), "decision-discovery-models-"));
  const copy = join(directory, "Cookies");
  try {
    copyFileSync(source, copy);
    const escapedHost = host.replaceAll("'", "''");
    const output = execFileSync("/usr/bin/sqlite3", ["-json", copy, `SELECT host_key, value, hex(encrypted_value) encrypted_hex FROM cookies WHERE host_key='${escapedHost}' AND name='decision-feed.session-token' ORDER BY last_access_utc DESC LIMIT 1;`], { encoding: "utf8", maxBuffer: 64 * 1024 });
    const row = (output.trim() ? JSON.parse(output) : [])[0] as { host_key: string; value: string; encrypted_hex: string } | undefined;
    if (!row) throw new Error("No signed-in production Decision Feed session was found in Chrome.");
    if (row.value) return row.value;
    const password = execFileSync("/usr/bin/security", ["find-generic-password", "-w", "-s", "Chrome Safe Storage"], { encoding: "utf8", maxBuffer: 64 * 1024 }).trim();
    return decryptChromeCookie(Buffer.from(row.encrypted_hex, "hex"), password, row.host_key);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function productionConnection() {
  const baseUrl = argument("--base-url") ?? process.env.DECISION_FEED_URL ?? "http://localhost:3000";
  const url = new URL(baseUrl);
  const cookie = productionSessionCookie(url.hostname);
  const response = await fetch(new URL("/api/auth/session", url), {
    headers: { cookie: `decision-feed.session-token=${cookie}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Could not read production session (${response.status}).`);
  const session = await response.json() as { user?: { email?: string; name?: string }; accessToken?: string };
  if (!session.user?.email || !session.accessToken) throw new Error("The production session is not signed in with Google.");
  return {
    email: session.user.email,
    accessToken: session.accessToken,
  };
}

function usageSummary(audit: DiscoveryRefreshAuditEvent[]) {
  const calls = audit.filter((event): event is Extract<DiscoveryRefreshAuditEvent, { stage: "model_usage" }> => event.stage === "model_usage");
  return calls.reduce((summary, event) => {
    summary.calls += event.usage.cached ? 0 : 1;
    summary.durationMs += event.durationMs;
    summary.inputTokens += numberValue(event.usage.inputTokens);
    summary.outputTokens += numberValue(event.usage.outputTokens);
    summary.totalTokens += numberValue(event.usage.totalTokens);
    summary.reasoningTokens += numberValue(event.usage.reasoningTokens)
      || numberValue((event.usage.outputTokenDetails as Record<string, unknown> | undefined)?.reasoningTokens);
    summary.byPurpose[event.purpose] ??= { calls: 0, durationMs: 0, inputTokens: 0, outputTokens: 0 };
    const purpose = summary.byPurpose[event.purpose]!;
    purpose.calls += event.usage.cached ? 0 : 1;
    purpose.durationMs += event.durationMs;
    purpose.inputTokens += numberValue(event.usage.inputTokens);
    purpose.outputTokens += numberValue(event.usage.outputTokens);
    return summary;
  }, {
    calls: 0,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    byPurpose: {} as Record<string, { calls: number; durationMs: number; inputTokens: number; outputTokens: number }>,
  });
}

const modelPricingPerMillion = {
  "gpt-5.6-luna": { input: 0.20, output: 1.20 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
} as const;

function estimatedModelCost(audit: DiscoveryRefreshAuditEvent[]) {
  const calls = audit.filter((event): event is Extract<DiscoveryRefreshAuditEvent, { stage: "model_usage" }> => event.stage === "model_usage");
  return calls.reduce((summary, event) => {
    if (event.usage.cached) return summary;
    const pricing = modelPricingPerMillion[event.model as keyof typeof modelPricingPerMillion];
    if (!pricing) return summary;
    const inputTokens = numberValue(event.usage.inputTokens);
    const outputTokens = numberValue(event.usage.outputTokens);
    const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
    summary.totalDollars += cost;
    summary.byModel[event.model] = (summary.byModel[event.model] ?? 0) + cost;
    return summary;
  }, { totalDollars: 0, byModel: {} as Record<string, number> });
}

async function ownerEmail() {
  const explicit = argument("--owner") ?? process.env.DISCOVERY_BENCHMARK_OWNER;
  if (explicit) return explicit.trim().toLowerCase();
  const rows = await getDb().select({ ownerEmail: connectedGoogleAccounts.ownerEmail })
    .from(connectedGoogleAccounts).orderBy(asc(connectedGoogleAccounts.createdAt));
  const owners = [...new Set(rows.map((row) => row.ownerEmail))];
  if (owners.length !== 1) throw new Error("Pass --owner because the database does not contain exactly one connected-account owner.");
  return owners[0]!;
}

function sameRepresentativeSample(emails: DecisionEmailInput[]) {
  const prefilter = prefilterEmails(emails);
  const byId = new Map(emails.map((email) => [email.id, email]));
  const limits = { strong_candidate: 6, uncertain: 12, obvious_noise: 6 } as const;
  const selected = (Object.keys(limits) as Array<keyof typeof limits>).flatMap((bucket) => prefilter
    .filter((decision) => decision.bucket === bucket)
    .slice(0, limits[bucket])
    .map((decision) => byId.get(decision.emailId))
    .filter((email): email is DecisionEmailInput => Boolean(email)));
  return selected.length ? selected : emails.slice(0, 24);
}

async function runModel(input: {
  modelId: "automatic" | "gpt-5.6-luna" | "gemini-3.7-flash";
  owner: string;
  accessToken: string;
  emails: DecisionEmailInput[];
  evidenceEmails: DecisionEmailInput[];
  events: Awaited<ReturnType<typeof fetchUpcomingEvents>>;
  maxCandidates?: number;
  temporalContext: ReturnType<typeof createTemporalContext>;
  lifeMemory: Awaited<ReturnType<typeof getLifeProfile>>;
}) {
  if (input.modelId === "automatic") delete process.env.DISCOVERY_BENCHMARK_MODEL_ID;
  else process.env.DISCOVERY_BENCHMARK_MODEL_ID = input.modelId;
  process.env.DISCOVERY_BENCHMARK_DISABLE_CACHE = "true";
  const audit: DiscoveryRefreshAuditEvent[] = [];
  const startedAt = Date.now();
  const report = await discoverDecisionCards({
    userId: input.owner,
    accessToken: input.accessToken,
    emails: input.emails,
    evidenceEmails: input.evidenceEmails,
    events: input.events,
    existingDecisions: [],
    lifeMemory: input.lifeMemory,
    maxCandidates: input.maxCandidates,
    temporalContext: input.temporalContext,
    onProgress: (message) => console.info(`[benchmark:${input.modelId}]`, message),
    onAudit: (event) => audit.push(event),
  });
  return {
    modelId: input.modelId,
    durationMs: Date.now() - startedAt,
    reviewedEmails: report.reviewedEmailIds.length,
    candidates: report.candidateCount,
    investigated: report.investigatedCount,
    cards: report.decisions.map((decision) => ({
      title: decision.title,
      subtitle: decision.subtitle,
      category: decision.category,
      urgency: decision.urgency,
      options: decision.options.map((option) => option.label),
    })),
    rejected: report.rejected,
    failures: report.failures,
    usage: usageSummary(audit),
    estimatedModelCost: estimatedModelCost(audit),
    investigations: audit.filter((event) => event.stage === "investigation"),
    intake: audit.filter((event) => event.stage === "intake"),
  };
}

async function main() {
  const owner = await ownerEmail();
  const lifeMemory = await getLifeProfile(owner);
  const stdinEmails = await readStdinEmails();
  const connections = stdinEmails ? [] : await getUsableGoogleConnections(owner);
  let connection = stdinEmails ? {
    id: "gmail-connector-fixture",
    email: owner,
    name: "Gmail connector benchmark",
    enabled: true,
    connectedAt: new Date().toISOString(),
    accessToken: "gmail-connector-read-only",
  } : connections[0];
  let evidenceEmails: DecisionEmailInput[] | undefined;
  let events: Awaited<ReturnType<typeof fetchUpcomingEvents>> | undefined;
  let sourceMode = stdinEmails ? "gmail-connector-summaries" : "live-google";
  if (stdinEmails) {
    evidenceEmails = stdinEmails;
    events = [];
  }
  if (!connection) {
    try { connection = await productionConnection() as typeof connection; } catch {
      const [storedConnection] = await getDb().select().from(connectedGoogleAccounts).orderBy(asc(connectedGoogleAccounts.createdAt)).limit(1);
      const snapshots = await getDb().select({ recentEmails: discoveryScanStates.recentEmails }).from(discoveryScanStates).orderBy(asc(discoveryScanStates.updatedAt));
      const recentEmails = snapshots.flatMap((snapshot) => snapshot.recentEmails);
      if (!storedConnection || recentEmails.length === 0) throw new Error("No usable Google token or stored discovery snapshot was found.");
      connection = {
        id: storedConnection.id,
        email: storedConnection.email,
        name: storedConnection.name,
        enabled: storedConnection.enabled,
        connectedAt: storedConnection.createdAt.toISOString(),
        accessToken: decryptSecret(storedConnection.encryptedAccessToken),
      };
      evidenceEmails = recentEmails;
      events = [];
      sourceMode = "stored-inbox-snapshot";
    }
  }
  if (!connection) throw new Error("No connected account could be loaded.");
  const maxCandidateArgument = argument("--max-candidates");
  const maxCandidates = maxCandidateArgument ? Number(maxCandidateArgument) : undefined;
  const scenario = argument("--scenario") ?? "comparison";
  console.info("[benchmark] fetching one fixed real-inbox sample", { account: connection.email.replace(/(^.).*(@.*$)/, "$1***$2"), maxCandidates, sourceMode });
  if (!evidenceEmails || !events) [evidenceEmails, events] = await Promise.all([
      fetchDiscoveryEmails(connection.accessToken),
      fetchUpcomingEvents(connection.accessToken),
    ]);
  const temporalContext = createTemporalContext("America/Toronto");
  if (scenario === "production-routing") {
    const fullScanEmails = evidenceEmails;
    const singleTestEmails = prefilterEmails(evidenceEmails)
      .filter((decision) => decision.bucket !== "obvious_noise")
      .sort((left, right) => {
        const priority = { strong_candidate: 0, uncertain: 1, obvious_noise: 2 } as const;
        return priority[left.bucket] - priority[right.bucket] || right.potentialValue - left.potentialValue;
      })
      .map((decision) => evidenceEmails.find((email) => email.id === decision.emailId))
      .filter((email): email is DecisionEmailInput => Boolean(email));
    const singleCount = Math.max(1, Number(argument("--single-count") ?? "3"));
    const singleEmails = singleTestEmails.slice(0, singleCount);
    if (singleEmails.length < singleCount) throw new Error(`Only ${singleEmails.length} non-noise emails were available for ${singleCount} requested single-email tests.`);
    console.info("[benchmark] production routing sample ready", {
      fullScanEmails: fullScanEmails.length,
      evidenceEmails: evidenceEmails.length,
      events: events.length,
      singleEmailRuns: singleEmails.length,
      maxCandidates: maxCandidates ?? "production-unbounded",
    });
    const fullScan = await runModel({ owner, accessToken: connection.accessToken, emails: fullScanEmails, evidenceEmails, events, maxCandidates, temporalContext, lifeMemory, modelId: "automatic" });
    const singleRuns = [];
    for (const email of singleEmails) singleRuns.push(await runModel({
      owner,
      accessToken: connection.accessToken,
      emails: [email],
      evidenceEmails,
      events,
      maxCandidates,
      temporalContext,
      lifeMemory,
      modelId: "automatic",
    }));
    delete process.env.DISCOVERY_BENCHMARK_MODEL_ID;
    delete process.env.DISCOVERY_BENCHMARK_DISABLE_CACHE;
    const outputPath = resolve(argument("--output") ?? "/tmp/dash-discovery-routing-benchmark.json");
    writeFileSync(outputPath, `${JSON.stringify({
      createdAt: new Date().toISOString(),
      scenario,
      sample: { fullScanEmailCount: fullScanEmails.length, evidenceEmailCount: evidenceEmails.length, calendarEventCount: events.length, singleEmailRunCount: singleRuns.length },
      fullScan,
      singleRuns,
    }, null, 2)}\n`, { mode: 0o600 });
    console.info("[benchmark] production routing complete", {
      outputPath,
      fullScan: { durationMs: fullScan.durationMs, reviewedEmails: fullScan.reviewedEmails, candidates: fullScan.candidates, cards: fullScan.cards.length, failures: fullScan.failures.length, usage: fullScan.usage, estimatedModelCost: fullScan.estimatedModelCost },
      singleRuns: singleRuns.map((run) => ({ durationMs: run.durationMs, candidates: run.candidates, cards: run.cards.length, failures: run.failures.length, usage: run.usage, estimatedModelCost: run.estimatedModelCost })),
    });
    return;
  }
  if (scenario !== "comparison") throw new Error(`Unsupported benchmark scenario: ${scenario}`);

  const emails = sameRepresentativeSample(evidenceEmails);
  const samplePrefilter = prefilterEmails(emails);
  console.info("[benchmark] fixed sample ready", {
    emails: emails.length,
    evidenceEmails: evidenceEmails.length,
    events: events.length,
    buckets: Object.fromEntries(["strong_candidate", "uncertain", "obvious_noise"].map((bucket) => [bucket, samplePrefilter.filter((item) => item.bucket === bucket).length])),
  });

  const common = { owner, accessToken: connection.accessToken, emails, evidenceEmails, events, maxCandidates, temporalContext, lifeMemory };
  const results = [];
  for (const modelId of ["gpt-5.6-luna", "gemini-3.7-flash"] as const) results.push(await runModel({ ...common, modelId }));
  delete process.env.DISCOVERY_BENCHMARK_MODEL_ID;
  delete process.env.DISCOVERY_BENCHMARK_DISABLE_CACHE;

  const result = {
    createdAt: new Date().toISOString(),
    sample: {
      emailCount: emails.length,
      evidenceEmailCount: evidenceEmails.length,
      calendarEventCount: events.length,
      emailIds: emails.map((email) => email.id),
      buckets: Object.fromEntries(["strong_candidate", "uncertain", "obvious_noise"].map((bucket) => [bucket, samplePrefilter.filter((item) => item.bucket === bucket).length])),
    },
    results,
  };
  const outputPath = resolve(argument("--output") ?? "/tmp/dash-discovery-model-benchmark.json");
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.info("[benchmark] complete", {
    outputPath,
    results: results.map(({ modelId, durationMs, candidates, investigated, cards, failures, usage }) => ({ modelId, durationMs, candidates, investigated, cards: cards.length, failures: failures.length, usage })),
  });
}

main().catch((error) => {
  console.error("[benchmark] fatal", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
