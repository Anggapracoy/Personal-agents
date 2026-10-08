import { getRunStore } from "../harness/store";

/** Authorization for callers that do not need actions or artifact metadata. */
export async function getOwnedRun(runId: string, session: { user?: { email?: string | null } } | null) {
  const email = session?.user?.email?.trim().toLowerCase() ?? null;
  if (!email) return { email: null, run: null, status: 401 as const };
  const run = await getRunStore().getRun(runId);
  if (!run || run.userId.toLowerCase() !== email) return { email, run: null, status: 404 as const };
  return { email, run, status: 200 as const };
}
