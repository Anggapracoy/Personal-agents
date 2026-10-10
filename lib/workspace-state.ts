import { recoverWorkspaceRuns } from "./workspace-run-recovery";
import type { AgentRun, AgentAction } from "./harness/types";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { mobileUserStates, workspaceStates } from "../db/schema";
import { reconcileConversationIdentities } from "./conversation-identity";
import type { WorkspacePreferences, WorkspaceStateData } from "./types";

const emptyWorkspaceState: WorkspaceStateData = {
  decisions: [],
  tasks: [],
  history: [],
  discardedDecisionIds: [],
};

const defaultWorkspacePreferences: WorkspacePreferences = {
  appearance: "system",
  modelSettings: {
    provider: "google",
    modelId: "gemini-3.7-flash",
    reasoningEffort: "medium",
    defaultVersion: 4,
  },
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

async function withSavedConversationIdentities(ownerEmail: string, state: WorkspaceStateData, db = getDb()) {
  const runIds = [...new Set([...state.decisions.flatMap(item => item.activeRunId ? [item.activeRunId] : []), ...state.tasks.flatMap(item => item.runId ? [item.runId] : []), ...state.history.flatMap(item => item.runId ? [item.runId] : [])])]
    .filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  const decisionIds = [...new Set([...state.decisions.map(item => item.id), ...state.tasks.map(item => item.decisionId), ...state.history.flatMap(item => item.decisionId ? [item.decisionId] : [])])];
  if (!runIds.length && !decisionIds.length) return state;
  const identities = await db.execute<{ id: string; decisionId: string | null; title: string; category: string }>(sql`
    select id, decision_id as "decisionId", title, category from agent_runs
    where user_id=${ownerEmail} and metadata->>'conversationIdentityGenerated'='true'
      and (${runIds.length ? sql`id in (${sql.join(runIds.map(id => sql`${id}`), sql`, `)})` : sql`false`}
        or ${decisionIds.length ? sql`decision_id in (${sql.join(decisionIds.map(id => sql`${id}`), sql`, `)})` : sql`false`})
    order by created_at`);
  return reconcileConversationIdentities(state, identities);
}

async function withMissingActiveRuns(owner: string, state: WorkspaceStateData, db = getDb()) {
  const rows = await db.execute<AgentRun & { pendingAction: AgentAction | null }>(sql`
    select r.id, r.user_id as "userId", r.decision_id as "decisionId", r.category, r.title, r.request,
      r.status, r.metadata, r.updated_at as "updatedAt", a.action as "pendingAction"
    from agent_runs r
    left join lateral (
      select jsonb_build_object('id',id,'toolName',tool_name,'input',input,'preview',preview) as action
      from agent_actions where run_id=r.id and tool_name='apple_device' and status in ('proposed','approved')
      order by created_at desc limit 1
    ) a on true
    where r.user_id=${owner} and r.metadata->>'sourceType'='manual'
      and (r.status in ('planning','running','awaiting_approval','paused')
        or (r.status in ('done','failed') and r.metadata->>'workspacePublicationPending'='true'))
      and coalesce(r.metadata->>'runPreparationPending','false')<>'true'
      and not exists (select 1 from agent_runs newer where newer.user_id=r.user_id
        and newer.decision_id=r.decision_id and newer.created_at>r.created_at)
    order by r.created_at desc limit 100`);
  return recoverWorkspaceRuns(state, rows.map(row => ({ ...row, updatedAt: new Date(row.updatedAt).toISOString() })));
}

/** Save a chat before dispatch, independent of the client's delayed autosave. */
export async function publishCreatedRun(run: AgentRun, db = getDb()) {
  const task = recoverWorkspaceRuns(emptyWorkspaceState, [run]).tasks[0];
  if (!task) return;
  await db.execute(sql`insert into workspace_states(owner_email,state_json,preferences_json,version)
    values (${normalizeEmail(run.userId)},${JSON.stringify({ ...emptyWorkspaceState, tasks: [task] })}::jsonb,
      ${JSON.stringify(defaultWorkspacePreferences)}::jsonb,1)
    on conflict(owner_email) do update set
      state_json=jsonb_set(workspace_states.state_json,'{tasks}',
        coalesce(workspace_states.state_json->'tasks','[]'::jsonb) || ${JSON.stringify([task])}::jsonb),
      version=workspace_states.version+1,updated_at=now()
    where not exists(select 1 from jsonb_array_elements(coalesce(workspace_states.state_json->'tasks','[]'::jsonb)) t where t->>'runId'=${run.id})`);
}

export async function getWorkspaceState(ownerEmailInput: string, db = getDb()) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const [row] = await db.select().from(workspaceStates)
    .where(eq(workspaceStates.ownerEmail, ownerEmail)).limit(1);
  if (!row) {
    return {
      exists: false as const,
      state: await withMissingActiveRuns(ownerEmail, emptyWorkspaceState, db),
      preferences: defaultWorkspacePreferences,
      version: 0,
      updatedAt: null,
    };
  }
  return {
    exists: true as const,
    state: await withMissingActiveRuns(ownerEmail, await withSavedConversationIdentities(ownerEmail, row.state, db), db),
    preferences: row.preferences,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function putWorkspaceState(
  ownerEmailInput: string,
  state: WorkspaceStateData,
  preferences: WorkspacePreferences,
  expectedVersion: number,
  db = getDb(),
) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  state = await withMissingActiveRuns(ownerEmail, await withSavedConversationIdentities(ownerEmail, state, db), db);
  const now = new Date();
  if (expectedVersion === 0) {
    const inserted = await db.insert(workspaceStates).values({
      ownerEmail,
      state,
      preferences,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().returning();
    if (inserted[0]) return { conflict: false as const, row: inserted[0] };
    return { conflict: true as const, current: await getWorkspaceState(ownerEmail, db) };
  }

  const updated = await db.update(workspaceStates).set({
    state,
    // Conversation actions have their own atomic endpoint. A stale autosave must
    // never clear a pin, archive flag, or user-assigned title.
    preferences: sql`${JSON.stringify(preferences)}::jsonb || jsonb_build_object('conversations', coalesce(${workspaceStates.preferences}->'conversations', '{}'::jsonb), 'firstSuggestionsHintSeen', coalesce(${workspaceStates.preferences}->'firstSuggestionsHintSeen', 'false'::jsonb))`,
    version: sql`${workspaceStates.version} + 1`,
    updatedAt: now,
  }).where(sql`${workspaceStates.ownerEmail} = ${ownerEmail} AND ${workspaceStates.version} = ${expectedVersion}`)
    .returning();
  if (updated[0]) return { conflict: false as const, row: updated[0] };
  return { conflict: true as const, current: await getWorkspaceState(ownerEmail, db) };
}


export async function getOnboardingStatus(ownerEmailInput: string) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const [row] = await getDb().select({
    completed: mobileUserStates.onboardingCompleted,
    profileVersion: mobileUserStates.onboardingProfileVersion,
  }).from(mobileUserStates).where(eq(mobileUserStates.ownerEmail, ownerEmail)).limit(1);
  return {
    completed: row?.completed ?? false,
    profileVersion: row?.profileVersion ?? 0,
  };
}

export async function setOnboardingCompleted(ownerEmailInput: string, completed: boolean) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const now = new Date();
  const [row] = await getDb().insert(mobileUserStates).values({
    ownerEmail,
    onboardingCompleted: completed,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: mobileUserStates.ownerEmail,
    set: { onboardingCompleted: completed, updatedAt: now },
  }).returning({ completed: mobileUserStates.onboardingCompleted });
  return row?.completed ?? completed;
}

export async function requestInitialSignupScan(ownerEmailInput: string) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const now = new Date();
  const [row] = await buildInitialSignupScanRequest(getDb(), ownerEmail, now);
  return Boolean(row && !row.onboardingCompleted && row.requestedAt && !row.completedAt);
}

