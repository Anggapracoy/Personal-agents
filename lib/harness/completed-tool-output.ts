import type { JSONValue } from "ai";
import type { AgentMessage, AgentRun } from "./types";

const LARGE_OUTPUT = 2_000;

export function completedToolHistoryPatch(run: AgentRun, throughSeq: number): Record<string, number> {
  return run.status === "done" && run.result?.outcome !== "needs_user" ? { completedToolHistorySeq: Math.max(Number(run.metadata.completedToolHistorySeq ?? 0), throughSeq) } : {};
}

function replaceDuplicate(value: JSONValue, snapshot: string, depth = 0): JSONValue {
  if (value === snapshot) return "[Duplicate historical snapshot omitted; use read_tool_result.]";
  if (depth >= 12 || value === null) return value;
  if (Array.isArray(value)) return value.map(item => replaceDuplicate(item, snapshot, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === undefined ? undefined : replaceDuplicate(item, snapshot, depth + 1)]));
  return value;
}

/** A fixed completion boundary, never an age/window within an active task.
 * Only model input is changed; every stored message remains the original. */
export function trimCompletedToolOutput(rows: AgentMessage[], throughSeq: unknown): AgentMessage[] {
  if (typeof throughSeq !== "number" || !Number.isSafeInteger(throughSeq) || throughSeq <= 0) return rows;
  return rows.map(row => {
    if (row.seq > throughSeq || row.message.role !== "tool") return row;
    const content = row.message.content.map(part => {
      if (part.type !== "tool-result" || part.output.type !== "json") return part;
      const browser = part.toolName.startsWith("browser_");
      const terminal = part.toolName === "sandbox_run";
      const original = part.output.value;
      if ((!browser && !terminal) || !original || typeof original !== "object" || Array.isArray(original)) return part;
      const value: Record<string, JSONValue | undefined> = { ...original };
      const fields: string[] = [];
      if (browser && typeof value.snapshot === "string" && value.snapshot.length > LARGE_OUTPUT) {
        const snapshot = value.snapshot;
        delete value.snapshot;
        delete value.browserSnapshotContext;
        if (value.printed !== undefined) value.printed = replaceDuplicate(value.printed, snapshot);
        fields.push("snapshot");
      }
      if (terminal) for (const field of ["stdout", "stderr"] as const) {
        const text = value[field];
        // Keep failure diagnostics intact; large ordinary logs get exact previews.
        if (typeof text !== "string" || text.length <= LARGE_OUTPUT || (field === "stderr" && value.$toolError === true)) continue;
        value[field] = `${text.slice(0, 400)}\n[${text.length - 1200} characters omitted from completed-task log; use read_tool_result.]\n${text.slice(-800)}`;
        fields.push(field);
      }
      if (!fields.length) return part;
      value.archivedOutput = {
        messageId: row.id, toolCallId: part.toolCallId, fields,
        note: "Historical output from completed work. Full original is available through read_tool_result; omitted details are not evidence of success.",
      };
      return { ...part, output: { ...part.output, value } };
    });
    return { ...row, message: { ...row.message, content } };
  });
}
