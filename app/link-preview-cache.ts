import type { LinkPreview } from '../lib/link-preview';

type Entry = { until: number; result: Promise<LinkPreview | null>; value?: LinkPreview | null };
const cache = new Map<string, Entry>();
const images = new Map<string, HTMLImageElement>();

export function warmPreviewImage(url: string) {
  if (typeof window === 'undefined' || images.has(url)) return;
  if (images.size >= 48) images.delete(images.keys().next().value!);
  const image = new Image();
  image.referrerPolicy = 'no-referrer';
  image.loading = 'eager';
  image.src = url;
  images.set(url, image);
  void image.decode().catch(() => { if (images.get(url) === image) images.delete(url); });
}

export function isPreviewImageReady(url: string): boolean {
  const image = images.get(url);
  return !!image && image.complete && image.naturalWidth > 0;
}

export function cachedLinkPreview(url: string): LinkPreview | null | undefined {
  const entry = cache.get(url);
  return entry?.value ?? (entry && entry.until > Date.now() ? entry.value : undefined);
}

export function loadLinkPreview(url: string): Promise<LinkPreview | null> {
  const existing = cache.get(url);
  if (existing && existing.until > Date.now()) return existing.result;
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  const entry: Entry = {
    until: Date.now() + 10 * 60_000,
    value: existing?.value,
    result: fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8_000) })
      .then(async response => response.ok ? (await response.json()).preview as LinkPreview | null : null)
      .catch(() => null)
      .then(value => {
        const resolved = value ?? existing?.value ?? null;
        entry.value = resolved;
        if (resolved?.image) warmPreviewImage(resolved.image);
        return resolved;
      }),
  };
  cache.set(url, entry);
  return entry.result;
}

export function primeLinkPreview(url: string) { void loadLinkPreview(url); }
