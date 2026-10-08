import { Inngest } from "inngest";
import { AGENT_APP_ID } from "./inngest-config";

// Event producers must not import registered jobs or the model/browser runtime.
export const inngest = new Inngest({
  id: AGENT_APP_ID,
  appVersion: process.env.VERCEL_GIT_COMMIT_SHA,
  // Keep eager execution below the /api/inngest 300-second invocation limit.
  // Checkpoint every step; do not buffer external mutations across checkpoints.
  checkpointing: { maxRuntime: "270s", bufferedSteps: 1 },
});
