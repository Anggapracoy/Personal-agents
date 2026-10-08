import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';
import { parse } from 'parse5';
import { previewUrl, type LinkPreview } from './link-preview';

export function isPublicAddress(address: string) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export async function publicAddress(url: URL, resolve = lookup): Promise<{ address: string; family: number }> {
  if (!previewUrl(url.href) || (url.port && !['80', '443'].includes(url.port))) throw new Error('Unsupported URL');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(hostname) ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }] : await resolve(hostname, { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Non-public address');
  return addresses[0];
}
/** Resolve and pin each hop to its checked IP, so redirects and DNS changes cannot reach private hosts. */
export async function fetchPreviewResource(value: string, image = false) {
  const signal = AbortSignal.timeout(6_000);
  let url = new URL(value);
  for (let hop = 0; hop < 4; hop++) {
    const address = await Promise.race([publicAddress(url), new Promise<never>((_, reject) => {
      if (signal.aborted) reject(new Error('Timed out'));
      else signal.addEventListener('abort', () => reject(new Error('Timed out')), { once: true });
    })]);
    const result = await new Promise<{ redirect?: string; body: Buffer; type: string }>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        signal, agent: false,
        lookup: (_host, options, callback) => {
          if (typeof options === 'object' && options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
        headers: { 'user-agent': 'Dash-LinkPreview/1.0', accept: image ? 'image/*' : 'text/html', 'accept-encoding': 'identity' },
      }, response => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.destroy(); resolve({ redirect: response.headers.location, body: Buffer.alloc(0), type: '' }); return;
        }
        const type = (response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        if (status < 200 || status >= 300 || (image ? !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(type) : !['text/html', 'application/xhtml+xml'].includes(type))) {
          response.destroy(); reject(new Error('Preview unavailable')); return;
        }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > (image ? 3_000_000 : 512_000)) {
            if (image) response.destroy(new Error('Preview too large'));
            else { resolve({ body: Buffer.concat([...chunks, chunk]).subarray(0, 512_000), type }); response.destroy(); }
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => resolve({ body: Buffer.concat(chunks), type }));
      });
      request.on('error', reject); request.end();
    });
    if (result.redirect) { url = new URL(result.redirect, url); continue; }
    return { ...result, url: url.href };
  }
  throw new Error('Too many redirects');
}
type PreviewNode = { nodeName: string; attrs?: { name: string; value: string }[]; childNodes?: unknown[]; value?: string; parentNode?: unknown };
const attributes = (node: PreviewNode) => new Map(node.attrs?.map(attr => [attr.name, attr.value]));
const nodeText = (node: PreviewNode): string => (node.value ?? '') + (node.childNodes ?? []).map(child => nodeText(child as PreviewNode)).join('');

