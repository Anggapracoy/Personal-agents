import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resultSchema, presentResultInputSchema } from "../lib/harness/result-schema";

const root = "artifacts/muse-browser-final";
const rows: Array<Record<string, unknown>> = [];
for (const task of readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
  const path = `${root}/${task.name}/muse-spark-1.3-medium/run-1/messages.json`;
  const messages = JSON.parse(readFileSync(path, "utf8"));
  for (const record of messages) {
    const message = record.message ?? record;
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type !== "tool-call" || part.toolName !== "present_result") continue;
      const input = typeof part.input === "string" ? JSON.parse(part.input) : part.input;
      const before = resultSchema.safeParse(input);
      const after = presentResultInputSchema.safeParse(input);
      rows.push({ task: task.name, callId: part.toolCallId, beforeAccepted: before.success, afterAccepted: after.success,
        beforeErrors: before.success ? [] : before.error.issues.map(issue => ({ path: issue.path, code: issue.code })),
        afterErrors: after.success ? [] : after.error.issues.map(issue => ({ path: issue.path, code: issue.code })),
      });
    }
  }
}
const result = { calls: rows.length, previouslyRejected: rows.filter(row => !row.beforeAccepted).length, nowRejected: rows.filter(row => !row.afterAccepted).length, rows };
mkdirSync("artifacts/browser-capabilities", { recursive: true });
writeFileSync("artifacts/browser-capabilities/formatting-replay.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
