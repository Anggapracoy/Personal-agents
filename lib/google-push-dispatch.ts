import { getGoogleWatchContext } from "./google-push";
import type { GoogleSourceChange } from "./discovery/google-push-worker";

export async function dispatchGoogleSourceChange(change: GoogleSourceChange) {
  if (process.env.INNGEST_EVENT_KEY) {
    const { inngest } = await import("./harness/inngest-client");
    await inngest.send({
      name: "decision-feed/google.source.changed",
      data: { ...change, ownerEmail: (await getGoogleWatchContext(change.connectionId))?.ownerEmail },
    });
    return { queued: true };
  }

  // Local development works without an Inngest account. Production should
  // configure Inngest so webhook acknowledgement stays fast and retries are durable.
  const { processGoogleSourceChange } = await import("./discovery/google-push-worker");
  return processGoogleSourceChange(change);
}