/** Domain-independent fallback; only images tied to the page's main product qualify. */
function productPageImage(document: PreviewNode, pageUrl: string, title: string): string | undefined {
  const candidates: { url: string; score: number }[] = [];
  const safeImage = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return;
    try { return previewUrl(new URL(value.trim(), pageUrl).href); } catch { return; }
  };
  const add = (value: unknown, score: number) => {
    const url = safeImage(value);
    if (url && !/(?:placeholder|spacer|transparent|loading|logo|icon)(?:[_.\/-]|$)/i.test(new URL(url).pathname)) candidates.push({ url, score });
  };
  const words = (value: string): string[] => value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  let heading = '';
  const products: Record<string, unknown>[] = [];
  const collect = (value: unknown, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 12) return;
    if (Array.isArray(value)) { value.forEach(item => collect(item, depth + 1)); return; }
    const object = value as Record<string, unknown>;
    const types = Array.isArray(object['@type']) ? object['@type'] : [object['@type']];
    if (types.some(type => typeof type === 'string' && /(?:^|[/#])Product$/.test(type))) products.push(object);
    // Lists of recommendations aren't the product being previewed.
    for (const [key, child] of Object.entries(object)) if (!['itemListElement', 'isRelatedTo', 'isSimilarTo'].includes(key)) collect(child, depth + 1);
  };
  const scan = (node: PreviewNode) => {
    if (node.nodeName === 'template' || node.nodeName === 'noscript') return;
    const attrs = attributes(node);
    if (node.nodeName === 'h1' && !heading) heading = nodeText(node).trim();
    if (node.nodeName === 'script') {
      if (attrs.get('type')?.toLowerCase() === 'application/ld+json') {
        try { collect(JSON.parse(nodeText(node))); } catch { /* Malformed metadata isn't executable. */ }
      }
      return;
    }
    if (node.nodeName === 'link' && attrs.get('rel')?.toLowerCase() === 'image_src') add(attrs.get('href'), 95);
    for (const child of node.childNodes ?? []) scan(child as PreviewNode);
  };
  scan(document);
  const productWords = words(heading || title);
  const matchesProduct = (value: string) => {
    const terms = words(value);
    return terms.length >= 2 && productWords.length >= 2 && terms.filter(term => productWords.includes(term)).length / terms.length >= 0.7;
  };
  const schemaImage = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(schemaImage); return; }
    if (value && typeof value === 'object') {
      const image = value as Record<string, unknown>;
      add(image.contentUrl ?? image.url, 100);
    } else add(value, 100);
  };
  for (const product of products) {
    // A sole Product is the publisher's main product declaration. When multiple
    // Products exist, require the name to identify the current page.
    if (products.length === 1 || (typeof product.name === 'string' && matchesProduct(product.name))) schemaImage(product.image);
  }
  const sourceSet = (value: string | undefined, score: number) => {
    if (!value) return;
    // Responsive lazy loaders may use a quoted breakpoint map rather than srcset.
    // Read string values only; never evaluate attribute JavaScript.
    if (value.trim().startsWith('{')) {
      for (const match of value.matchAll(/["'](?:\d+)["']\s*:\s*(["'])(.*?)\1/g)) add(match[2], score);
    } else {
      const entries = value.split(',').map(entry => entry.trim().split(/\s+/));
      entries.sort((a, b) => (parseFloat(b[1]) || 1) - (parseFloat(a[1]) || 1));
      for (const [url] of entries) add(url, score);
    }
  };
  const walk = (node: PreviewNode, context = '', excluded = false) => {
    if (['script', 'template', 'noscript'].includes(node.nodeName)) return;
    const attrs = attributes(node);
    const ownContext = `${node.nodeName} ${attrs.get('id') ?? ''} ${attrs.get('class') ?? ''} ${attrs.get('itemtype') ?? ''}`;
    const blocked = excluded || attrs.has('hidden') || attrs.get('aria-hidden') === 'true' || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.get('style') ?? '') || ['nav', 'header', 'footer', 'aside'].includes(node.nodeName) || /recommend|related|upsell|cross.sell|recently.viewed/i.test(ownContext);
    const nearby = `${context} ${ownContext}`;
    if (!blocked && node.nodeName === 'img') {
      const width = Number(attrs.get('width')); const height = Number(attrs.get('height'));
      const tiny = (width > 0 && width < 40) || (height > 0 && height < 40);
      const gallery = /(?:product|pdp)[\w -]*(?:gallery|image|media)|(?:gallery|image|media)[\w -]*(?:product|pdp)|landingimage|imgblkfront/i.test(nearby);
      const productImage = attrs.get('itemprop')?.split(/\s+/).includes('image') && /Product/i.test(nearby);
      const altMatches = matchesProduct(attrs.get('alt') ?? '');
      if (!tiny && (gallery || productImage || altMatches)) {
        const score = productImage ? 90 : gallery ? 80 : 65;
        const imageStart = candidates.length;
        // Prefer the first hero in a gallery over later lifestyle/routine images.
        for (const name of ['data-old-hires', 'data-zoom-image', 'data-large-image', 'data-src', 'data-lazy-src', 'data-original']) add(attrs.get(name), score + 2);
        for (const name of ['data-srcset', 'data-lazy-srcset', 'v-srcset', 'srcset']) sourceSet(attrs.get(name), score + 1);
        for (const [name, value] of attrs) {
          if (!name.startsWith('data-') || !name.endsWith('-image') || !value.startsWith('{')) continue;
          try {
            const sizes = JSON.parse(value) as Record<string, unknown>;
            const entries = Object.entries(sizes).filter((entry): entry is [string, number[]] => Array.isArray(entry[1]) && entry[1].length === 2 && entry[1].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0));
            entries.sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1]);
            for (const [url] of entries) add(url, score + 1);
          } catch { /* Ignore malformed image maps. */ }
        }
        add(attrs.get('src'), score);
        // Picture sources belong to the same qualifying image, not an arbitrary banner.
        if (node.parentNode && (node.parentNode as PreviewNode).nodeName === 'picture') {
          for (const sibling of (node.parentNode as PreviewNode).childNodes ?? []) {
            if ((sibling as PreviewNode).nodeName === 'source') sourceSet(attributes(sibling as PreviewNode).get('srcset'), score + 1);
          }
        }
        const sources = candidates.splice(imageStart).sort((a, b) => b.score - a.score);
        if (sources[0]) candidates.push({ url: sources[0].url, score });
      }
    }
    for (const child of node.childNodes ?? []) walk(child as PreviewNode, nearby.slice(-400), blocked);
  };
  walk(document);
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url;
}

