import { z } from "zod";

// Optional fields are nullable-with-default rather than optional: several
// providers reject optional properties in strict structured output.
const s = (max: number) => z.string().min(1).max(max);
const opt = (max: number) => z.string().max(max).nullable().default(null);
const url = () => z.string().max(2048);
const optUrl = () => z.string().max(2048).nullable().default(null);

const textBlock = z.object({ type: z.literal("text"), style: z.enum(["heading", "paragraph"]), text: s(1_500) });
const statsBlock = z.object({
  type: z.literal("stats"),
  items: z.array(z.object({ label: s(40), value: s(40), note: opt(80) })).min(1).max(4),
});
const calloutBlock = z.object({ type: z.literal("callout"), tone: z.enum(["tip", "info", "warning", "success"]), text: s(600) });
const timelineBlock = z.object({
  type: z.literal("timeline"),
  title: opt(80),
  summary: opt(100),
  items: z.array(z.object({ label: opt(40), title: s(160), note: opt(240) })).min(1).max(20),
});
const tableBlock = z.object({
  type: z.literal("table"),
  title: opt(80),
  columns: z.array(s(40)).min(2).max(5),
  rows: z.array(z.object({ cells: z.array(z.string().max(160)).min(1).max(5), best: z.boolean().default(false) })).min(1).max(12),
});
const placeBlock = z.object({
  type: z.literal("place"),
  name: s(160),
  address: opt(200),
  description: opt(300),
  imageUrl: optUrl(),
  url: optUrl(),
});
const linkCardBlock = z.object({ type: z.literal("link_card"), title: s(160), description: opt(300), url: url(), imageUrl: optUrl() });
const imageRowBlock = z.object({
  type: z.literal("image_row"),
  images: z.array(z.object({ url: url(), caption: opt(120), sourceUrl: optUrl() })).min(1).max(4),
});
const checklistBlock = z.object({
  type: z.literal("checklist"),
  title: opt(80),
  items: z.array(z.object({ text: s(200), done: z.boolean().default(false) })).min(1).max(20),
});
const actionBlock = z.object({ type: z.literal("action"), actionIds: z.array(s(120)).min(1).max(4) });

const keyValueBlock = z.object({
  type: z.literal("key_value"),
  title: opt(80),
  items: z.array(z.object({ label: s(60), value: s(300), copyable: z.boolean().default(false) })).min(1).max(20),
});
const draftBlock = z.object({
  type: z.literal("draft"),
  channel: z.enum(["email", "message"]),
  status: z.enum(["draft", "sent"]),
  to: z.array(s(200)).max(10).default([]),
  subject: opt(300),
  body: s(5_000),
});
const eventBlock = z.object({
  type: z.literal("event"),
  title: s(160),
  startIso: opt(40),
  date: opt(60),
  time: opt(60),
  location: opt(200),
  calendarActionId: opt(120),
});
const contactBlock = z.object({
  type: z.literal("contact"),
  name: s(120),
  note: opt(200),
  phone: opt(30),
  email: opt(200),
});

const leafBlocks = [textBlock, statsBlock, calloutBlock, timelineBlock, tableBlock, placeBlock, linkCardBlock, imageRowBlock, checklistBlock, actionBlock, keyValueBlock, draftBlock, eventBlock, contactBlock] as const;
const leafBlockSchema = z.discriminatedUnion("type", leafBlocks);
const sectionBlock = z.object({
  type: z.literal("section"),
  title: s(120),
  collapsed: z.boolean().default(false),
  blocks: z.array(leafBlockSchema).min(1).max(10),
});

const MAX_RESULT_BLOCKS = 16;
const resultBlockSchema = z.discriminatedUnion("type", [...leafBlocks, sectionBlock]);
export const resultBlocksSchema = z.array(resultBlockSchema).max(MAX_RESULT_BLOCKS);

