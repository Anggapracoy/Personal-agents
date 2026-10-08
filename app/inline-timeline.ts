import type { ReactNode } from "react";

/** The live controls are supplied afresh; history contains presentation data only. */
export type InlinePanel = {
  id: string;
  node: ReactNode;
  message?: boolean;
  summary: string;
  createdAt?: string;
  replaces?: string;
};
export type InlineRecord = Omit<InlinePanel, "node"> & { afterId?: string };

export function reconcileInlineRecords(previous: InlineRecord[], panels: InlinePanel[], items: Array<{ id: string; createdAt?: string }>, now: string): InlineRecord[] {
  // Migrate cached approval and wait placeholders to their durable receipts.
  const result = previous.map(record => record.id.startsWith('approval:') ? { ...record, summary: '', replaces: `answers:${record.id.slice('approval:'.length)}` } : record.id.startsWith("pause:") && record.summary === "Waiting ended" ? { ...record, replaces: `wait:${record.id.slice("pause:".length)}` } : record);
  for (const { node: _, ...panel } of panels) {
    const index = result.findIndex(row => row.id === panel.id);
    if (index >= 0) result[index] = { ...result[index], summary: panel.summary, replaces: panel.replaces, message:panel.message };
    else {
      const createdAt = panel.createdAt ?? now;
      const before = items.filter(item => !item.createdAt || item.createdAt <= createdAt).at(-1);
      result.push({ ...panel, createdAt, afterId: before?.id });
    }
  }
  return result;
}

/** Anchors survive optimistic message replacement; timestamps are the fallback. */
export function inlineTimeline<T extends { id: string; createdAt?: string }>(items: T[], records: InlineRecord[]): Array<{ item: T } | { panel: InlineRecord }> {
  const replacements = new Set(records.flatMap(record => record.replaces ? [record.replaces] : []));
  const result: Array<{ item: T } | { panel: InlineRecord }> = items.filter(item => !replacements.has(item.id)).map(item => ({ item }));
  for (const panel of records) {
    // Calls and waits carry authoritative server time. Cached live-panel anchors
    // can predate a resumed turn, so keep the receipt in its timestamped position.
    const receiptIndex = (panel.replaces?.startsWith("call:") || panel.replaces?.startsWith("wait:")) ? items.findIndex(item => item.id === panel.replaces) : -1;
    if (receiptIndex >= 0) {
      const followingIds = new Set(items.slice(receiptIndex + 1).map(item => item.id));
      const next = result.findIndex(row => "item" in row && followingIds.has(row.item.id));
      result.splice(next < 0 ? result.length : next, 0, { panel });
      continue;
    }
    const anchor = panel.afterId ? result.findIndex(row => "item" in row && row.item.id === panel.afterId) : -1;
    const later = result.findIndex(row => "item" in row && row.item.createdAt && panel.createdAt && row.item.createdAt > panel.createdAt);
    let index = anchor >= 0 ? anchor + 1 : later >= 0 ? later : result.length;
    while (index < result.length && "panel" in result[index]!) index++;
    result.splice(index, 0, { panel });
  }
  return result;
}
