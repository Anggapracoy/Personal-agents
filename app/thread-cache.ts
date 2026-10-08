import { warmPhoto, clearPhotoPreviews } from "./attachment-preview";
import { retainSubmittedReply, type ThreadItem } from '../lib/harness/thread';
import { messageLinks, previewUrl } from '../lib/link-preview';
import { primeLinkPreview } from './link-preview-cache';

function primeRecentLinks(items: ThreadItem[]) {
  if (typeof window === 'undefined') return;
  for (const item of items.slice(-24)) {
    if ('photos' in item) for (const photo of item.photos ?? []) warmPhoto(photo.url);
  }
  const urls = new Set<string>();
  for (const item of items.slice(-12).reverse()) {
    if (item.kind !== 'agent') continue;
    for (const result of item.results ?? []) {
      const url = result.sourceUrl && previewUrl(result.sourceUrl);
      if (url) urls.add(url);
    }
    if (item.text.length <= 20_000 && item.text.includes('http')) {
      for (const url of messageLinks(item.text).urls) urls.add(url);
    }
    if (urls.size >= 3) break;
  }
  for (const url of [...urls].slice(0, 3)) primeLinkPreview(url);
}

const validItems = (value: unknown): value is ThreadItem[] => Array.isArray(value)
  && value.every(item => item && typeof item.id === 'string' && typeof item.kind === 'string');

/** Account-scoped messages for synchronous chat opening; refreshes never clear them. */
export class ThreadCache extends Map<string, ThreadItem[]> {
  private disposed = false;
  private pending = new Map<string, Promise<ThreadItem[]>>();
  private refreshed = new Map<string, string>();
  private listeners = new Map<string, Set<() => void>>();
  private storage?: Storage;
  private readonly storageKey: string;
  private readonly prefix: string;
  constructor(account: string, storage?: Storage) {
    super();
    this.storageKey = `wdyt-threads-v1:${account}`;
    this.prefix = `wdyt-thread-v2:${encodeURIComponent(account)}:`;
    try {
      this.storage = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
      const saved = JSON.parse(this.storage?.getItem(this.storageKey) ?? '[]') as unknown;
      if (Array.isArray(saved)) for (const entry of saved) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && validItems(entry[1])) {
          const current = JSON.parse(this.storage?.getItem(this.prefix + entry[0]) ?? 'null');
          super.set(entry[0], validItems(current) ? current : entry[1]);
        }
      }
    } catch { /* Storage is optional; private mode and quota errors use memory. */ }
  }
  override get(id: string) {
    if (!super.has(id) && !this.disposed) {
      try {
        const saved = JSON.parse(this.storage?.getItem(this.prefix + id) ?? 'null');
        if (validItems(saved)) super.set(id, saved);
      } catch { /* Fall back to the normal background fetch. */ }
    }
    return super.get(id);
  }
  override has(id: string) { return this.get(id) !== undefined; }
  override set(id: string, items: ThreadItem[]) {
    if (this.disposed) return this;
    super.set(id, items);
    primeRecentLinks(items);
    // Each chat is saved independently. A long thread or the 31st conversation
    // must not evict other conversations or lose them when the app closes.
    try { this.storage?.setItem(this.prefix + id, JSON.stringify(items)); }
    catch { /* Keep the complete in-memory transcript if storage is unavailable. */ }
    this.listeners.get(id)?.forEach(listener => listener());
    return this;
  }
  subscribe(id: string, listener: () => void) {
    const listeners = this.listeners.get(id) ?? new Set();
    listeners.add(listener); this.listeners.set(id, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(id); };
  }
  clearSaved() {
    clearPhotoPreviews();
    this.disposed = true; super.clear(); this.refreshed.clear();
    try {
      this.storage?.removeItem(this.storageKey);
      const keys: string[] = [];
      for (let i = 0; i < (this.storage?.length ?? 0); i++) {
        const key = this.storage?.key(i);
        if (key?.startsWith(this.prefix)) keys.push(key);
      }
      keys.forEach(key => this.storage?.removeItem(key));
    } catch { /* Optional storage. */ }
    this.listeners.forEach(listeners => listeners.forEach(listener => listener()));
  }
  async prefetch(id: string, version: string) {
    const cached = this.get(id);
    if (cached) primeRecentLinks(cached);
    if (this.disposed || (this.has(id) && this.refreshed.get(id) === version)) return;
    await this.load(id);
    this.refreshed.set(id, version);
  }
  load(id: string): Promise<ThreadItem[]> {
    const existing = this.pending.get(id);
    if (existing) return existing;
    const before = this.get(id);
    const request = fetch(`/api/runs/${encodeURIComponent(id)}/messages`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
      .then(async response => {
        if (!response.ok) throw new Error('Messages could not be loaded.');
        const data = await response.json() as { items: ThreadItem[] };
        const current = this.get(id);
        // A live update received after this request started wins over its older response.
        if (current !== before && current) return current;
        const items = retainSubmittedReply(data.items, current ?? []);
        if (!this.disposed) this.set(id, items);
        return items;
      }).finally(() => this.pending.delete(id));
    this.pending.set(id, request);
    return request;
  }
}
