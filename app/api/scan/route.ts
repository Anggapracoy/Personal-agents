import { discoveryGuidanceFor } from "../../../lib/proactive/engine/guidance";
import { enforceApiQuota } from "../../../lib/api-quota";
import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { generateDecisionCardsFromEmails } from "../../../lib/agent";
import { discoverDecisionCards } from "../../../lib/discovery/harness";
import { createDiscoveryRefreshLogger } from "../../../lib/discovery/logging";
import { getDiscoveryScanState, rememberReviewedMessages } from "../../../lib/discovery/scan-state";
import { fetchCriticalEmailRefs, fetchDiscoveryEmailRefs, fetchEmailsByIds, fetchGmailHistoryChanges, fetchGmailProfileHistoryId, fetchUpcomingEvents, findCalendarConflicts, type GmailMessageRef } from "../../../lib/google";
import type { DecisionEmailInput } from "../../../lib/agent";
import type { Decision } from "../../../lib/types";
import { createTemporalContext, type TemporalContext } from "../../../lib/temporal";
import { getUsableGoogleConnections, type UsableGoogleConnection } from "../../../lib/auth/google-connections";
import { getLifeProfile, type LifeMemory } from "../../../lib/life-profile";
import { defaultProactiveCalendarServices, discoverProactiveCalendarDecisions } from "../../../lib/proactive/calendar-decisions";
import { existingDecisionContextFromWorkspace, mergeExistingDecisionContexts, sanitizeExistingDecisionContexts, type ExistingDecisionContext } from "../../../lib/discovery/existing-decisions";
import { getWorkspaceState } from "../../../lib/workspace-state";

type ScanEvent = { type: "status"; message: string } | { type: "decision"; decision: Decision };
type ScanExecution = { status: number; body: Record<string, unknown> };
type CalendarEvent = Awaited<ReturnType<typeof fetchUpcomingEvents>>[number];

function sourceDecision(decision: Decision, connection: Pick<UsableGoogleConnection, "id" | "email">, prefix: boolean): Decision {
  return {
    ...decision,
    id: prefix ? `${connection.id}-${decision.id}` : decision.id,
    sourceLabel: connection.email,
    executionContext: { ...decision.executionContext, sourceAccountId: connection.id, sourceAccountEmail: connection.email },
  };
}

async function deviceCalendarCards(events: CalendarEvent[], existingIds: Set<string>, lifeMemory: LifeMemory) {
  const cards = await discoverProactiveCalendarDecisions({
    events,
    profile: lifeMemory.profile,
    context: { sourceKind: "device", connectionId: "apple-calendar", accountEmail: "Apple Calendar", prefixIds: true },
    services: defaultProactiveCalendarServices,
  });
  return cards.filter((decision) => !existingIds.has(decision.id));
}

function legacyEmailCards(emails: DecisionEmailInput[], generatedCards: Awaited<ReturnType<typeof generateDecisionCardsFromEmails>>, temporalContext: TemporalContext) {
  const emailById = new Map(emails.map((email) => [email.id, email]));
  return generatedCards.flatMap(({ emailId, temporalStatus, relevantDateTime, unresolvedPastConsequence: _unresolvedPastConsequence, ...generated }) => {
    const email = emailById.get(emailId);
    if (!email) return [];
    return [{
      ...generated,
      id: `gmail-${email.id}`,
      sourceType: "email",
      originalContext: `From ${email.from}: ${email.subject}\n${email.body || email.snippet}`.slice(0, 4_000),
      executionContext: { sourceEmail: { messageId: email.id, threadId: email.threadId, from: email.from, to: email.to, subject: email.subject, date: email.date, snippet: email.snippet, body: email.body, links: email.links, confirmationNumbers: email.confirmationNumbers, attachments: email.attachments } },
      dismissLabel: "Not now",
      createdAt: new Date().toISOString(),
      actionableUntil: temporalStatus !== "past_resolved" && relevantDateTime && Date.parse(relevantDateTime) > Date.parse(temporalContext.currentDateTimeUtc)
        ? new Date(relevantDateTime).toISOString()
        : undefined,
    } satisfies Decision];
  });
}

