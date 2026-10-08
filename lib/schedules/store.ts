import { scheduledNotificationBody } from "./notification-content";
import postgres, { type Sql, type TransactionSql } from "postgres";
import type { ModelMessage } from "ai";
import { localScheduleTime, nextAfterDelivery, nextOccurrence, validateDefinition, type ScheduleDefinition } from "./timing";

export type ScheduledTask = {
  id: string; ownerEmail: string; runId: string; definition: ScheduleDefinition;
  status: "active" | "paused" | "cancelled" | "completed"; version: number;
  nextRunAt: string | null; lastObservation: string | null; lastNotifiedObservation: string | null;
};
export type CheckResult = { completed?: boolean; notify: boolean; observation: string; summary: string };
export type ScheduleExecution = {
  occurrenceId: string; scheduleId: string; kind: "task" | "check";
  instructions: string; notifyPolicy: "always" | "when_relevant";
  lastObservation: string | null; lastNotifiedObservation: string | null;
};
function task(row: Record<string, unknown>): ScheduledTask {
  return { id: String(row.id), ownerEmail: String(row.owner_email), runId: String(row.run_id), definition: row.definition as ScheduleDefinition,
    status: row.status as ScheduledTask["status"], version: Number(row.version), nextRunAt: row.next_run_at ? new Date(row.next_run_at as string).toISOString() : null,
    lastObservation: row.last_observation as string | null, lastNotifiedObservation: row.last_notified_observation as string | null };
}
export function publicSchedule(value: ScheduledTask) {
  return { id: value.id, conversationId: value.runId, ...value.definition, status: value.status, nextRunAt: value.nextRunAt,
    nextRunLocal: value.nextRunAt ? localScheduleTime(value.nextRunAt, value.definition.timeZone) : null };
}

async function appendMessage(sql: TransactionSql, runId: string, message: ModelMessage) {
  // The caller holds the agent_runs row lock, shared with RunStore.appendMessages.
  const [last] = await sql`select coalesce(max(seq),0) as seq from agent_messages where run_id = ${runId}`;
  await sql`insert into agent_messages(run_id,seq,message) values (${runId},${Number(last.seq) + 1},${sql.json(message as never)})`;
}
async function queueNotification(sql: TransactionSql, schedule: ScheduledTask, occurrenceId: string, title: string, body: string) {
  await sql`insert into push_notification_jobs(owner_email,decision_id,title,subtitle,body) values
    (${schedule.ownerEmail},${`run-completed:${schedule.runId}:${occurrenceId}`},${title},${schedule.definition.title},${body.slice(0,220)})
    on conflict(owner_email,decision_id) do nothing`;
}

