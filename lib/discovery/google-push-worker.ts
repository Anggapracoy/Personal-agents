import { latestDeliveredMessage } from '../proactive/engine/thread-state';
import { inngest } from '../harness/inngest-client';
import { checkDueFollowUp, detectSentPromises, followUpAt } from '../proactive/engine/detectors/loops';
import { removeDecisions } from '../proactive/engine/store';
import { senderAddress } from '../proactive/engine/rules';
import {
  getGoogleConnectionAccessToken,
  getPrimaryGoogleConnectionId,
  getUsableGoogleConnections,
} from "../auth/google-connections";
import {
  fetchDiscoveryEmailRefs,
  fetchRecoveryEmailRefs,
  fetchEmailsByIds,
  fetchGmailHistoryChanges,
  fetchGmailThread,
  fetchGmailProfileHistoryId,
  fetchUpcomingEvents,
  unreviewedGmailMessageIds,
  GoogleApiError,
  type GoogleEvent,
} from "../google";
import {
  getGoogleWatchContext,
  recordGoogleSourceError,
  recordGoogleSourceProcessed,
} from "../google-push";
import { createTemporalContext } from "../temporal";
import type { Decision, WorkspaceStateData } from "../types";
import { getWorkspaceState, putWorkspaceState } from "../workspace-state";
import { deliverPendingPushNotifications, queueDecisionPushNotifications } from "../push-notifications";
import { proactiveEngineEnabled } from "../proactive/engine/candidates";
import { mutedByPreferences } from "../proactive/engine/rules";
import { getPreferences } from "../proactive/engine/store";
import { discoveryGuidanceFor } from "../proactive/engine/guidance";
import { getLifeProfile, listProactiveProfileOwners } from "../life-profile";
import {
  defaultProactiveCalendarServices,
  discoverProactiveCalendarDecisions,
} from "../proactive/calendar-decisions";
import { discoverDecisionCards } from "./harness";
import { reconcileDiscoveredConversations } from "./decision-merge";
import { existingDecisionContextFromWorkspace } from "./existing-decisions";
import { getDiscoveryScanState, rememberReviewedMessages } from "./scan-state";

export type GoogleSourceChange = {
  connectionId: string;
  ownerEmail?: string;
  source: "gmail" | "calendar";
  historyId?: string;
  followUpThreadId?: string;
  followUpMessageId?: string;
};

function activeDecision(decision: Decision) {
  return !decision.actionableUntil || !Number.isFinite(Date.parse(decision.actionableUntil)) || Date.parse(decision.actionableUntil) > Date.now();
}

function scanContext(state: WorkspaceStateData) { return existingDecisionContextFromWorkspace(state); }

function sourceDecision(
  decision: Decision,
  context: { connectionId: string; accountEmail: string },
  prefix: boolean,
): Decision {
  return {
    ...decision,
    id: prefix ? `${context.connectionId}-${decision.id}` : decision.id,
    sourceLabel: context.accountEmail,
    executionContext: {
      ...(decision.executionContext ?? {}),
      sourceAccountId: context.connectionId,
      sourceAccountEmail: context.accountEmail,
    },
  };
}

function latestHistoryId(...values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value) && /^\d+$/.test(value!))
    .reduce((latest, value) => BigInt(value) > BigInt(latest) ? value : latest, "0");
}

async function updateWorkspace(
  ownerEmail: string,
  transform: (state: WorkspaceStateData) => WorkspaceStateData,
) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await getWorkspaceState(ownerEmail);
    const next = transform(current.state);
    if (JSON.stringify(next) === JSON.stringify(current.state)) return current;
    const result = await putWorkspaceState(ownerEmail, next, current.preferences, current.version);
    if (!result.conflict) return result.row;
  }
  throw new Error("Workspace changed repeatedly while automatic decisions were being saved.");
}

/** Proactive engine users get local-day card budgets and their mutes applied. */
async function engineCardPolicy(ownerEmail: string) {
  if (!await proactiveEngineEnabled(ownerEmail).catch(() => false)) return null;
  const [preferences, life] = await Promise.all([getPreferences(ownerEmail), getLifeProfile(ownerEmail)]);
  return { preferences, timeZone: life.profile?.timeZone ?? undefined };
}