async function legacyEmailCardsBatched(emails: DecisionEmailInput[], existingDecisions: ExistingDecisionContext[], lifeMemory: LifeMemory, temporalContext: TemporalContext, ownerEmail: string, batchSize = 20): Promise<Decision[]> {
  const cards: Decision[] = [];
  for (let index = 0; index < emails.length; index += batchSize) {
    const batch = emails.slice(index, index + batchSize);
    try {
      const generated = await generateDecisionCardsFromEmails(batch, existingDecisions, lifeMemory, temporalContext, ownerEmail);
      cards.push(...legacyEmailCards(batch, generated, temporalContext));
    } catch (error) {
      if (batch.length > 5) cards.push(...await legacyEmailCardsBatched(batch, existingDecisions, lifeMemory, temporalContext, ownerEmail, Math.ceil(batch.length / 2)));
      else console.error("[decision-discovery] legacy fallback batch failed", { emailIds: batch.map((email) => email.id), error: error instanceof Error ? error.message : String(error) });
    }
  }
  return cards;
}

function legacyConflictCards(events: Awaited<ReturnType<typeof fetchUpcomingEvents>>, existingIds: Set<string>) {
  // Disabled alongside the main scanner so fallback scans cannot recreate overlap alerts.
  return [] as Decision[];
  /*
  return findCalendarConflicts(events).filter(([first, second]) => (
    !existingIds.has(`calendar-${first.id}-${second.id}`) && !existingIds.has(`calendar-${second.id}-${first.id}`)
  )).map(([first, second]) => ({
    id: `calendar-${first.id}-${second.id}`,
    sourceType: "calendar",
    category: "schedule",
    urgency: "high",
    title: `Which event should move: ${first.summary ?? "Event"} or ${second.summary ?? "Event"}?`,
    subtitle: "Google Calendar found an overlapping time",
    originalContext: `${first.summary ?? "Event"} overlaps with ${second.summary ?? "Event"}.`,
    executionContext: { sourceCalendar: { eventIds: [first.id, second.id], events: [first, second].map((event) => ({ id: event.id, summary: event.summary ?? "Event", description: event.description ?? "", location: event.location ?? "", start: event.start?.dateTime ?? event.start?.date ?? "", end: event.end?.dateTime ?? event.end?.date ?? "", attendees: (event.attendees ?? []).map((attendee) => attendee.email ?? attendee.displayName ?? "").filter(Boolean), htmlLink: event.htmlLink ?? "" })) } },
    options: [
      { id: "move-first", label: `Move ${first.summary ?? "first event"}`, actionType: "approval", isPrimary: true },
      { id: "move-second", label: `Move ${second.summary ?? "second event"}`, actionType: "approval" },
    ],
    dismissLabel: "Leave both for now",
    createdAt: new Date().toISOString(),
    actionableUntil: [first.start?.dateTime, second.start?.dateTime]
      .filter((value): value is string => Boolean(value))
      .sort()[0],
  } satisfies Decision));
  */
}

