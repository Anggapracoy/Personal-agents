import { artifactResponse } from "../../../../../../lib/harness/artifact-response";
import { getRunStore } from "../../../../../../lib/harness/store";
import { getOwnedRunSnapshot } from "../../../../../../lib/auth/session";

export async function GET(request: Request, context: { params: Promise<{ id: string; artifactId: string }> }) {
  const { id, artifactId } = await context.params;
  const owned = await getOwnedRunSnapshot(id);
  if (owned.status === 401) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!owned.snapshot) return Response.json({ error: "Artifact not found" }, { status: 404 });
  const artifact = await getRunStore().getArtifact(artifactId, id);
  if (!artifact) return Response.json({ error: "Artifact not found" }, { status: 404 });
  return artifactResponse(request, artifact);
}

export const HEAD = GET;