export async function mergeDiscoveredDecisions(ownerEmail: string, input: Decision[]) {
  if (!input.length) return [];
  const policy = await engineCardPolicy(ownerEmail);
  const discovered = policy ? input.filter(decision => !mutedByPreferences(decision, policy.preferences)) : input;
  if (!discovered.length) return [];
  let persistedAdditions: Decision[] = [];
  await updateWorkspace(ownerEmail, (state) => {
    const discarded = new Set(state.discardedDecisionIds);
    const startedIds = new Set([...state.tasks.map((task) => task.decisionId), ...state.history.map((entry) => entry.decisionId)]);
    const { refreshedCurrent, unmatchedDiscovered, updatedDecisions } = reconcileDiscoveredConversations(
      state.decisions.filter(activeDecision),
      discovered.filter((decision) => !decision.discoveryUpdatesDecisionId || !startedIds.has(decision.discoveryUpdatesDecisionId)),
    );
    const currentIds = new Set([
      ...refreshedCurrent.map((decision) => decision.id),
      ...state.tasks.map((task) => task.decisionId),
      ...state.history.flatMap((entry) => entry.decisionId ? [entry.decisionId] : []),
    ]);
    const currentFingerprints = new Set(refreshedCurrent.flatMap((decision) => decision.discoveryFingerprint ? [decision.discoveryFingerprint] : []));
    const eligible = unmatchedDiscovered.filter((decision) => (
      activeDecision(decision)
      && !discarded.has(decision.id)
      && !currentIds.has(decision.id)
      && (!decision.discoveryFingerprint || !currentFingerprints.has(decision.discoveryFingerprint))
    ));
    const additions = eligible;
    persistedAdditions = [...additions, ...updatedDecisions];
    const decisions = [...additions, ...refreshedCurrent];
    return JSON.stringify(decisions) === JSON.stringify(state.decisions) ? state : { ...state, decisions };
  });
  if (persistedAdditions.length) {
    await queueDecisionPushNotifications(ownerEmail, persistedAdditions);
    await deliverPendingPushNotifications({ ownerEmail, includeRecent: true }).catch(() => undefined);
  }
  return persistedAdditions;
}

async function proactiveCalendarCards(
  ownerEmail: string,
  events: GoogleEvent[],
  context: { connectionId: string; accountEmail: string },
  prefix: boolean,
  sourceKind: "google" | "device" = "google",
  requestedScan = false,
) {
  // Explicit scans (including signup) remain available; background suggestions are gated.
  if (!requestedScan && !await proactiveEngineEnabled(ownerEmail)) return [];
  const [profile, includeOverlaps] = await Promise.all([
    getLifeProfile(ownerEmail).then((life) => life.profile),
    proactiveEngineEnabled(ownerEmail).catch(() => false),
  ]);
  return discoverProactiveCalendarDecisions({
    events,
    profile,
    context: { ...context, prefixIds: prefix, sourceKind },
    services: defaultProactiveCalendarServices,
    includeOverlaps,
  });
}

async function reconcileCalendarDecisions(
  ownerEmail: string,
  connectionId: string,
  activeCards: Decision[],
) {
  const activeIds = new Set(activeCards.map((decision) => decision.id));
  const policy = await engineCardPolicy(ownerEmail);
  let persistedAdditions: Decision[] = [];
  await updateWorkspace(ownerEmail, (state) => {
    const retained = state.decisions.filter((decision) => !(
      decision.sourceType === "calendar"
      && decision.executionContext?.sourceAccountId === connectionId
      && !activeIds.has(decision.id)
    ));
    const retainedIds = new Set(retained.map((decision) => decision.id));
    const eligible = activeCards.filter((decision) => !retainedIds.has(decision.id) && !state.discardedDecisionIds.includes(decision.id));
    const additions = eligible;
    persistedAdditions = additions;
    if (!additions.length && retained.length === state.decisions.length) return state;
    return { ...state, decisions: [...additions, ...retained] };
  });
  if (persistedAdditions.length) {
    await queueDecisionPushNotifications(ownerEmail, persistedAdditions);
    await deliverPendingPushNotifications({ ownerEmail, includeRecent: true }).catch(() => undefined);
  }
  return persistedAdditions;
}