export function parseLinkPreview(html: string, originalUrl: string, finalUrl = originalUrl): LinkPreview {
  const document = parse(html);
  const metadata = new Map<string, string>(); let pageTitle = '';
  const walk = (node: { nodeName: string; attrs?: { name: string; value: string }[]; childNodes?: unknown[]; value?: string }) => {
    if (node.nodeName === 'meta') {
      const attrs = new Map(node.attrs?.map(item => [item.name, item.value]));
      const key = (attrs.get('property') || attrs.get('name') || '').toLowerCase();
      const value = attrs.get('content')?.trim();
      if (key && value && !metadata.has(key)) metadata.set(key, value);
    }
    if (node.nodeName === 'title') pageTitle = (node.childNodes as { value?: string }[] ?? []).map(child => child.value ?? '').join('');
    for (const child of node.childNodes ?? []) walk(child as typeof node);
  };
  // Only document metadata, never markup in the body, scripts or templates.
  const head = document.childNodes.find(node => node.nodeName === 'html');
  if (head && 'childNodes' in head) {
    const node = head.childNodes.find(node => node.nodeName === 'head');
    if (node) walk(node);
  }
  const domain = new URL(finalUrl).hostname.replace(/^www\./, '');
  const title = (metadata.get('og:title') || metadata.get('twitter:title') || pageTitle || domain).replace(/\s+/g, ' ').trim().slice(0, 200);
  const image = metadata.get('og:image:secure_url') || metadata.get('og:image') || metadata.get('twitter:image');
  let imageUrl: string | undefined;
  try { if (image) imageUrl = previewUrl(new URL(image, finalUrl).href); } catch { /* Text-only preview. */ }
  imageUrl ||= productPageImage(document, finalUrl, title);
  return { url: originalUrl, domain, title, ...(imageUrl ? { image: imageUrl } : {}) };
}
const cache = new Map<string, { until: number; result: Promise<LinkPreview | null> }>();
export function getLinkPreview(url: string) {
  const cached = cache.get(url);
  if (cached && cached.until > Date.now()) return cached.result;
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  const result = fetchPreviewResource(url).then(data => parseLinkPreview(data.body.toString('utf8'), url, data.url)).catch(() => null);
  cache.set(url, { until: Date.now() + 10 * 60_000, result });
  return result;
}
