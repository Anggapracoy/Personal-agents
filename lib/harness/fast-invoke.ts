import { randomUUID } from "node:crypto";
import { AGENT_APP_ID, AGENT_FUNCTION_ID } from "./inngest-config";

type InvokeResult = "accepted" | "unavailable" | "uncertain";
type InvokeOptions = {
  signingKey?: string;
  enabled: boolean;
  fetcher?: typeof fetch;
};

/** Start the existing durable worker; a response is an admission receipt, not completion. */
export async function fastInvokeAgent(runId: string, key: string | undefined, options: InvokeOptions): Promise<InvokeResult> {
  if (!options.enabled || !options.signingKey) return "unavailable";
  const fetcher = options.fetcher ?? fetch;
  const body = JSON.stringify({ data: { runId }, idempotencyKey: key ?? randomUUID() });
  let uncertain = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(`https://api.inngest.com/v2/apps/${AGENT_APP_ID}/functions/${AGENT_FUNCTION_ID}/invoke`, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.signingKey}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(3_000),
        redirect: "error",
      });
      // Live API returns 200; the spec also documents 201/202. A duplicate
      // returns 409, sometimes with a placeholder run ID, but is still admitted.
      if (response.status === 409) return "accepted";
      if (response.ok) {
        const result = await response.json() as { data?: { runId?: unknown } };
        if (typeof result.data?.runId === "string" && result.data.runId) return "accepted";
      } else if ([401, 403, 404, 429].includes(response.status)) {
        // Only a definitive rejection before any ambiguous attempt permits
        // event fallback. An earlier timeout may already have created the run.
        if (!uncertain) return "unavailable";
      } else if (response.status >= 400 && response.status < 500) {
        if (!uncertain) throw new InvokeRejectedError(response.status);
      }
    } catch (error) {
      if (error instanceof InvokeRejectedError) throw error;
    }
    uncertain = true;
  }
  return "uncertain";
}

class InvokeRejectedError extends Error {
  constructor(status: number) { super(`Agent invocation rejected (${status}).`); }
}

export async function dispatchInteractiveAgent(
  runId: string,
  key: string | undefined,
  options: InvokeOptions & { sendEvent: () => Promise<unknown>; onUncertain: () => void },
) {
  const result = await fastInvokeAgent(runId, key, options);
  if (result === "unavailable") await options.sendEvent();
  // Leave the durable chat active. The existing stale-worker recovery can
  // wake it if admission failed; marking it failed could stop an admitted run.
  if (result === "uncertain") options.onUncertain();
  return result !== "uncertain";
}