export type ResultBlock = z.infer<typeof resultBlockSchema>;
export type LeafResultBlock = z.infer<typeof leafBlockSchema>;

function httpsUrl(value: string | null | undefined) {
  if (!value) return null;
  try { const parsed = new URL(value); return parsed.protocol === "https:" ? parsed.toString() : null; } catch { return null; }
}

// Normalizes blocks the model already produced: keeps order, drops only what
// cannot render (non-HTTPS links, unknown action ids, empty groups) and never
// invents content.
export function sanitizeBlocks(blocks: ResultBlock[] | undefined, actionIds: ReadonlySet<string>): ResultBlock[] {
  const leaf = (block: LeafResultBlock): LeafResultBlock | null => {
    switch (block.type) {
      case "table": {
        const width = block.columns.length;
        return { ...block, rows: block.rows.map(row => ({ ...row, cells: Array.from({ length: width }, (_, i) => row.cells[i] ?? "") })) };
      }
      case "place": return { ...block, imageUrl: httpsUrl(block.imageUrl), url: httpsUrl(block.url) };
      case "link_card": {
        const link = httpsUrl(block.url);
        return link ? { ...block, url: link, imageUrl: httpsUrl(block.imageUrl) } : null;
      }
      case "image_row": {
        const images = block.images.flatMap(image => { const src = httpsUrl(image.url); return src ? [{ ...image, url: src, sourceUrl: httpsUrl(image.sourceUrl) }] : []; });
        return images.length ? { ...block, images } : null;
      }
      case "action": {
        const ids = [...new Set(block.actionIds.filter(id => actionIds.has(id)))];
        return ids.length ? { ...block, actionIds: ids } : null;
      }
      case "event": {
        const start = block.startIso && !Number.isNaN(Date.parse(block.startIso)) ? block.startIso : null;
        return { ...block, startIso: start, calendarActionId: block.calendarActionId && actionIds.has(block.calendarActionId) ? block.calendarActionId : null };
      }
      case "contact": {
        const phone = block.phone && /^\+?[\d\s().-]{5,25}$/.test(block.phone) ? block.phone : null;
        const email = block.email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(block.email) ? block.email : null;
        return phone || email || block.note ? { ...block, phone, email } : null;
      }
      default: return block;
    }
  };
  const result: ResultBlock[] = [];
  for (const block of (blocks ?? []).slice(0, MAX_RESULT_BLOCKS)) {
    if (block.type === "section") {
      const inner: LeafResultBlock[] = [];
      for (const child of block.blocks) { const kept = leaf(child); if (kept) inner.push(kept); }
      if (inner.length) result.push({ ...block, blocks: inner });
    } else {
      const kept = leaf(block);
      if (kept) result.push(kept);
    }
  }
  return result;
}

export type BlockGroup =
  | { kind: "single"; index: number; block: ResultBlock }
  | { kind: "accordion"; rows: Array<{ index: number; block: Extract<ResultBlock, { type: "timeline" | "section" }> }> };

const isRow = (block: ResultBlock): block is Extract<ResultBlock, { type: "timeline" | "section" }> =>
  block.type === "section" || (block.type === "timeline" && Boolean(block.title));

// Consecutive titled timelines and sections read as one list of tappable rows.
// Order is preserved, and every other block stays where the agent put it.
export function groupBlocks(blocks: ResultBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  blocks.forEach((block, index) => {
    const last = groups.at(-1);
    if (isRow(block)) {
      if (last?.kind === "accordion") last.rows.push({ index, block });
      else groups.push({ kind: "accordion", rows: [{ index, block }] });
    } else groups.push({ kind: "single", index, block });
  });
  return groups;
}

/** A short line shown under a closed row: the agent's summary, else the first stops. */
export function timelineSummary(block: Extract<ResultBlock, { type: "timeline" }>): string {
  if (block.summary) return block.summary;
  return block.items.slice(0, 3).map(item => item.title).join(", ");
}
