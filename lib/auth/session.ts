import { auth } from "../../auth";
import { getRunStore } from "../harness/store";

export async function currentUserEmail() {
  const session = await auth();
  return session?.user?.email?.trim().toLowerCase() ?? null;
}

export async function getOwnedRunSnapshot(runId: string, session?: { user?: { email?: string | null } } | null) {
  const email = session === undefined ? await currentUserEmail() : session?.user?.email?.trim().toLowerCase() ?? null;
  if (!email) return { email: null, snapshot: null, status: 401 as const };
  const snapshot = await getRunStore().getSnapshot(runId);
  if (!snapshot || snapshot.userId.toLowerCase() !== email) return { email, snapshot: null, status: 404 as const };
  return { email, snapshot, status: 200 as const };
}