export const gmailChangeServices = { getGoogleWatchContext, checkDueFollowUp, getGoogleConnectionAccessToken, recordGoogleSourceProcessed, getDiscoveryScanState, fetchGmailHistoryChanges, fetchRecoveryEmailRefs, getWorkspaceState, fetchEmailsByIds, getPrimaryGoogleConnectionId, getLifeProfile, discoveryGuidanceFor, fetchGmailThread, detectSentPromises, discoverDecisionCards, removeDecisions, mergeDiscoveredDecisions, rememberReviewedMessages, send: (event: Parameters<typeof inngest.send>[0]) => inngest.send(event) };

export async function processGmailChange(change: GoogleSourceChange, services = gmailChangeServices) {
  const context = await services.getGoogleWatchContext(change.connectionId);
  if (!context?.enabled) return { skipped: "connection unavailable" };
  if (change.followUpThreadId && change.followUpMessageId) {
    return services.checkDueFollowUp(context.ownerEmail, context.connectionId, change.followUpThreadId, change.followUpMessageId);
  }
  if (!change.historyId) return { skipped: "missing history" };
  const accessToken = await services.getGoogleConnectionAccessToken(context.ownerEmail, context.connectionId);
  if (!accessToken) throw new Error(`Google access for ${context.accountEmail} could not be refreshed.`);
  if (!context.gmailHistoryId) {
    await services.recordGoogleSourceProcessed(context.connectionId, { gmailHistoryId: change.historyId });
    return { skipped: "gmail baseline initialized" };
  }
  if (BigInt(change.historyId) <= BigInt(context.gmailHistoryId)) return { skipped: "notification already processed" };

  const scanStateKey = `${context.ownerEmail}:${context.connectionId}`;
  // Discovery review and source-event side effects have different ownership.
  // A manual scan must not acknowledge a reply transition or a follow-up timer.
  const eventScanStateKey = `${scanStateKey}:google-events`;
  const [priorScanState, priorEventState] = await Promise.all([
    services.getDiscoveryScanState(scanStateKey), services.getDiscoveryScanState(eventScanStateKey),
  ]);
  let history: Awaited<ReturnType<typeof fetchGmailHistoryChanges>>;
  try {
    history = await services.fetchGmailHistoryChanges(accessToken, context.gmailHistoryId);
  } catch (error) {
    if (!(error instanceof GoogleApiError) || error.status !== 404) throw error;
    // History cursors can expire. The bounded discovery list is the safe
    // recovery path and only occurs after that exceptional condition.
    history = { historyId: change.historyId, messages: await services.fetchRecoveryEmailRefs(accessToken) };
  }
  const messageIds = unreviewedGmailMessageIds(history.messages, priorEventState?.reviewedMessageIds ?? []);
  if (!messageIds.length) {
    await services.recordGoogleSourceProcessed(context.connectionId, { gmailHistoryId: latestHistoryId(change.historyId, history.historyId) });
    return { decisions: 0, messages: 0 };
  }

  const [workspace, emails, primaryConnectionId, lifeMemory] = await Promise.all([
    services.getWorkspaceState(context.ownerEmail),
    services.fetchEmailsByIds(accessToken, messageIds),
    services.getPrimaryGoogleConnectionId(context.ownerEmail),
    services.getLifeProfile(context.ownerEmail),
  ]);
  const proactiveGuidance = await services.discoveryGuidanceFor(context.ownerEmail);
  // Inspect only changed threads; use their current tip so a queued incoming
  // notification cannot create a reply after the user already answered.
  const changedThreads: Awaited<ReturnType<typeof fetchGmailThread>>[] = [];
  if (proactiveGuidance) {
    const threadIds = [...new Set(emails.map(email => email.threadId).filter(Boolean))];
    for (let index = 0; index < threadIds.length; index += 5) {
      changedThreads.push(...await Promise.all(threadIds.slice(index, index + 5).map(async threadId => {
        try { return await services.fetchGmailThread(accessToken, threadId); }
        catch (error) { if (error instanceof GoogleApiError && error.status === 404) return []; throw error; }
      })));
    }
  }
  const currentMessages = changedThreads.flatMap(thread => { const last = latestDeliveredMessage(thread); return last ? [last] : []; })
    .filter(message => !priorEventState?.reviewedMessageIds.includes(message.id));
  const accountCards = workspace.state.decisions.filter(decision => decision.executionContext?.sourceAccountId === context.connectionId
    || (!decision.executionContext?.sourceAccountId && primaryConnectionId === context.connectionId));
  const trackedThreads = new Set(accountCards.map(decision => decision.executionContext?.sourceEmail?.threadId).filter(Boolean));
  const maintenanceMessages = currentMessages.filter(message => accountCards.some(card => card.executionContext?.sourceEmail?.threadId === message.threadId
    && card.executionContext.sourceEmail.messageId !== message.id && !card.activeRunId && !card.result));
  const maintenanceThreads = new Set(maintenanceMessages.map(message => message.threadId));
  const eventMessageIds = new Set(messageIds);
  // Coalesce maintenance per thread, but retain all new inbound evidence. A
  // later FYI (or a sent acknowledgement) cannot erase an earlier obligation.
  const freshIncoming = (proactiveGuidance ? changedThreads.flat() : emails).filter(message => eventMessageIds.has(message.id)
    && senderAddress(message.from) !== context.accountEmail.toLowerCase()
    && !message.labels?.some(label => ['DRAFT', 'SPAM', 'TRASH'].includes(label))
    && !priorScanState?.reviewedMessageIds.includes(message.id)
    && !maintenanceThreads.has(message.threadId));
  const discoveryEmails = proactiveGuidance ? [...maintenanceMessages, ...freshIncoming] : freshIncoming;
  const discoveryThreads = new Set(discoveryEmails.map(message => message.threadId));
  const existingDecisions = scanContext({ ...workspace.state, decisions: accountCards });
  if (proactiveGuidance) {
    const connection = { id: context.connectionId, email: context.accountEmail, accessToken };
    const sent = currentMessages.filter(message => senderAddress(message.from) === context.accountEmail.toLowerCase());
    await services.detectSentPromises(context.ownerEmail, connection, sent.filter(message => !trackedThreads.has(message.threadId) && !discoveryThreads.has(message.threadId)));
    for (const message of sent) {
      const dueAt = followUpAt(message, context.accountEmail);
      if (dueAt) await services.send({
        id: `follow-up:${context.connectionId}:${message.threadId}:${message.id}`,
        name: 'decision-feed/proactive.follow-up.scheduled',
        data: { ownerEmail: context.ownerEmail, connectionId: context.connectionId, threadId: message.threadId, messageId: message.id, dueAt: dueAt.toISOString() },
      });
    }
  }
  const report = await services.discoverDecisionCards({
    proactiveGuidance,
    maintainChangedThreads: Boolean(proactiveGuidance),

    userId: `${context.ownerEmail}:${context.connectionId}`,
    accessToken,
    emails: discoveryEmails,
    evidenceEmails: [
      ...changedThreads.flat(),
      ...emails,
      ...(priorScanState?.recentEmails ?? []).filter((cached) => !emails.some((email) => email.id === cached.id)),
    ].slice(0, 150),
    events: [], // Calendar changes have their own path; Gmail never rechecks them.
    existingDecisions,
    lifeMemory,
    userTimeZone: lifeMemory.profile?.timeZone ?? "UTC",
    temporalContext: createTemporalContext(lifeMemory.profile?.timeZone),
  });
  if (report.failedEmailIds.length) throw new Error(`Automatic Gmail discovery failed for ${report.failedEmailIds.length} message(s).`);
  const prefix = primaryConnectionId !== context.connectionId;
  let decisions = report.decisions.map((decision) => sourceDecision(decision, context, prefix));

  await services.removeDecisions(context.ownerEmail, report.resolvedDecisionIds ?? []);
  await services.mergeDiscoveredDecisions(context.ownerEmail, decisions);
  await services.rememberReviewedMessages(
    scanStateKey,
    [...new Set([...messageIds, ...currentMessages.map(message => message.id), ...report.reviewedEmailIds])],
    emails,
    latestHistoryId(change.historyId, history.historyId),
  );
  await services.rememberReviewedMessages(eventScanStateKey,
    [...new Set([...messageIds, ...currentMessages.map(message => message.id)])], [],
    latestHistoryId(change.historyId, history.historyId));
  await services.recordGoogleSourceProcessed(context.connectionId, { gmailHistoryId: latestHistoryId(change.historyId, history.historyId) });
  return { decisions: decisions.length, messages: emails.length };
}

