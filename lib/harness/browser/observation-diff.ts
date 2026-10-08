import type { JSONValue, ModelMessage } from "ai";
import type { BrowserSnapshot } from "./cloud";

/** Internal receipt metadata is stripped before model input. Full snapshots stay
 * in durable history, so replay/compaction can always establish a fresh baseline. */
export function browserSnapshotContext(page: BrowserSnapshot) {
  return page.documentId ? {
    version: 1,
    documentId: page.documentId,
    scopeRef: page.scopeRef ?? null,
    complete: Boolean(page.axTree?.length) && !page.warnings?.length,
  } : undefined;
}

type Row = { id: string; line: string; parentId: string | null };
type Tree = { header: string; footer: string; rows: Row[]; byId: Map<string, Row> };
function readTree(text: string): Tree | null {
  const lines = text.split("\n");
  const pattern = /^( *)(e\d+|n\d+(?:_[\w-]+)?) /;
  const start = lines.findIndex(line => pattern.test(line));
  const footer = lines.findIndex(line => line.startsWith("The focused UI element is "));
  if (start < 0 || footer <= start || !lines[0].startsWith("Browser: ")) return null;
  const rows: Row[] = [];
  const byId = new Map<string, Row>();
  const parents: Array<{ id: string; depth: number }> = [];
  for (const line of lines.slice(start, footer)) {
    if (!line.trim()) continue;
    const match = pattern.exec(line);
    if (!match || byId.has(match[2])) return null;
    const depth = match[1].length;
    while (parents.length && parents.at(-1)!.depth >= depth) parents.pop();
    const row = { id: match[2], line, parentId: parents.at(-1)?.id ?? null };
    rows.push(row); byId.set(row.id, row); parents.push({ id: row.id, depth });
  }
  return { header: lines.slice(0, start).join("\n").trimEnd(), footer: lines.slice(footer).join("\n"), rows, byId };
}

/** A conservative diff: moves/reordering, ambiguous IDs, or a large edit yield
 * the complete current tree. Removed refs are always explicitly invalidated. */
export function diffBrowserSnapshots(previous: string, current: string): string {
  const before = readTree(previous);
  const after = readTree(current);
  if (!before || !after) return current;
  const oldRoots = before.rows.filter(row => row.parentId === null).map(row => row.id);
  const newRoots = after.rows.filter(row => row.parentId === null).map(row => row.id);
  if (JSON.stringify(oldRoots) !== JSON.stringify(newRoots)) return current;
  const oldCommon = before.rows.filter(row => after.byId.has(row.id)).map(row => row.id);
  const newCommon = after.rows.filter(row => before.byId.has(row.id)).map(row => row.id);
  if (JSON.stringify(oldCommon) !== JSON.stringify(newCommon)) return current;
  for (const row of after.rows) {
    const prior = before.byId.get(row.id);
    if (prior && prior.parentId !== row.parentId) return current;
  }
  const removed = before.rows.filter(row => !after.byId.has(row.id));
  const changed = after.rows.filter(row => before.byId.get(row.id)?.line !== row.line);
  if (removed.length + changed.length > Math.max(12, Math.floor(after.rows.length * 0.35))) return current;
  const context = new Set<string>();
  const changes = new Set(changed.map(row => row.id));
  for (const row of changed) {
    let parent = row.parentId ? after.byId.get(row.parentId) : undefined;
    while (parent) {
      if (!changes.has(parent.id)) context.add(parent.id);
      parent = parent.parentId ? after.byId.get(parent.parentId) : undefined;
    }
  }
  const diff = [
    ...removed.map(row => `- ${row.line}`),
    ...after.rows.filter(row => changes.has(row.id) || context.has(row.id)).map(row =>
      `${changes.has(row.id) ? before.byId.has(row.id) ? "~" : "+" : " "} ${row.line}`),
  ];
  const removedRefs = removed.filter(row => /^e\d+$/.test(row.id)).map(row => row.id);
  const result = `${after.header}\n\nAccessibility changes (+ added, ~ changed, - removed; unchanged nodes omitted):\n${diff.join("\n") || "No accessibility changes."}${removedRefs.length ? `\nInvalidated refs: ${removedRefs.join(", ")}` : ""}\n\n${after.footer}`;
  return result.length < current.length ? result : current;
}

const diffableTools = new Set([
  "browser_click", "browser_press", "browser_type", "browser_select", "browser_check",
  "browser_scroll", "browser_hover", "browser_wait", "browser_wait_for",
  "browser_fill_login", "browser_fill_card", "browser_fill_question_answer",
]);

/** The SDK carries prepared messages forward. Recover original browser receipt
 * snapshots before preparing the next step, without resurrecting compacted history
 * or changing any action outcomes. Sources are trusted runtime receipts only. */
