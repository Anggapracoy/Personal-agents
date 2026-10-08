'use client';
import { useContext, useEffect, useId, useState, type ReactNode } from "react";
import { ConversationDetailsContext } from './conversation-details-context';
import { cachedLinkPreview, isPreviewImageReady, loadLinkPreview, warmPreviewImage } from "./link-preview-cache";
import type { AgentFollowUpAction } from "../lib/harness/types";
import { groupBlocks, timelineSummary, type LeafResultBlock, type ResultBlock } from "../lib/harness/result-blocks";

type Props = {
  blocks: ResultBlock[];
  resultId?: string;
  followUpActions?: AgentFollowUpAction[];
  onAction?: (action: AgentFollowUpAction) => void | boolean | Promise<boolean | void>;
};

function domainOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

const proxied = (src: string) => src.startsWith("https://") ? `/api/link-preview?image=${encodeURIComponent(src)}` : src;

function Thumb({ src, pageUrl, name, className }: { src: string | null; pageUrl?: string | null; name: string; className: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const [pageImage, setPageImage] = useState<string | null>(() => (!src && pageUrl ? cachedLinkPreview(pageUrl)?.image ?? null : null));
  useEffect(() => {
    if (src || !pageUrl) return;
    let live = true;
    void loadLinkPreview(pageUrl).then(preview => { if (live) setPageImage(preview?.image ?? null); });
    return () => { live = false; };
  }, [src, pageUrl]);
  const shown = src ? proxied(src) : pageImage;
  if (shown && failed !== shown) return <img className={className} src={shown} alt="" loading={className === 'wd-block-image' && !isPreviewImageReady(shown) ? 'lazy' : 'eager'} decoding={isPreviewImageReady(shown) ? 'sync' : 'async'} referrerPolicy="no-referrer" onLoad={() => warmPreviewImage(shown)} onError={() => setFailed(shown)} />;
  return <span className={`${className} is-placeholder`} aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m4 18 5-5 4 4 3-3 4 4" /></svg></span>;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="wd-block-copy" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>{copied ? "Copied" : "Copy"}</button>;
}

type HeadIcon = "table" | "list" | "checklist";
const HEAD_PATHS: Record<HeadIcon, ReactNode> = {
  table: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3 10h18M9 10v9" /></>,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  checklist: <><path d="m4 7 1.5 1.5L8 6M4 13l1.5 1.5L8 12M4 19l1.5 1.5L8 18" /><path d="M12 7h8M12 13h8M12 19h8" /></>,
};

function BlockHead({ icon, title, meta }: { icon: HeadIcon; title: string; meta?: string }) {
  return <div className="wd-block-head"><span className="wd-block-head-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{HEAD_PATHS[icon]}</svg></span><h4 className="wd-block-title">{title}</h4>{meta && <small>{meta}</small>}</div>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("");
}

export function MailSheet({ to, subject, body, caption }: { to?: ReactNode; subject?: ReactNode; body: ReactNode; caption?: string }) {
  return <div className="wd-block-card wd-block-draft">
    {to && <p className="wd-mail-to">To <b>{to}</b></p>}
    {subject && <div className="wd-mail-subject">{subject}</div>}
    {body}
    {caption && <p className="wd-block-note">{caption}</p>}
  </div>;
}

function ActionButton({ action, primary, used, pending, onAction }: { action: AgentFollowUpAction; primary: boolean; used: ReadonlySet<string>; pending: ReadonlySet<string>; onAction: NonNullable<Props["onAction"]> }) {
  return <button type="button" className={`wd-btn ${primary ? "is-primary" : "is-secondary"}`} disabled={used.has(action.id)} aria-busy={pending.has(action.id)} onClick={() => onAction(action)}>{pending.has(action.id) ? <span className="wd-spinner" aria-hidden="true" /> : null}<span>{action.label}</span></button>;
}

function Checklist({ block, scope }: { block: Extract<LeafResultBlock, { type: "checklist" }>; scope: string }) {
  const conversation = useContext(ConversationDetailsContext);
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const listKey = JSON.stringify([scope, block.title, block.items.map(item => item.text)]);
  const doneCount = block.items.filter((item, index) => local[JSON.stringify([listKey, index])] ?? conversation?.setting?.checklistItems?.[JSON.stringify([listKey, index])] ?? item.done).length;
  return <div className="wd-block-card">{block.title && <BlockHead icon="checklist" title={block.title} meta={`${doneCount} of ${block.items.length}`} />}<ul className="wd-block-checklist">{block.items.map((item, index) => {
    const itemKey = JSON.stringify([listKey, index]);
    const checked = local[itemKey] ?? conversation?.setting?.checklistItems?.[itemKey] ?? item.done;
    return <li key={itemKey} className={checked ? "is-done" : undefined}><button type="button" role="checkbox" aria-checked={checked} disabled={!conversation || pending !== null} onClick={async () => {
      if (!conversation || pending !== null) return;
      setLocal(current => ({ ...current, [itemKey]: !checked })); setPending(itemKey); setError("");
      try { if (!await conversation.save({ action: 'checklist', itemKey, checked: !checked })) throw new Error('save'); setLocal(current => { const next = { ...current }; delete next[itemKey]; return next; }); }
      catch { setLocal(current => ({ ...current, [itemKey]: checked })); setError("Couldn’t save this change. Try again."); }
      finally { setPending(null); }
    }}><span className="wd-block-check" aria-hidden="true">{checked ? "✓" : null}</span><span>{item.text}</span></button></li>;
  })}</ul>{error && <p className="wd-card-error" role="alert">{error}</p>}</div>;
}

function Timeline({ block }: { block: Extract<LeafResultBlock, { type: "timeline" }> }) {
  return <ol className="wd-block-timeline">{block.items.map((item, i) => <li key={i}>{item.label && <span className="wd-block-time">{item.label}</span>}<span className="wd-block-item-title">{item.title}</span>{item.note && <span className="wd-block-note">{item.note}</span>}</li>)}</ol>;
}

type AccordionRow = { index: number; block: Extract<ResultBlock, { type: "timeline" | "section" }> };

function Accordion({ rows, render }: { rows: AccordionRow[]; render: (block: LeafResultBlock, index: number, child: number) => ReactNode }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set(rows.length === 1 && (rows[0].block.type === "timeline" || !rows[0].block.collapsed) ? [rows[0].index] : []));
  const id = useId();
  return <div className="wd-block-card wd-block-accordion">{rows.map(({ index, block }) => {
    const isOpen = open.has(index);
    const panel = `${id}-${index}`;
    const summary = block.type === "timeline" ? timelineSummary(block) : null;
    return <div key={index} className={`wd-block-row${isOpen ? " is-open" : ""}`}>
      <button type="button" className="wd-block-row-head" aria-expanded={isOpen} aria-controls={panel} onClick={() => setOpen(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; })}>
        <span className="wd-block-row-text"><b>{block.title}</b>{summary && <small>{summary}</small>}</span>
        <span className="wd-block-row-chevron" aria-hidden="true" />
      </button>
      <div id={panel} className="wd-block-row-panel" role="region" aria-label={block.title ?? undefined} inert={!isOpen || undefined}><div className="wd-block-row-clip"><div className="wd-block-row-body">
        {block.type === "timeline" ? <Timeline block={block} /> : block.blocks.map((child, i) => render(child, index, i))}
      </div></div></div>
    </div>;
  })}</div>;
}

