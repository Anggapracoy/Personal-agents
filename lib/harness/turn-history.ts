import { attachSharedIntakeFiles } from "./shared-intake-files";
import { isRuntimeMessage } from "./runtime-message";
import type { AgentRun, RunStore } from "./types";

/** Read once after attaching files, so history and its task clock agree. */
export async function loadTurnHistory(store: RunStore, run: AgentRun, attachFiles = attachSharedIntakeFiles) {
  const attachedRun = await attachFiles(store, run);
  const snapshot = await store.getTurnSnapshot(run.id);
  if (!snapshot) throw new Error("Conversation no longer exists.");
  const messages = snapshot.messages;
  const latestUser = messages.findLast(item => item.message.role === "user" && !isRuntimeMessage(item.message));
  return {
    run: attachedRun,
    messages,
    snapshot,
    taskStartedAt: Date.parse(latestUser?.createdAt ?? run.createdAt) || Date.now(),
  };
}
