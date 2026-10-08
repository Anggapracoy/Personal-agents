import assert from "node:assert/strict";
import test from "node:test";
import { agentWorker, manualScanWorker, phoneMonitorWorker } from "../lib/harness/inngest";
import { AGENT_APP_ID, AGENT_FUNCTION_ID } from "../lib/harness/inngest-config";

// Verify what the installed SDK actually registers, not just the source option.
type Configurable = { getConfig(input: { baseUrl: URL; appPrefix: string; isConnect: boolean }): Array<{
  id: string; cancel: Array<{ event: string; if: string }>; concurrency: Array<{ key: string; limit: number }>;
}> };
test("SDK registration preserves cancellation matching for all three workers", () => {
  for (const [worker, field, event] of [
    [agentWorker, "runId", "decision-feed/run.cancelled"],
    [phoneMonitorWorker, "runId", "decision-feed/run.cancelled"],
    [manualScanWorker, "jobId", "decision-feed/manual.scan.cancelled"],
  ] as const) {
    const [config] = (worker as unknown as Configurable).getConfig({ baseUrl: new URL("http://localhost/api/inngest"), appPrefix: AGENT_APP_ID, isConnect: false });
    assert.deepEqual(config.cancel, [{ event, if: `async.data.${field} == event.data.${field}` }]);
  }
  const [config] = (agentWorker as unknown as Configurable).getConfig({ baseUrl: new URL("http://localhost/api/inngest"), appPrefix: AGENT_APP_ID, isConnect: false });
  assert.equal(config.id, `${AGENT_APP_ID}-${AGENT_FUNCTION_ID}`);
  assert.deepEqual(config.concurrency, [{ limit: 1, key: "event.data.runId" }]);
});