export class ScheduleStore {
  constructor(readonly sql: Sql) {}
  async create(ownerEmail: string, runId: string, definition: ScheduleDefinition, creationKey: string, now = new Date()) {
    return this.sql.begin(async sql => {
      const [existing] = await sql`select * from scheduled_tasks where owner_email=${ownerEmail} and creation_key=${creationKey}`;
      if (existing) return task(existing);
      const validated = validateDefinition(definition, now);
      const [owned] = await sql`select id from agent_runs where id=${runId} and user_id=${ownerEmail}`;
      if (!owned) throw new Error("Conversation not found.");
      const [row] = await sql`insert into scheduled_tasks(owner_email,run_id,definition,next_run_at,creation_key)
        values (${ownerEmail},${runId},${sql.json(validated as never)},${validated.firstRunAt},${creationKey})
        on conflict(owner_email,creation_key) do update set creation_key=excluded.creation_key returning *`;
      return task(row);
    });
  }
  async list(ownerEmail: string, runId?: string) {
    const rows = runId ? await this.sql`select * from scheduled_tasks where owner_email=${ownerEmail} and run_id=${runId} order by created_at desc limit 100`
      : await this.sql`select * from scheduled_tasks where owner_email=${ownerEmail} order by created_at desc limit 100`;
    return rows.map(task);
  }
  async update(ownerEmail: string, id: string, input: { status?: "active" | "paused" | "cancelled"; definition?: ScheduleDefinition }, now = new Date()) {
    return this.sql.begin(async sql => {
      const [row] = await sql`select * from scheduled_tasks where id=${id} and owner_email=${ownerEmail} for update`;
      if (!row) throw new Error("Schedule not found.");
      const current = task(row);
      const definition = input.definition ? validateDefinition(input.definition, now) : current.definition;
      const status = input.status ?? current.status;
      if (current.status === "cancelled" && status === "active") throw new Error("This schedule was cancelled. Create a new one to restart it.");
      let next = input.definition ? new Date(definition.firstRunAt!) : current.nextRunAt ? new Date(current.nextRunAt) : null;
      if (status === "active" && (!next || next <= now)) {
        if (!definition.recurrence) throw new Error("Choose a new future time to resume this reminder.");
        next = nextOccurrence(definition.recurrence, definition.timeZone, now, new Date(definition.firstRunAt!));
      }
      if (status === "active" && definition.endAt && next && next > new Date(definition.endAt)) throw new Error("This schedule has ended. Choose a new end date.");
      if (status === "cancelled") next = null;
      if (input.definition) await sql`update scheduled_tasks set last_observation=null,last_notified_observation=null where id=${id}`;
      // A running occurrence keeps its captured instructions; queued work is invalidated.
      await sql`update scheduled_occurrences set status='cancelled',completed_at=now() where schedule_id=${id} and status='queued'`;
      const [updated] = await sql`update scheduled_tasks set definition=${sql.json(definition as never)},status=${status},next_run_at=${next?.toISOString() ?? null},version=version+1,updated_at=now() where id=${id} returning *`;
      return task(updated);
    });
  }
  async enqueueDue(now = new Date()) {
    await this.sql.begin(async sql => {
      const rows = await sql`select * from scheduled_tasks s where s.status='active' and s.next_run_at <= ${now.toISOString()}
        and not exists(select 1 from scheduled_occurrences o where o.schedule_id=s.id and o.status in ('queued','dispatched'))
        order by s.next_run_at limit 100 for update skip locked`;
      for (const row of rows) {
        await sql`insert into scheduled_occurrences(schedule_id,schedule_version,due_at) values (${row.id},${row.version},${row.next_run_at}) on conflict do nothing`;
      }
    });
    // Durable outbox: a crash between insertion and sending cannot lose the work.
    return this.sql`select o.id,s.run_id from scheduled_occurrences o join scheduled_tasks s on s.id=o.schedule_id
      join agent_runs r on r.id=s.run_id where o.status='queued' or (o.status='dispatched' and r.status='planning') order by o.created_at limit 100`;
  }
  async prepare(occurrenceId: string, now = new Date()): Promise<{ kind: "skip" | "reminder" | "agent"; runId?: string }> {
    return this.sql.begin(async sql => {
      // Always lock schedule -> occurrence -> conversation, also used by completion.
      const [identity] = await sql`select schedule_id from scheduled_occurrences where id=${occurrenceId}`;
      if (!identity) return { kind: "skip" as const };
      const [row] = await sql`select * from scheduled_tasks where id=${identity.schedule_id} for update`;
      const [occurrence] = await sql`select * from scheduled_occurrences where id=${occurrenceId} for update`;
      if (!row || !occurrence || !["queued","dispatched"].includes(occurrence.status)) return { kind: "skip" as const };
      const schedule = task(row);
      if (occurrence.status === "dispatched") return { kind: "agent" as const, runId: schedule.runId };
      if (schedule.status !== "active" || schedule.version !== occurrence.schedule_version) {
        await sql`update scheduled_occurrences set status='cancelled',completed_at=now() where id=${occurrenceId}`;
        return { kind: "skip" as const };
      }
      const [run] = await sql`select * from agent_runs where id=${schedule.runId} and user_id=${schedule.ownerEmail} for update`;
      if (!run) return { kind: "skip" as const };
      if (schedule.definition.kind === "reminder") {
        const body = `Reminder: ${schedule.definition.instructions}`;
        await appendMessage(sql, schedule.runId, { role: "assistant", content: body });
        // Do not interrupt an active turn or overwrite a result needed for approval.
        if (["done","failed","cancelled"].includes(run.status)) await sql`update agent_runs set response=${body},result=null,status='done',error=null,completed_at=${now.toISOString()},updated_at=${now.toISOString()} where id=${schedule.runId}`;
        else await sql`update agent_runs set updated_at=${now.toISOString()} where id=${schedule.runId}`;
        await queueNotification(sql, schedule, occurrenceId, "Reminder", body);
        await this.completeInTransaction(sql, schedule, occurrence, now);
        return { kind: "reminder" as const, runId: schedule.runId };
      }
      if (!["done","failed","cancelled"].includes(run.status)) return { kind: "skip" as const };
      const execution: ScheduleExecution = { occurrenceId, scheduleId: schedule.id, kind: schedule.definition.kind, instructions: schedule.definition.instructions,
        notifyPolicy: schedule.definition.notifyPolicy, lastObservation: schedule.lastObservation, lastNotifiedObservation: schedule.lastNotifiedObservation };
      const previous = { response: run.response, result: run.result, completedAt: run.completed_at, updatedAt: run.updated_at };
      // Preserve the previous structured receipt before clearing it for this turn.
      if (run.result && run.result.summary !== String(run.response).trim()) {
        const receipt = [run.result.summary,run.result.details].filter(Boolean).join("\n\n");
        const [exists] = await sql`select id from agent_messages where run_id=${schedule.runId} and message->>'role'='assistant' and message->>'content'=${receipt} limit 1`;
        if (!exists) await appendMessage(sql, schedule.runId, { role: "assistant", content: receipt });
      }
      await appendMessage(sql, schedule.runId, { role: "user", content: `[runtime] Scheduled occurrence ${occurrenceId} is due. Execute the scheduled instructions once using fresh evidence. Do not create another schedule.\n${schedule.definition.instructions}` });
      await sql`update agent_runs set status='planning',response='',result=null,error=null,completed_at=null,
        metadata=coalesce(metadata,'{}'::jsonb) || ${sql.json({ scheduleExecution: execution, scheduledCheckResult: null, actionScopeId: occurrenceId } as never)},updated_at=now() where id=${schedule.runId}`;
      await sql`update scheduled_occurrences set status='dispatched',previous_run_state=${sql.json(previous as never)} where id=${occurrenceId}`;
      return { kind: "agent" as const, runId: schedule.runId };
    });
  }
  private async completeInTransaction(sql: TransactionSql, schedule: ScheduledTask, occurrence: Record<string, any>, now: Date, failed = false, completed = false) {
    await sql`update scheduled_occurrences set status=${failed ? "failed" : "completed"},completed_at=${now.toISOString()} where id=${occurrence.id}`;
    if (schedule.version !== Number(occurrence.schedule_version) || schedule.status !== "active") return;
    const next = completed ? null : nextAfterDelivery(schedule.definition, new Date(occurrence.due_at), now);
    await sql`update scheduled_tasks set next_run_at=${next?.toISOString() ?? null},status=${next ? "active" : "completed"},updated_at=now() where id=${schedule.id}`;
  }
  async abandonForUserReply(runId: string, pauseSchedule = false, now = new Date()) {
    return this.sql.begin(async sql => {
      const [initial] = await sql`select metadata from agent_runs where id=${runId}`;
      const execution = initial?.metadata?.scheduleExecution as ScheduleExecution | undefined;
      if (!execution) return;
      const [row] = await sql`select * from scheduled_tasks where id=${execution.scheduleId} for update`;
      const [occurrence] = await sql`select * from scheduled_occurrences where id=${execution.occurrenceId} for update`;
      const [run] = await sql`select * from agent_runs where id=${runId} for update`;
      if (!row || !occurrence || !run || row.run_id !== runId || row.owner_email !== run.user_id || occurrence.schedule_id !== row.id || run.metadata?.scheduleExecution?.occurrenceId !== execution.occurrenceId || occurrence.status !== "dispatched") return;
      await this.completeInTransaction(sql, task(row), occurrence, now);
      if (pauseSchedule) await sql`update scheduled_tasks set status='paused',version=version+1,updated_at=now() where id=${execution.scheduleId} and status='active'`;
      await sql`update agent_runs set metadata=metadata - 'scheduleExecution' - 'scheduledCheckResult' where id=${runId}`;
    });
  }
  async finish(runId: string, now = new Date()) {
    return this.sql.begin(async sql => {
      const [initial] = await sql`select metadata from agent_runs where id=${runId}`;
      const execution = initial?.metadata?.scheduleExecution as ScheduleExecution | undefined;
      if (!execution) return { scheduled: false, notified: false };
      const [row] = await sql`select * from scheduled_tasks where id=${execution.scheduleId} for update`;
      const [occurrence] = await sql`select * from scheduled_occurrences where id=${execution.occurrenceId} for update`;
      const [run] = await sql`select * from agent_runs where id=${runId} for update`;
      if (!row || !occurrence || !run || row.run_id !== runId || row.owner_email !== run.user_id || occurrence.schedule_id !== row.id || run.metadata?.scheduleExecution?.occurrenceId !== execution.occurrenceId || occurrence.status !== "dispatched") return { scheduled: true, notified: false };
      if (["running","planning","paused","awaiting_approval"].includes(run.status)) return { scheduled: true, notified: false };
      const schedule = task(row);
      const check = run.metadata.scheduledCheckResult as CheckResult | undefined;
      const failed = run.status === "failed" || (execution.kind === "check" && run.status !== "cancelled" && !check);
      const completed = run.status === "done" && check?.completed === true
        && schedule.status === "active" && schedule.version === Number(occurrence.schedule_version);
      // Do not announce that an obsolete watch has stopped after the user edited it.
      const supersededCompletion = check?.completed === true
        && (schedule.status !== "active" || schedule.version !== Number(occurrence.schedule_version));
      const summary = scheduledNotificationBody({ failed, error: run.error, disposition: run.metadata.responseDisposition, checkSummary: check?.summary, resultSummary: run.result?.summary, response: run.response });
      const notify = Boolean(summary) && !supersededCompletion && (completed || failed || run.status === "cancelled" || execution.notifyPolicy === "always" || execution.kind !== "check" || check?.notify === true);
      if (notify) await queueNotification(sql, schedule, execution.occurrenceId, failed ? "Scheduled task needs attention" : schedule.definition.title, summary);
      if (check && !failed && schedule.version === Number(occurrence.schedule_version)) {
        await sql`update scheduled_tasks set last_observation=${check.observation},last_notified_observation=${notify ? check.observation : schedule.lastNotifiedObservation} where id=${schedule.id}`;
      }
      if (!notify) {
        const prior = occurrence.previous_run_state;
        await sql`update agent_runs set response=${prior.response ?? ''},result=${prior.result ? sql.json(prior.result) : null},completed_at=${prior.completedAt},updated_at=${prior.updatedAt} where id=${runId}`;
      } else if (failed) {
        await appendMessage(sql, runId, { role: "assistant", content: summary });
        await sql`update agent_runs set response=${summary},result=null,status='failed',error=${summary},updated_at=now() where id=${runId}`;
      }
      await sql`update scheduled_occurrences set check_result=${check ? sql.json(check as never) : null},error=${failed ? summary : null} where id=${execution.occurrenceId}`;
      await this.completeInTransaction(sql, schedule, occurrence, now, failed, completed);
      // Keep actionScopeId for replies/approvals tied to this occurrence, but clear the autonomous context.
      await sql`update agent_runs set metadata=metadata - 'scheduleExecution' - 'scheduledCheckResult',updated_at=case when ${notify} then now() else updated_at end where id=${runId}`;
      return { scheduled: true, notified: notify };
    });
  }
}
let instance: ScheduleStore | undefined;
export function getScheduleStore() {
  if (!process.env.DATABASE_URL) throw new Error("Reminders need persistent storage. They are not available in this environment.");
  return instance ??= new ScheduleStore(postgres(process.env.DATABASE_URL, { prepare: false }));
}
