import { tool } from "ai";
import { ApprovalRequiredError, RunStoppedError, durableActionReceiptKey } from "../harness/actions";
import type { RunStore } from "../harness/types";
import { sendAppleActionWakePush } from "../push-notifications";
import { appleOperationIsRead, appleOperationRunsInBackground, appleSources } from "./catalog";
import { appleRequestSchema, validateAppleRequest, type AppleRequest } from "./contract";
export async function requestAppleAction(input: { runId: string; stepId: string; store: RunStore; signal?: AbortSignal }, args: AppleRequest) {
  validateAppleRequest(args);
  const run = await input.store.getRun(input.runId);
  if (input.signal?.aborted || !run || ["cancelled", "failed", "done", "paused", "awaiting_approval"].includes(run.status)) throw new RunStoppedError();
  const scopeId = typeof run.metadata.actionScopeId === "string" ? run.metadata.actionScopeId : null;
  const read = appleOperationIsRead(args.operation);
  const identity = durableActionReceiptKey("apple_device", { operation: args.operation, parameters: args.parameters });
  let action = [...((await input.store.getSnapshot(input.runId))?.actions ?? [])].reverse().find(item => item.toolName === "apple_device" && item.status !== "rejected" && (item.scopeId ?? null) === scopeId && durableActionReceiptKey("apple_device", { operation: item.input.operation, parameters: item.input.parameters }) === identity) ?? null;
  if (action && action.stepId !== input.stepId && ((read && action.status === "executed") || (action.status === "failed" && (read || action.result?.retryable === true)))) action = null;
  if (action?.status === "executed") return action.result ?? {};
  if (action?.status === "failed") return { $toolError: true, ...action.result };
  const created = !action;
  action ??= await input.store.createAction({ runId: input.runId, stepId: input.stepId, scopeId, toolName: "apple_device", risk: read ? "read" : "write_external", input: args, preview: `${args.purpose}\nOpen Dash on your iPhone to continue.` });
  await input.store.updateRun(input.runId, { status: "awaiting_approval" });
  if (created && appleOperationRunsInBackground(args.operation)) await sendAppleActionWakePush({ ownerEmail: run.userId, runId: input.runId, actionId: action.id, operation: args.operation }).catch(() => undefined);
  throw new ApprovalRequiredError(action);
}
export function createAppleTools(input: { runId: string; stepId: string; store: RunStore; signal?: AbortSignal }) {
  return { apple_device: tool({
    description: `Use an Apple source on the user's iPhone. If the needed source is disconnected, still call this tool with the intended operation: the conversation will show an inline Connect option, request permission there, and continue this exact action automatically after consent. Do not send the user to Dash Settings or ask a separate connection question. The current Apple source snapshot in your instructions tells you what is connected; this tool being available does not mean all sources are connected. This tool pauses the run until the iPhone returns a real result; call it alone and stop. Never claim success from a pending request. Sources are opt-in and device-specific; errors explain disconnected, denied or unavailable access. Requested reads and changes, including Health operations, run directly when the conversation opens on the connected phone. Do not ask for a separate action approval; the user only needs to connect a disconnected source and grant its system permission. When describing a source or reporting a completed action, say where its result appears using the source descriptions below. In particular, always clarify on alarm/timer creation that it rings on the iPhone but is managed through Dash and does not appear in Apple Clock. Do not imply that read-only answers launch or modify the corresponding Apple app.
Source behavior and destinations:
${appleSources.map(source => `${source.name}: ${source.detail}`).join("\n")}
Dates are ISO 8601 with timezone. IDs must come from earlier results. Parameters by operation:
reminders.lists {}; reminders.list {listId?,query?,completed?,limit?}; reminders.create {title,listId?,text?,date?}; reminders.update {id,title?,text?,date?}; reminders.complete {id,completed}.
contacts.search {query,limit?}; contacts.create {givenName,familyName?,email?,phone?}; contacts.update {id,givenName?,familyName?,email?,phone?} (email/phone replace that field).
files.list {}; files.read {path}; files.write {path,text,overwrite?}. Paths are relative to the user-selected folder. Read supports text and PDF, write UTF-8 text. No whole-iCloud access.
photos.list {start?,end?,limit?}; photos.read {id} returns image text and a preview; photos.albums {}; photos.save {artifactId} saves an image artifact from this run to Photos (use a real artifact id returned by sandbox_run); photos.createAlbum {title}; photos.addToAlbum {id,albumId}.
health.summary {start,end} reads permitted steps, sleep, active energy, water; health.workouts {start,end,limit?}; health.logWater {milliliters,date?}. Only use for user-requested health/fitness purposes. Empty data does not establish permission or absence of activity.
home.list {} returns accessory metadata and cached values; home.read {id} reads a current characteristic value (use it before reporting current state); home.scene {id}; home.set {id,value} for a writable characteristic from home.list.
music.search {query,limit?}; music.library {limit?}; music.createPlaylist {title,text?,songIds?}; music.addToLibrary {id} adds one catalog song to the user library; music.addToPlaylist {id,songIds}; music.play {id}; music.pause {}. Use catalog song IDs from search; playback may require Apple Music.
location.current {} (foreground only); maps.search {query,latitude?,longitude?,limit?}; maps.directions {latitude,longitude,destinationLatitude,destinationLongitude,transport?} transport walking/automobile; weather.forecast {latitude,longitude}.
alarms.list {}; alarms.create {title,date} for one-time or {title,weekdays,hour,minute} for weekly repeats (full weekday names, current iPhone timezone); alarms.timer {title,seconds}; alarms.cancel {id}. Only Dash alarms, iOS 26+. motion.summary {start,end}. No background location triggers and no Clock history. Reminders and Contacts reads, Maps, Weather and Motion can finish in the background while the phone is on and iOS allows it; all changes, and every other source, wait until the user opens Dash.`,
    inputSchema: appleRequestSchema,
    execute: (args) => requestAppleAction(input, args),
  }) };
}