async function processCalendarChange(change: GoogleSourceChange) {
  const context = await getGoogleWatchContext(change.connectionId);
  if (!context?.enabled) return { skipped: "connection unavailable" };
  if (!await proactiveEngineEnabled(context.ownerEmail)) return { skipped: "proactive disabled" };
  const accessToken = await getGoogleConnectionAccessToken(context.ownerEmail, context.connectionId);
  if (!accessToken) throw new Error(`Google access for ${context.accountEmail} could not be refreshed.`);
  const [events, primaryConnectionId] = await Promise.all([
    fetchUpcomingEvents(accessToken),
    getPrimaryGoogleConnectionId(context.ownerEmail),
  ]);
  const cards = await proactiveCalendarCards(context.ownerEmail, events, context, primaryConnectionId !== context.connectionId);
  await reconcileCalendarDecisions(context.ownerEmail, context.connectionId, cards);
  await recordGoogleSourceProcessed(context.connectionId, {});
  return { decisions: cards.length, events: events.length };
}

export async function processGoogleSourceChange(change: GoogleSourceChange) {
  try {
    return change.source === "gmail" ? await processGmailChange(change) : await processCalendarChange(change);
  } catch (error) {
    await recordGoogleSourceError(change.connectionId, error).catch(() => undefined);
    throw error;
  }
}