export function restoreBrowserObservations(messages: ModelMessage[], receipts: ModelMessage[]): ModelMessage[] {
  const originals = new Map<string, Record<string, JSONValue | undefined>>();
  for (const message of receipts) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result" || !part.toolName.startsWith("browser_") || part.output.type !== "json") continue;
      const value = part.output.value;
      if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.snapshot !== "string" || !value.browserSnapshotContext) continue;
      originals.set(`${part.toolName}:${part.toolCallId}`, value);
    }
  }
  return messages.map(message => {
    if (message.role !== "tool") return message;
    return { ...message, content: message.content.map(part => {
      if (part.type !== "tool-result" || part.output.type !== "json") return part;
      const original = originals.get(`${part.toolName}:${part.toolCallId}`);
      const value = part.output.value;
      if (!original || !value || typeof value !== "object" || Array.isArray(value)) return part;
      return { ...part, output: { ...part.output, value: { ...value, snapshot: original.snapshot, browserSnapshotContext: original.browserSnapshotContext } } };
    }) };
  });
}

function deduplicatePrintedSnapshot(value: JSONValue, snapshot: string): JSONValue {
  if (value === snapshot) return "[Identical to this tool result's snapshot; duplicate omitted.]";
  if (Array.isArray(value)) return value.map(item => deduplicatePrintedSnapshot(item, snapshot));
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, item === undefined ? undefined : deduplicatePrintedSnapshot(item, snapshot)]),
  );
  return value;
}

/** Baselines come exclusively from tool results present in this model input.
 * Internal preflights never enter this function. New user input, failed/partial
 * observations and document changes break the chain; explicit inspect is full. */
export function withBrowserObservationDiffs(messages: ModelMessage[], options: { preserveInspectionPrefixes?: boolean } = {}): ModelMessage[] {
  // Keep the newest explicit inspection full. Older browser_run inspections
  // can be represented losslessly against a visible baseline: every changed
  // row and invalidated ref remains in history, without repeating the menu.
  const latestBrowserResult = messages.flatMap(message => message.role === "tool" ? message.content : [])
    .findLast(part => part.type === "tool-result" && part.toolName.startsWith("browser_"));
  type Baseline = { documentId: string; url: string; snapshot: string };
  let baseline: Baseline | null = null;
  // A failed action invalidates current-page confidence, but does not erase a
  // full historical observation still present in the input. Older inspections
  // may diff against it; the newest post-failure observation stays full.
  let historicalBaseline: Baseline | null = null;
  let visibleBaseline = false;
  return messages.map(message => {
    if (message.role === "user") { baseline = null; historicalBaseline = null; visibleBaseline = false; }
    if (message.role !== "tool" || !Array.isArray(message.content)) return message;
    return { ...message, content: message.content.map(part => {
      if (part.type !== "tool-result" || !part.toolName.startsWith("browser_")) {
        baseline = null; visibleBaseline = false;
        return part;
      }
      if (part.output.type !== "json" || !part.output.value || typeof part.output.value !== "object" || Array.isArray(part.output.value)) {
        baseline = null; visibleBaseline = false;
        return part;
      }
      const { browserSnapshotContext: metadata, ...value } = part.output.value as Record<string, JSONValue>;
      const context = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : null;
      const snapshot = typeof value.snapshot === "string" ? value.snapshot : null;
      const url = typeof value.url === "string" ? value.url : "";
      if (part.toolName === "browser_run" && snapshot && value.printed) {
        value.printed = deduplicatePrintedSnapshot(value.printed, snapshot);
      }
      const complete = context?.version === 1 && context.complete === true && context.scopeRef === null && typeof context.documentId === "string" && snapshot !== null;
      let formatted = snapshot;
      // OpenAI's reusable prefix must not change when another result is appended.
      // Keep an inspection full once sent, rather than shortening it as it ages.
      const olderInspection = !options.preserveInspectionPrefixes && part.toolName === "browser_run" && value.lastBrowserAction === "browser_inspect" && part !== latestBrowserResult && !value.$toolError;
      const prior = baseline ?? (olderInspection ? historicalBaseline : null);
      if (complete && prior && prior.documentId === context.documentId && prior.url === url && (diffableTools.has(part.toolName === 'browser_run' && typeof value.lastBrowserAction === 'string' && !value.$toolError ? value.lastBrowserAction : part.toolName) || olderInspection)) {
        formatted = diffBrowserSnapshots(prior.snapshot, snapshot);
      }
      if (snapshot?.includes("\n\nAccessibility changes (+ added, ~ changed, - removed; unchanged nodes omitted):")) {
        // Defensive handling if an already-prepared input is reused or cut at a
        // delta. Never present an orphaned delta as a complete observation.
        if (!visibleBaseline) {
          const outcomeIndex = snapshot.indexOf("\n\nPost-click observation:");
          formatted = `Browser: ${url}\n\nThe full accessibility baseline is unavailable. Call page.inspect() in browser_run before using refs or acting.${outcomeIndex >= 0 ? snapshot.slice(outcomeIndex) : ""}`;
        }
        baseline = null;
      } else {
        visibleBaseline = Boolean(snapshot && readTree(snapshot) && !snapshot.includes("\nScope: ") && (metadata === undefined || complete));
        baseline = complete ? { documentId: context.documentId as string, url, snapshot } : null;
        if (baseline) historicalBaseline = baseline;
      }
      if (metadata === undefined && formatted === snapshot) return part;
      return { ...part, output: { ...part.output, value: { ...value, ...(formatted !== null ? { snapshot: formatted } : {}) } } };
    }) };
  });
}
