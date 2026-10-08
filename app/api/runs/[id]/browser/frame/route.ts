import { getOwnedRunSnapshot } from "../../../../../../lib/auth/session";
import { getCloudBrowser } from "../../../../../../lib/harness/browser/registry";
import { getRunStore } from "../../../../../../lib/harness/store";

function frameResponse(bytes: Uint8Array, source: "live" | "recorded") {
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, no-store, max-age=0",
      "x-wdyt-browser-frame": source,
    },
  });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await getOwnedRunSnapshot(id);
  if (owned.status === 401) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!owned.snapshot || !owned.email) return Response.json({ error: "Run not found" }, { status: 404 });
  try {
    // Frame requests can land in a different server process than the runner.
    // Reconnect to the existing Browserless session through its private controller.
    if (!owned.snapshot.actions.some(action => action.toolName.startsWith("browser_"))) throw new Error("This task has not opened a browser.");
    const bytes = await getCloudBrowser(owned.email, id).screenshot(owned.email);
    return frameResponse(bytes, "live");
  } catch (liveError) {
    // A browser sandbox can be reconnecting or already paused while its durable
    // run remains visible. Preserve observability by serving the newest frame
    // captured from an executed browser action instead of returning an empty UI.
    const browserActionIds = new Set(owned.snapshot.actions
      .filter((action) => action.toolName.startsWith("browser_") && action.status === "executed")
      .map((action) => action.id));
    const browserArtifacts = owned.snapshot.artifacts.filter((artifact) => (
      artifact.mimeType === "image/png"
      && Boolean(artifact.actionId)
      && browserActionIds.has(artifact.actionId!)
    ));
    const latestFrame = [...browserArtifacts].reverse().find((artifact) => artifact.name.startsWith("browser-frame-"))
      ?? browserArtifacts.at(-1);
    if (latestFrame) {
      const artifact = await getRunStore().getArtifact(latestFrame.id, id);
      if (artifact) return frameResponse(Buffer.from(artifact.bytesBase64, "base64"), "recorded");
    }
    return Response.json({ error: liveError instanceof Error ? liveError.message : "Cloud browser frame is unavailable." }, { status: 503 });
  }
}
