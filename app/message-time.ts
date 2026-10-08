import type { ThreadItem } from '../lib/harness/thread';

export function messageTimeLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const day = date.toDateString() === now.toDateString() ? 'Today' : date.toDateString() === yesterday.toDateString() ? 'Yesterday' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}) });
  return `${day} ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export function groupMessageTimes(items: ThreadItem[]): Array<ThreadItem | { id: string; kind: 'timestamp'; createdAt: string }> {
  let previous: Date | null = null;
  return items.flatMap<ThreadItem | { id: string; kind: "timestamp"; createdAt: string }>(item => {
    if (item.kind !== 'user' && item.kind !== 'agent' && item.kind !== 'call' && item.kind !== 'wait' && item.kind !== 'blocks') return [item];
    const date = item.createdAt ? new Date(item.createdAt) : null;
    if (!date || !Number.isFinite(date.getTime())) return [item];
    const startsGroup = !previous || date.toDateString() !== previous.toDateString() || date.getTime() - previous.getTime() >= 60 * 60_000;
    previous = date;
    return startsGroup ? [{ id: `${item.id}:time`, kind: 'timestamp' as const, createdAt: item.createdAt! }, item] : [item];
  });
}

/** Messages uses calendar time in the list, rather than a changing age counter. */
export function conversationTimeLabel(value: string | undefined, now: number): string {
  if (!value) return "";
  const date = new Date(value), today = new Date(now);
  if (!Number.isFinite(date.getTime())) return '';
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const week = new Date(today); week.setDate(today.getDate() - 6); week.setHours(0, 0, 0, 0);
  return date.toLocaleDateString(undefined, date >= week ? { weekday: 'short' } : { month: 'numeric', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: '2-digit' } : {}) });
}

/** Adjacent messages from the same person form one compact visual group. */
export function sameMessageGroup(a: ThreadItem | undefined, b: ThreadItem | undefined): boolean {
  if (!a || !b || (a.kind !== 'user' && a.kind !== 'agent' && a.kind !== 'blocks') || (b.kind !== 'user' && b.kind !== 'agent' && b.kind !== 'blocks')) return false;
  if ((a.kind === 'user') !== (b.kind === 'user')) return false;
  if ((a.kind !== 'blocks' && a.files?.length) || (b.kind !== 'blocks' && b.files?.length)) return false;
  if (!a.createdAt || !b.createdAt || (a.kind !== 'blocks' && a.reactions?.length) || (b.kind !== 'blocks' && b.reactions?.length)) return false;
  const first = new Date(a.createdAt), second = new Date(b.createdAt);
  const distance = second.getTime() - first.getTime();
  return Number.isFinite(distance) && distance >= 0 && distance < 60_000 && first.toDateString() === second.toDateString();
}