function Leaf({ block, scope, actions, used, pending, onAction }: { scope: string; block: LeafResultBlock; actions: Map<string, AgentFollowUpAction>; used: ReadonlySet<string>; pending: ReadonlySet<string>; onAction?: Props["onAction"] }) {
  switch (block.type) {
    case "text": return block.style === "heading" ? <h3 className="wd-block-heading">{block.text}</h3> : <p className="wd-block-text">{block.text}</p>;
    case "stats": return <div className="wd-block-stats">{block.items.map((item, i) => <div key={i} className="wd-block-stat"><span className="wd-block-stat-label">{item.label}</span><strong>{item.value}</strong>{item.note && <span className="wd-block-stat-note">{item.note}</span>}</div>)}</div>;
    case "callout": return <p className={`wd-block-callout is-${block.tone}`} role={block.tone === "warning" ? "note" : undefined}>{block.tone === "warning" && <svg className="wd-block-callout-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4M12 17h.01" /></svg>}<span>{block.text}</span></p>;
    case "timeline": return <div className="wd-block-card"><Timeline block={block} /></div>;
    case "table": return <div className="wd-block-card">{block.title && <BlockHead icon="table" title={block.title} />}<div className="wd-block-table-wrap"><table className="wd-block-table"><thead><tr>{block.columns.map((column, i) => <th key={i}>{column}</th>)}</tr></thead><tbody>{block.rows.map((row, i) => <tr key={i} className={row.best ? "is-best" : undefined}>{row.cells.map((cell, j) => <td key={j}>{cell}{row.best && j === 0 && <span className="wd-block-best">Best</span>}</td>)}</tr>)}</tbody></table></div></div>;
    case "place": {
      const body = <><Thumb src={block.imageUrl} pageUrl={block.url} name={block.name} className="wd-block-thumb" /><span className="wd-block-place-text"><span className="wd-block-item-title">{block.name}</span>{block.address && <span className="wd-block-note">{block.address}</span>}{block.description && <span className="wd-block-note">{block.description}</span>}</span></>;
      return block.url ? <a className="wd-block-card wd-block-place" href={block.url} target="_blank" rel="noopener noreferrer">{body}</a> : <div className="wd-block-card wd-block-place">{body}</div>;
    }
    case "link_card": return <a className="wd-block-card wd-block-place" href={block.url} target="_blank" rel="noopener noreferrer"><Thumb src={block.imageUrl} pageUrl={block.url} name={block.title} className="wd-block-thumb" /><span className="wd-block-place-text"><span className="wd-block-item-title">{block.title}</span>{block.description && <span className="wd-block-note">{block.description}</span>}<span className="wd-block-note">{domainOf(block.url)}</span></span></a>;
    case "image_row": return <div className="wd-block-images" data-count={block.images.length}>{block.images.map((image, i) => <figure key={i}><Thumb src={image.url} name={image.caption ?? ""} className="wd-block-image" />{image.caption && <figcaption>{image.sourceUrl ? <a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">{image.caption}</a> : image.caption}</figcaption>}</figure>)}</div>;
    case "checklist": return <Checklist key={JSON.stringify([scope, block])} block={block} scope={scope} />;
    case "key_value": return <div className="wd-block-card">{block.title && <BlockHead icon="list" title={block.title} />}<dl className="wd-block-kv">{block.items.map((item, i) => <div key={i}><dt>{item.label}</dt><dd>{item.value}{item.copyable && <CopyButton text={item.value} />}</dd></div>)}</dl></div>;
    case "draft": return <MailSheet to={block.to.length > 0 ? block.to.join(", ") : undefined} subject={block.subject ?? undefined} body={<p className="wd-block-draft-body">{block.body}</p>} caption={block.status === "sent" ? "Sent" : "Draft, not sent"} />;
    case "event": {
      const [year, month, day] = (block.startIso ?? "").slice(0, 10).split("-").map(Number);
      const calendar = block.calendarActionId ? actions.get(block.calendarActionId) : undefined;
      const when = [block.date, block.time].filter(Boolean).join(" · ");
      return <div className="wd-block-card"><div className="wd-block-event">{year && month >= 1 && month <= 12 && day ? <div className="wd-block-cal" aria-hidden="true"><i>{MONTHS[month - 1]}</i><b>{day}</b></div> : null}<div className="wd-block-place-text"><span className="wd-block-item-title">{block.title}</span>{when && <span className="wd-block-note">{when}</span>}{block.location && <span className="wd-block-note">{block.location}</span>}</div></div>{(calendar && onAction || block.location) && <div className="wd-card-actions is-row wd-block-card-actions">{calendar && onAction && <ActionButton action={calendar} primary={false} used={used} pending={pending} onAction={onAction} />}{block.location && <a className="wd-btn is-secondary" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(block.location)}`} target="_blank" rel="noopener noreferrer">Directions</a>}</div>}</div>;
    }
    case "contact": return <div className="wd-block-card"><div className="wd-block-event"><div className="wd-block-avatar" aria-hidden="true">{initials(block.name)}</div><div className="wd-block-place-text"><span className="wd-block-item-title">{block.name}</span>{block.note && <span className="wd-block-note">{block.note}</span>}{block.phone && <span className="wd-block-note">{block.phone}</span>}{block.email && <span className="wd-block-note">{block.email}</span>}</div></div>{(block.phone || block.email) && <div className="wd-card-actions is-row wd-block-card-actions">{block.phone && <a className="wd-btn is-secondary" href={`tel:${block.phone.replace(/[^\d+]/g, "")}`}>Call</a>}{block.email && <a className="wd-btn is-secondary" href={`mailto:${block.email}`}>Email</a>}</div>}</div>;
    case "action": {
      if (!onAction) return null;
      const list = block.actionIds.flatMap(id => { const action = actions.get(id); return action ? [action] : []; });
      return list.length ? <div className="wd-card-actions">{list.map((action, i) => <ActionButton key={action.id} action={action} primary={i === 0} used={used} pending={pending} onAction={onAction} />)}</div> : null;
    }
  }
}

export function ResultBlocks({ blocks, resultId = "result", followUpActions = [], onAction: send }: Props) {
  const actions = new Map(followUpActions.map(action => [action.id, action]));
  const [used, setUsed] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const toggle = (set: ReadonlySet<string>, id: string, on: boolean) => { const next = new Set(set); if (on) next.add(id); else next.delete(id); return next; };
  const onAction = send ? async (action: AgentFollowUpAction) => {
    setUsed(current => toggle(current, action.id, true));
    setPending(current => toggle(current, action.id, true));
    let sent: boolean | void = false;
    try { sent = await send(action); } catch { sent = false; }
    setPending(current => toggle(current, action.id, false));
    if (sent === false) setUsed(current => toggle(current, action.id, false));
  } : undefined;
  const leaf = (block: LeafResultBlock, index: number, child?: number) => <Leaf key={child ?? index} scope={child === undefined ? `${resultId}:${index}` : `${resultId}:${index}:${child}`} block={block} actions={actions} used={used} pending={pending} onAction={onAction} />;
  return <div className="wd-blocks">{groupBlocks(blocks).map(group => group.kind === "accordion"
    ? <Accordion key={group.rows[0].index} rows={group.rows} render={leaf} />
    : group.block.type === "section" ? null : leaf(group.block, group.index))}</div>;
}