export function buildInitialSignupScanRequest(
  database: Pick<ReturnType<typeof getDb>, "insert">,
  ownerEmail: string,
  now: Date,
) {
  return database.insert(mobileUserStates).values({
    ownerEmail,
    onboardingCompleted: false,
    initialScanRequestedAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: mobileUserStates.ownerEmail,
    set: {
      initialScanRequestedAt: sql`CASE
        WHEN ${mobileUserStates.onboardingCompleted} = false
          AND ${mobileUserStates.initialScanCompletedAt} IS NULL
        THEN COALESCE(${mobileUserStates.initialScanRequestedAt}, excluded.initial_scan_requested_at)
        ELSE ${mobileUserStates.initialScanRequestedAt}
      END`,
      updatedAt: now,
    },
  }).returning({
    onboardingCompleted: mobileUserStates.onboardingCompleted,
    requestedAt: mobileUserStates.initialScanRequestedAt,
    completedAt: mobileUserStates.initialScanCompletedAt,
  });
}

export async function claimInitialSignupScan(ownerEmailInput: string) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000);
  const [row] = await getDb().update(mobileUserStates).set({
    initialScanStartedAt: now,
    updatedAt: now,
  }).where(and(
    eq(mobileUserStates.ownerEmail, ownerEmail),
    isNotNull(mobileUserStates.initialScanRequestedAt),
    isNull(mobileUserStates.initialScanCompletedAt),
    or(
      isNull(mobileUserStates.initialScanStartedAt),
      lt(mobileUserStates.initialScanStartedAt, staleBefore),
    ),
  )).returning({ startedAt: mobileUserStates.initialScanStartedAt });
  return Boolean(row?.startedAt);
}

export async function completeInitialSignupScan(ownerEmailInput: string) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const now = new Date();
  const [row] = await getDb().update(mobileUserStates).set({
    initialScanCompletedAt: now,
    updatedAt: now,
  }).where(and(
    eq(mobileUserStates.ownerEmail, ownerEmail),
    isNotNull(mobileUserStates.initialScanRequestedAt),
    isNull(mobileUserStates.initialScanCompletedAt),
  )).returning({ completedAt: mobileUserStates.initialScanCompletedAt });
  return Boolean(row?.completedAt);
}

export async function retryInitialSignupScan(ownerEmailInput: string) {
  const ownerEmail = normalizeEmail(ownerEmailInput);
  const [row] = await getDb().update(mobileUserStates).set({
    initialScanStartedAt: null,
    updatedAt: new Date(),
  }).where(and(
    eq(mobileUserStates.ownerEmail, ownerEmail),
    isNotNull(mobileUserStates.initialScanRequestedAt),
    isNull(mobileUserStates.initialScanCompletedAt),
  )).returning({ requestedAt: mobileUserStates.initialScanRequestedAt });
  return Boolean(row?.requestedAt);
}