export async function processProactiveSweep() {
  if (process.env.PROACTIVE_SWEEP_ENABLED !== "true") return { skipped: "disabled" };
  const owners = await listProactiveProfileOwners();
  let accountCount = 0;
  let eventCount = 0;
  let decisionCount = 0;
  const warnings: string[] = [];
  for (const ownerEmail of owners) {
    if (!await proactiveEngineEnabled(ownerEmail)) continue;
    const connections = await getUsableGoogleConnections(ownerEmail).catch(() => []);
    const primaryConnectionId = connections[0]?.id ?? null;
    for (const connection of connections) {
      try {
        const events = await fetchUpcomingEvents(connection.accessToken);
        const context = { connectionId: connection.id, accountEmail: connection.email };
        const cards = await proactiveCalendarCards(ownerEmail, events, context, connection.id !== primaryConnectionId);
        const additions = await reconcileCalendarDecisions(ownerEmail, connection.id, cards);
        accountCount += 1;
        eventCount += events.length;
        decisionCount += additions.length;
      } catch (error) {
        warnings.push(`${ownerEmail}:${connection.email}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { ownerCount: owners.length, accountCount, eventCount, decisionCount, warnings: warnings.slice(0, 50) };
}

export async function processManualGoogleScan(input: {
  ownerEmail: string;
  forceFullScan?: boolean;
  userTimeZone?: string;
  deviceCalendarEvents?: GoogleEvent[];
}) {
  const connections = await getUsableGoogleConnections(input.ownerEmail);
  const icloudCheck = await (await import("../mail/icloud-scan")).scanConnectedICloud(input.ownerEmail, input.forceFullScan);
  const icloud = icloudCheck.results;
  const deviceEvents = (input.deviceCalendarEvents ?? []).slice(0, 500);
  if (!connections.length && !deviceEvents.length && !icloudCheck.accountCount) {
    throw new Error("Connect Gmail, Google Calendar, or Apple Calendar before scanning.");
  }

  const temporalContext = createTemporalContext(input.userTimeZone);
  const lifeMemory = await getLifeProfile(input.ownerEmail);
  const primaryConnectionId = connections[0]?.id ?? null;
  const warnings: string[] = [...icloudCheck.warnings];
  let scannedEmailCount = icloud.reduce((count, result) => count + result.scannedEmailCount, 0);
  let analyzedEmailCount = icloud.reduce((count, result) => count + result.analyzedEmailCount, 0);
  let scannedCalendarEventCount = 0;
  let decisionCount = icloud.reduce((count, result) => count + result.decisionCount, 0);

  for (const connection of connections) {
    try {
      const workspace = await getWorkspaceState(input.ownerEmail);
      const existingDecisions = scanContext(workspace.state);
      const scanStateKey = `${input.ownerEmail}:${connection.id}`;
      const [refs, events, historyId, priorScanState] = await Promise.all([
        fetchDiscoveryEmailRefs(connection.accessToken),
        fetchUpcomingEvents(connection.accessToken),
        fetchGmailProfileHistoryId(connection.accessToken).catch(() => null),
        getDiscoveryScanState(scanStateKey).catch(() => null),
      ]);
      const reviewedIds = new Set(input.forceFullScan ? [] : priorScanState?.reviewedMessageIds ?? []);
      const emailIds = refs.map((ref) => ref.id).filter((id) => !reviewedIds.has(id));
      const emails = emailIds.length ? await fetchEmailsByIds(connection.accessToken, emailIds) : [];
      scannedEmailCount += emails.length;
      analyzedEmailCount += emails.length;
      scannedCalendarEventCount += events.length;

      const prefix = connection.id !== primaryConnectionId;
      const source = { connectionId: connection.id, accountEmail: connection.email };
      let progressiveSaveQueue = Promise.resolve();
      const report = await discoverDecisionCards({
        proactiveGuidance: await discoveryGuidanceFor(input.ownerEmail),

        userId: scanStateKey,
        accessToken: connection.accessToken,
        emails,
        evidenceEmails: [
          ...emails,
          ...(priorScanState?.recentEmails ?? []).filter((cached) => !emails.some((email) => email.id === cached.id)),
        ].slice(0, 150),
        events,
        existingDecisions,
        lifeMemory,
        userTimeZone: temporalContext.userTimeZone,
        temporalContext,
        onDecision: (decision) => {
          const sourced = sourceDecision(decision, source, prefix);
          progressiveSaveQueue = progressiveSaveQueue.then(async () => {
            await mergeDiscoveredDecisions(input.ownerEmail, [sourced]);
          });
        },
      });
      await progressiveSaveQueue;
      let emailCards = report.decisions.map((decision) => sourceDecision(decision, source, prefix));
      if (report.failedEmailIds.length) {
        warnings.push(`${report.failedEmailIds.length} message(s) for ${connection.email} failed the full discovery route and will be retried instead of producing fallback cards.`);
      }
      const calendarCards = await proactiveCalendarCards(input.ownerEmail, events, source, prefix, "google", true);
      await mergeDiscoveredDecisions(input.ownerEmail, emailCards);
      await reconcileCalendarDecisions(input.ownerEmail, connection.id, calendarCards);
      decisionCount += emailCards.length + calendarCards.length;
      if (historyId) {
        const failedIds = new Set(report.failedEmailIds);
        await rememberReviewedMessages(
          scanStateKey,
          report.reviewedEmailIds.filter((id) => !failedIds.has(id)),
          emails,
          historyId,
        );
      }
    } catch (error) {
      warnings.push(`${connection.email} could not be scanned: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (deviceEvents.length) {
    const context = { connectionId: "apple-calendar", accountEmail: "Apple Calendar" };
    const cards = await proactiveCalendarCards(input.ownerEmail, deviceEvents, context, true, "device", true);
    await mergeDiscoveredDecisions(input.ownerEmail, cards);
    scannedCalendarEventCount += deviceEvents.length;
    decisionCount += cards.length;
  }

  if (warnings.length - icloudCheck.warnings.length === connections.length && !deviceEvents.length && !icloud.length) throw new Error(warnings.join(" "));
  return {
    scannedAt: new Date().toISOString(),
    connectedGoogleAccountCount: connections.length,
    connectedICloudAccountCount: icloud.length,
    scannedEmailCount,
    analyzedEmailCount,
    scannedCalendarEventCount,
    decisionCount,
    warnings,
  };
}