async function executeScan(request: Request, emit?: (event: ScanEvent) => void): Promise<ScanExecution> {
  const refreshId = crypto.randomUUID();
  const refreshLog = createDiscoveryRefreshLogger(refreshId);
  const refreshStartedAt = Date.now();
  const body = await request.json().catch(() => ({})) as { existingDecisions?: unknown; forceFullScan?: unknown; userTimeZone?: unknown; deviceCalendarEvents?: unknown };
  const temporalContext = createTemporalContext(body.userTimeZone);
  const forceFullScan = body.forceFullScan === true;
  const suppliedExistingDecisions = sanitizeExistingDecisionContexts(body.existingDecisions);
  const session = await auth();
  if (!session?.user?.email) return { status: 401, body: { error: "Authentication required." } };
  const persistedWorkspace = await getWorkspaceState(session.user.email).catch(() => null);
  const existingDecisions = mergeExistingDecisionContexts(
    suppliedExistingDecisions,
    persistedWorkspace ? existingDecisionContextFromWorkspace(persistedWorkspace.state) : [],
  );
  const existingIds = new Set(existingDecisions.map((item) => item.id));
  const lifeMemory = await getLifeProfile(session.user.email);
  const connections = await getUsableGoogleConnections(session.user.email);
  const primaryConnection = connections[0];
  const accessToken = primaryConnection?.accessToken;
  const deviceEvents = (Array.isArray(body.deviceCalendarEvents) ? body.deviceCalendarEvents : [])
    .filter((event): event is CalendarEvent => Boolean(event) && typeof event === "object" && typeof (event as CalendarEvent).id === "string")
    .slice(0, 500);
  if (!accessToken && deviceEvents.length === 0) return { status: 409, body: { error: "Connect an email account or calendar before scanning." } };
  if (!accessToken) {
    const decisions = await deviceCalendarCards(deviceEvents, existingIds, lifeMemory);
    return { status: 200, body: { decisions, scannedAt: new Date().toISOString(), mode: "connected", warnings: [], sources: { gmail: false, calendar: false, deviceCalendar: true } } };
  }
  const scanStateUserId = `${session.user.email}:${primaryConnection.id}`;

  try {
    console.info("[decision-discovery] refresh start", {
      refreshId,
      userId: session.user.email,
      existingDecisionCount: existingDecisions.length,
    });
    refreshLog.write({ stage: "refresh", status: "start", details: { userId: session.user.email, existingDecisionCount: existingDecisions.length } });
    emit?.({ type: "status", message: "Checking Gmail and Calendar for changes" });
    const [gmailHistoryIdResult, calendarResult, priorScanStateResult] = await Promise.allSettled([
      fetchGmailProfileHistoryId(accessToken),
      fetchUpcomingEvents(accessToken),
      getDiscoveryScanState(scanStateUserId),
    ]);
    const warnings = [gmailHistoryIdResult, calendarResult]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason instanceof Error ? result.reason.message : "A Google service could not be scanned.");
    if (gmailHistoryIdResult.status === "rejected" && calendarResult.status === "rejected") throw new Error(warnings.join(" "));

    const priorScanState = priorScanStateResult.status === "fulfilled" ? priorScanStateResult.value : null;
    const reviewedMessageIds = new Set(priorScanState?.reviewedMessageIds ?? []);
    const isInitialBaseline = !priorScanState || forceFullScan;
    let emailRefs: GmailMessageRef[] = [];
    const changedMessageIds = new Set<string>();
    let usedGmailHistory = false;
    if (gmailHistoryIdResult.status === "fulfilled") {
      if (!isInitialBaseline && priorScanState?.gmailHistoryId) {
        try {
          const [history, critical] = await Promise.all([
            fetchGmailHistoryChanges(accessToken, priorScanState.gmailHistoryId),
            fetchCriticalEmailRefs(accessToken),
          ]);
          const byId = new Map<string, GmailMessageRef>();
          for (const message of history.messages) {
            byId.set(message.id, message);
            changedMessageIds.add(message.id);
          }
          for (const message of critical) byId.set(message.id, message);
          emailRefs = [...byId.values()];
          usedGmailHistory = true;
        } catch (error) {
          warnings.push(`Gmail history cursor expired or failed; used the safe bounded scan instead. ${error instanceof Error ? error.message : String(error)}`);
          emailRefs = await fetchDiscoveryEmailRefs(accessToken);
        }
      } else emailRefs = await fetchDiscoveryEmailRefs(accessToken);
    }
    const emailIdsToFetch = emailRefs
      .map((message) => message.id)
      .filter((messageId) => isInitialBaseline || changedMessageIds.has(messageId) || !reviewedMessageIds.has(messageId));
    let emails: DecisionEmailInput[] = [];
    if (gmailHistoryIdResult.status === "fulfilled" && emailIdsToFetch.length > 0) {
      try { emails = await fetchEmailsByIds(accessToken, emailIdsToFetch); }
      catch (error) {
        const message = error instanceof Error ? error.message : "Gmail messages could not be downloaded.";
        warnings.push(message);
        if (calendarResult.status === "rejected") throw error;
      }
    }
    const events = calendarResult.status === "fulfilled" ? calendarResult.value : [];
    const unseenEmails = emails.filter((email) => !existingIds.has(`gmail-${email.id}`));
    const discoveryEnabled = process.env.DISCOVERY_HARNESS_ENABLED !== "false";
    const emailsToAnalyze = discoveryEnabled ? emails : unseenEmails;
    console.info("[decision-discovery] sources fetched", {
      refreshId,
      listedEmailCount: emailRefs.length,
      scannedEmailCount: emails.length,
      incremental: !isInitialBaseline,
      previouslyReviewedEmailCount: reviewedMessageIds.size,
      unseenEmailCount: unseenEmails.length,
      analyzedEmailCount: emailsToAnalyze.length,
      calendarEventCount: events.length,
      gmailAvailable: gmailHistoryIdResult.status === "fulfilled",
      usedGmailHistory,
      calendarAvailable: calendarResult.status === "fulfilled",
      warningCount: warnings.length,
    });
    refreshLog.write({ stage: "refresh", status: "sources", details: { listedEmailCount: emailRefs.length, scannedEmailCount: emails.length, incremental: !isInitialBaseline, usedGmailHistory, previouslyReviewedEmailCount: reviewedMessageIds.size, unseenEmailCount: unseenEmails.length, analyzedEmailCount: emailsToAnalyze.length, calendarEventCount: events.length, gmailAvailable: gmailHistoryIdResult.status === "fulfilled", calendarAvailable: calendarResult.status === "fulfilled", warnings } });
    emit?.({ type: "status", message: `Reviewing ${emailsToAnalyze.length} emails` });
    for (const email of emails) refreshLog.write({ stage: "source_email", emailId: email.id, threadId: email.threadId, from: email.from, subject: email.subject, date: email.date, snippet: email.snippet.slice(0, 1_000) });
    let discoveryMode: "harness" | "legacy_fallback" | "legacy_disabled" = discoveryEnabled ? "harness" : "legacy_disabled";
    let discoveryCandidateCount = 0;
    let discoveryInvestigatedCount = 0;
    let discoveryRejectedCount = 0;
    let discoveryFailures: string[] = [];
    let emailCards: Decision[] = [];
    let conflictCards: Decision[] = [];
    let successfullyReviewedEmailIds: string[] = [];

    if (discoveryEnabled) {
      try {
        const report = await discoverDecisionCards({
          proactiveGuidance: await discoveryGuidanceFor(session.user.email),

          userId: scanStateUserId,
          accessToken,
          emails: emailsToAnalyze,
          evidenceEmails: [...emails, ...(priorScanState?.recentEmails ?? []).filter((cached) => !emails.some((email) => email.id === cached.id))].slice(0, 150),
          events,
          existingDecisions,
          lifeMemory,
          userTimeZone: temporalContext.userTimeZone,
          temporalContext,
          onProgress: (message) => {
            console.info("[decision-discovery] progress", { refreshId, message });
            emit?.({ type: "status", message });
          },
          onAudit: (event) => refreshLog.write(event),
          onDecision: (decision) => emit?.({ type: "decision", decision: sourceDecision(decision, primaryConnection, false) }),
        });
        emailCards = report.decisions;
        discoveryCandidateCount = report.candidateCount;
        discoveryInvestigatedCount = report.investigatedCount;
        discoveryRejectedCount = report.rejected.length;
        discoveryFailures = report.failures;
        const failedEmailIds = new Set(report.failedEmailIds);
        successfullyReviewedEmailIds = report.reviewedEmailIds.filter((emailId) => !failedEmailIds.has(emailId));
        // A grounded no_card verdict never falls through to legacy generation.
        // Failed candidates stay unreviewed and are retried by the next sweep.
        // Falling back to the old bulk generator here can turn one slow
        // investigation into an unbounded second scan and duplicate cards.
        if (report.failedEmailIds.length) {
          warnings.push(`${report.failedEmailIds.length} message(s) will be retried by the next discovery sweep.`);
        }
      } catch (error) {
        discoveryMode = "legacy_fallback";
        discoveryFailures = [error instanceof Error ? error.message : "Discovery harness failed"];
        console.error("[decision-discovery] harness failed; using retained legacy generator", { error: discoveryFailures[0] });
        emailCards = await legacyEmailCardsBatched(unseenEmails, existingDecisions, lifeMemory, temporalContext, session.user.email);
        conflictCards = legacyConflictCards(events, existingIds);
      }
    } else {
      emailCards = await legacyEmailCardsBatched(unseenEmails, existingDecisions, lifeMemory, temporalContext, session.user.email);
      conflictCards = legacyConflictCards(events, existingIds);
      successfullyReviewedEmailIds = emailsToAnalyze.map((email) => email.id);
    }

    if (gmailHistoryIdResult.status === "fulfilled") {
      await rememberReviewedMessages(scanStateUserId, successfullyReviewedEmailIds, emails, gmailHistoryIdResult.value);
      console.info("[decision-discovery] incremental cursor updated", { refreshId, rememberedEmailCount: successfullyReviewedEmailIds.length });
    }

    const allConflicts = findCalendarConflicts(events);
    const primaryCards = [...conflictCards, ...emailCards].map((decision) => sourceDecision(decision, primaryConnection, false));
    const secondaryCards: Decision[] = [];
    for (const connection of connections.slice(1)) {
      try {
        emit?.({ type: "status", message: `Checking ${connection.email}` });
        const [refs, secondaryEvents] = await Promise.all([fetchDiscoveryEmailRefs(connection.accessToken), fetchUpcomingEvents(connection.accessToken)]);
        const secondaryEmails = refs.length ? await fetchEmailsByIds(connection.accessToken, refs.map((ref) => ref.id)) : [];
        const secondaryExisting = existingDecisions.filter((decision) => decision.id.startsWith(`${connection.id}-`));
        const generated = await legacyEmailCardsBatched(secondaryEmails, secondaryExisting, lifeMemory, temporalContext, session.user.email);
        const conflicts = legacyConflictCards(secondaryEvents, new Set(secondaryExisting.map((decision) => decision.id.replace(`${connection.id}-`, ""))));
        secondaryCards.push(...[...conflicts, ...generated].map((decision) => sourceDecision(decision, connection, true)));
      } catch (error) {
        warnings.push(`${connection.email} could not be scanned: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const appleCards = await deviceCalendarCards(deviceEvents, existingIds, lifeMemory);
    const decisions = [...appleCards, ...primaryCards, ...secondaryCards]
      .filter((decision) => Boolean(decision.discoveryUpdatesDecisionId) || !existingIds.has(decision.id))
      .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.urgency] - { high: 0, medium: 1, low: 2 }[b.urgency]));
    console.info("[decision-discovery] refresh complete", {
      refreshId,
      durationMs: Date.now() - refreshStartedAt,
      discoveryMode,
      candidateCount: discoveryCandidateCount,
      investigatedCount: discoveryInvestigatedCount,
      rejectedCount: discoveryRejectedCount,
      technicalFailureCount: discoveryFailures.length,
      returnedCardCount: decisions.length,
      returnedCardIds: decisions.map((decision) => decision.id),
    });
    refreshLog.write({ stage: "refresh", status: "complete", details: { durationMs: Date.now() - refreshStartedAt, discoveryMode, candidateCount: discoveryCandidateCount, investigatedCount: discoveryInvestigatedCount, rejectedCount: discoveryRejectedCount, technicalFailureCount: discoveryFailures.length, returnedCards: decisions.map((decision) => ({ id: decision.id, title: decision.title })) } });
    return { status: 200, body: {
      decisions,
      refreshId,
      skippedExisting: emails.length - unseenEmails.length,
      listedEmailCount: emailRefs.length,
      scannedEmailCount: emails.length,
      analyzedEmailCount: emailsToAnalyze.length,
      incremental: !isInitialBaseline,
      decisionEmailCount: emailCards.length,
      scannedCalendarEventCount: events.length,
      calendarConflictCount: allConflicts.length,
      discoveryMode,
      discoveryCandidateCount,
      discoveryInvestigatedCount,
      discoveryRejectedCount,
      discoveryFailureCount: discoveryFailures.length,
      scannedAt: new Date().toISOString(),
      mode: "connected",
      warnings,
      connectedGoogleAccountCount: connections.length,
      sources: { gmail: gmailHistoryIdResult.status === "fulfilled", calendar: calendarResult.status === "fulfilled", deviceCalendar: deviceEvents.length > 0 },
    } };
  } catch (error) {
    console.error("[decision-discovery] refresh failed", {
      refreshId,
      durationMs: Date.now() - refreshStartedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    refreshLog.write({ stage: "refresh", status: "failed", details: { durationMs: Date.now() - refreshStartedAt, error: error instanceof Error ? error.message : String(error) } });
    return { status: 502, body: { error: error instanceof Error ? error.message : "Google scan failed", refreshId } };
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const limited = await enforceApiQuota(session.user.email, "scan");
  if (limited) return limited;
  if (!request.headers.get("accept")?.includes("application/x-ndjson")) {
    const result = await executeScan(request);
    return NextResponse.json(result.body, { status: result.status });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const result = await executeScan(request, (event) => write(event));
        if (result.status >= 400) write({ type: "error", ...result.body });
        else write({ type: "complete", ...result.body });
      } catch (error) {
        write({ type: "error", error: error instanceof Error ? error.message : "Google scan failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
