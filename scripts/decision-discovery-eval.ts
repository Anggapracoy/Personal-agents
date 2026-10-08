import { createDecipheriv, createHash, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverDecisionCards } from "../lib/discovery/harness";
import { prefilterEmails } from "../lib/discovery/prefilter";
import { fetchDiscoveryEmails, fetchUpcomingEvents } from "../lib/google";
import { getUsableGoogleConnections } from "../lib/auth/google-connections";
import { getLifeProfile } from "../lib/life-profile";

function loadEnvFile(file: string) {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));

function decryptCookie(encrypted: Buffer, password: string, host: string) {
  const version = encrypted.subarray(0, 3).toString("ascii");
  if (version !== "v10" && version !== "v11") throw new Error(`Unsupported Chrome cookie encryption (${version || "unknown"})`);
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  let plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
  const hostDigest = createHash("sha256").update(host).digest();
  if (plain.length >= hostDigest.length && timingSafeEqual(plain.subarray(0, hostDigest.length), hostDigest)) plain = plain.subarray(hostDigest.length);
  return plain.toString("utf8");
}

function localSessionCookie() {
  if (process.env.DECISION_FEED_SESSION_COOKIE) return process.env.DECISION_FEED_SESSION_COOKIE;
  const source = join(homedir(), "Library", "Application Support", "Google", "Chrome", process.env.DECISION_FEED_CHROME_PROFILE ?? "Default", "Cookies");
  const networkSource = join(homedir(), "Library", "Application Support", "Google", "Chrome", process.env.DECISION_FEED_CHROME_PROFILE ?? "Default", "Network", "Cookies");
  const database = existsSync(networkSource) ? networkSource : source;
  if (!existsSync(database)) throw new Error("Chrome cookie database was not found. Set DECISION_FEED_SESSION_COOKIE instead.");
  const directory = mkdtempSync(join(tmpdir(), "decision-discovery-eval-"));
  const copy = join(directory, "Cookies");
  try {
    copyFileSync(database, copy);
    const output = execFileSync("/usr/bin/sqlite3", ["-json", copy, "SELECT host_key, value, hex(encrypted_value) encrypted_hex FROM cookies WHERE host_key IN ('localhost','127.0.0.1') AND name IN ('decision-feed.session-token','__Secure-authjs.session-token') ORDER BY CASE WHEN host_key IN ('localhost','127.0.0.1') THEN 0 ELSE 1 END, last_access_utc DESC LIMIT 1;"], { encoding: "utf8", maxBuffer: 64 * 1024 });
    const row = (output.trim() ? JSON.parse(output) : [])[0] as { host_key: string; value: string; encrypted_hex: string } | undefined;
    if (!row) throw new Error("No signed-in Decision Feed session was found in the selected Chrome profile or production app.");
    if (row.value) return row.value;
    const password = execFileSync("/usr/bin/security", ["find-generic-password", "-w", "-s", "Chrome Safe Storage"], { encoding: "utf8", maxBuffer: 64 * 1024 }).trim();
    return decryptCookie(Buffer.from(row.encrypted_hex, "hex"), password, row.host_key);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const baseUrl = argument("--base-url") ?? process.env.DECISION_FEED_URL ?? "http://localhost:3001";
  const configuredMaxCandidates = argument("--max-candidates") ?? process.env.DISCOVERY_EVAL_MAX_CANDIDATES;
  const maxCandidates = configuredMaxCandidates ? Number(configuredMaxCandidates) : undefined;
  if (process.argv.includes("--vercel-api-scan")) {
    const cookie = localSessionCookie();
    const startedAt = Date.now();
    const output = execFileSync("npx", [
      "vercel", "curl", "/api/scan", "--deployment", baseUrl, "--",
      "--request", "POST",
      "--header", "content-type: application/json",
      "--header", "accept: application/x-ndjson",
      "--header", `cookie: decision-feed.session-token=${cookie}`,
      "--data", JSON.stringify({ existingDecisions: [], forceFullScan: process.argv.includes("--force-full-scan"), userTimeZone: "America/Toronto", deviceCalendarEvents: [] }),
    ], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60_000 });
    const events = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as Record<string, unknown>);
    const result = events.findLast((event) => event.type === "complete" || event.type === "error") ?? {};
    const streamedCards = events
      .filter((event) => event.type === "decision" && event.decision && typeof event.decision === "object")
      .map((event) => event.decision as { id?: string; title?: string; options?: Array<{ label?: string }> });
    const completedCards = Array.isArray(result.decisions)
      ? result.decisions as Array<{ id?: string; title?: string; options?: Array<{ label?: string }> }>
      : [];
    const cards = [...new Map([...streamedCards, ...completedCards].map((card) => [card.id ?? card.title, card])).values()];
    const report = {
      durationMs: Date.now() - startedAt,
      type: result.type,
      error: result.error,
      discoveryMode: result.discoveryMode,
      scannedEmailCount: result.scannedEmailCount,
      analyzedEmailCount: result.analyzedEmailCount,
      candidateCount: result.discoveryCandidateCount,
      investigatedCount: result.discoveryInvestigatedCount,
      cards: cards.map((card) => ({ title: card.title, options: card.options?.map((option) => option.label) ?? [] })),
    };
    const reportPath = resolve(argument("--output") ?? "/tmp/dash-real-discovery.json");
    writeFileSync(reportPath, `${JSON.stringify({ ...report, events }, null, 2)}\n`, { mode: 0o600 });
    console.info("[discovery-eval] protected preview scan complete", { ...report, reportPath });
    if (result.type !== "complete") process.exitCode = 2;
    return;
  }
  const requestedUserEmail = argument("--user-email")?.trim().toLowerCase();
  let session: { user?: { email?: string }; accessToken?: string };
  let cookie: string | undefined;
  if (requestedUserEmail) {
    const connection = (await getUsableGoogleConnections(requestedUserEmail))[0];
    if (!connection) throw new Error(`No usable connected Google account was found for ${requestedUserEmail}.`);
    session = { user: { email: requestedUserEmail }, accessToken: connection.accessToken };
  } else {
    cookie = localSessionCookie();
    const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: `decision-feed.session-token=${cookie}` }, cache: "no-store" });
    if (!sessionResponse.ok) throw new Error(`Could not read the local authenticated session (${sessionResponse.status}).`);
    session = await sessionResponse.json() as { user?: { email?: string }; accessToken?: string };
  }
  if (!session.user?.email) throw new Error("No signed-in or explicitly selected user session is available.");

  if (process.argv.includes("--api-scan")) {
    if (!cookie) throw new Error("--api-scan requires a browser session; omit it when using --user-email.");
    const startedAt = Date.now();
    const forceFullScan = process.argv.includes("--force-full-scan");
    const response = await fetch(`${baseUrl}/api/scan`, {
      method: "POST",
      headers: { cookie: `decision-feed.session-token=${cookie}`, "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify({ existingDecisions: [], forceFullScan }),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The scan endpoint returned no stream.");
    const decoder = new TextDecoder();
    let pending = "";
    let result: Record<string, unknown> = {};
    while (true) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type === "status") console.info("[discovery-eval] API progress", event.message);
        if (event.type === "complete" || event.type === "error") result = event;
      }
      if (chunk.done) break;
    }
    console.info("[discovery-eval] API scan result", { durationMs: Date.now() - startedAt, status: response.status, ...result });
    if (!response.ok) process.exitCode = 2;
    return;
  }

  if (!session.accessToken) throw new Error("The selected session does not expose a Google access token; use --api-scan so the server can use its stored connection.");

  console.info("[discovery-eval] fetching real connected sources", { userId: session.user.email, maxCandidates: maxCandidates ?? "unbounded" });
  const [emails, events, lifeMemory] = await Promise.all([
    fetchDiscoveryEmails(session.accessToken),
    fetchUpcomingEvents(session.accessToken),
    getLifeProfile(session.user.email),
  ]);
  console.info("[discovery-eval] sources ready", { emailCount: emails.length, calendarEventCount: events.length });
  if (process.argv.includes("--prefilter-only")) {
    const decisions = prefilterEmails(emails);
    const result = {
      counts: Object.fromEntries(["obvious_noise", "uncertain", "strong_candidate"].map((bucket) => [bucket, decisions.filter((decision) => decision.bucket === bucket).length])),
      decisions: decisions.map((decision) => ({
        bucket: decision.bucket,
        emailId: decision.emailId,
        subject: emails.find((email) => email.id === decision.emailId)?.subject,
        from: emails.find((email) => email.id === decision.emailId)?.from,
        reason: decision.reason,
        signalType: decision.signalType,
        snippet: emails.find((email) => email.id === decision.emailId)?.snippet,
        body: argument("--output") ? emails.find((email) => email.id === decision.emailId)?.body.slice(0, 12_000) : undefined,
        date: emails.find((email) => email.id === decision.emailId)?.date,
        })),
    };
    const output = argument("--output");
    if (output) {
      const outputPath = resolve(output);
      writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
      console.info("[discovery-eval] prefilter result written", { outputPath, ...result.counts });
    } else console.info("[discovery-eval] prefilter result", result);
    return;
  }
  const audit: Array<Record<string, unknown>> = [];
  const emailMatch = argument("--email-match");
  const scanEmails = emailMatch
    ? emails.filter((email) => `${email.from}\n${email.subject}\n${email.snippet}\n${email.body}`.toLowerCase().includes(emailMatch.toLowerCase()))
    : emails;
  if (emailMatch) console.info("[discovery-eval] targeted real-inbox evaluation", { emailMatch, matchedEmails: scanEmails.length, evidenceEmails: emails.length });
  const startedAt = Date.now();
  const decisionTimings: Array<{ id: string; elapsedMs: number }> = [];
  const report = await discoverDecisionCards({
    userId: session.user.email,
    accessToken: session.accessToken,
    emails: scanEmails,
    evidenceEmails: emails,
    events,
    existingDecisions: [],
    lifeMemory,
    maxCandidates,
    onProgress: (message) => console.info("[discovery-eval] progress", message),
    onAudit: (event) => audit.push(event as unknown as Record<string, unknown>),
    onDecision: (decision) => decisionTimings.push({ id: decision.id, elapsedMs: Date.now() - startedAt }),
  });
  const result = {
    durationMs: Date.now() - startedAt,
    firstDecisionMs: decisionTimings[0]?.elapsedMs ?? null,
    decisionTimings,
    reviewedEmails: report.reviewedEmailIds.length,
    candidates: report.candidateCount,
    investigated: report.investigatedCount,
    cards: report.decisions.map((decision) => ({
      id: decision.id,
      title: decision.title,
      subtitle: decision.subtitle,
      // Keep the legacy label list for human-readable reports while retaining
      // the real action contract used by the production card click path.
      options: decision.options.map((option) => option.label),
      optionDetails: decision.options.map((option) => ({
        id: option.id,
        label: option.label,
        actionType: option.actionType,
        isPrimary: option.isPrimary,
      })),
    })),
    rejected: report.rejected.map((rejection) => ({ candidateId: rejection.candidateId, reason: rejection.reason })),
    technicalFailures: report.failures,
    audit,
  };
  const output = argument("--output");
  if (output) {
    const outputPath = resolve(output);
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.info("[discovery-eval] result written", { outputPath, durationMs: result.durationMs, reviewedEmails: result.reviewedEmails, candidates: result.candidates, investigated: result.investigated, cards: result.cards.length, failures: result.technicalFailures.length });
  } else console.info("[discovery-eval] result", result);
  if (report.failures.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error("[discovery-eval] fatal", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
