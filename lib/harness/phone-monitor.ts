import { parseResiaCall, resiaClient } from "./resia";
import { getPauseStore, type PauseStore } from "../pauses/store";

/** Polling happens in a background job, never a model-chosen scheduled wait. */
export async function checkPhoneCall(pauseId: string, deps: { store?: PauseStore; request?: typeof fetch; key?: string } = {}) {
  const store = deps.store ?? getPauseStore();
  const [pause] = await store.phoneCalls(pauseId);
  if (!pause || pause.definition.condition.type !== "phone_call") return { state: "inactive" as const };
  const condition = pause.definition.condition;
  try {
    // Revoking new-call access must not lose the outcome of an already placed call.
    const key = deps.key ?? process.env.RESIA_API_KEY;
    if (!key) throw new Error("The calling service is not configured.");
    const result = parseResiaCall(await resiaClient(key, deps.request)(`/v1/calls/${encodeURIComponent(condition.callId)}`), condition.callId);
    await store.resetCheckFailures(pause.id);
    const ready = await store.savePhoneProgress(pause.id, result);
    return { state: ready ? "ready" as const : "pending" as const, runId: pause.runId };
  } catch {
    if (await store.recordCheckFailure(pause.id) >= 3) {
      await store.markReady(pause.id, { kind: "phone_monitor_failed", callId: condition.callId, message: "The call status could not be checked. This does not mean the call ended or failed. Do not redial; report the monitoring problem and use phone_call_result to inspect fresh evidence." });
      return { state: "ready" as const, runId: pause.runId };
    }
    return { state: "pending" as const, runId: pause.runId };
  }
}
