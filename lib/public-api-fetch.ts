import { request as httpsRequest } from 'node:https';
import { isPublicAddress, publicAddress } from './link-preview-fetch';
import ipaddr from 'ipaddr.js';

type Options = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal };
type Dependencies = { resolve?: typeof publicAddress; request?: typeof httpsRequest };

/** Synchronous validation for browser-origin comparisons; fetching also checks DNS below. */
export function publicHttpsUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('A public HTTPS URL without embedded credentials is required.');
  if (/^(localhost)(\.|$)/i.test(host) || (ipaddr.isValid(host) && !isPublicAddress(host))) throw new Error('Private network targets are blocked');
  return url;
}

/** Pin every connection to a validated public IP; never automatically replay mutations. */
export async function fetchPublicApi(value: string, options: Options = {}, deps: Dependencies = {}) {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
  let url = publicHttpsUrl(value);
  let headers = { ...options.headers };
  const method = options.method ?? 'GET';
  for (let hop = 0; hop < 4; hop++) {
    signal.throwIfAborted();
    publicHttpsUrl(url.href);
    const address = await new Promise<Awaited<ReturnType<typeof publicAddress>>>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      (deps.resolve ?? publicAddress)(url).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    signal.throwIfAborted();
    // The hostname remains intact for TLS verification. Caller headers cannot change routing.
    for (const key of Object.keys(headers)) if (/^(host|connection|transfer-encoding|content-length|upgrade|proxy-authorization)$/i.test(key)) delete headers[key];
    const result = await new Promise<{ status: number; body: string; location?: string }>((resolve, reject) => {
      const request = (deps.request ?? httpsRequest)(url, {
        method, headers: { ...headers, 'accept-encoding': 'identity' }, signal, agent: false,
        lookup: (_host, lookupOptions, callback) => {
          if (typeof lookupOptions === 'object' && lookupOptions.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      }, response => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.destroy(); resolve({ status, body: '', location: response.headers.location }); return;
        }
        const chunks: Buffer[] = []; let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1_000_000) { response.destroy(new Error('API response exceeds 1 MB.')); return; }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
      });
      request.on('error', reject);
      request.end(options.body);
    });
    if (result.location && method === 'GET') {
      const next = new URL(result.location, url);
      if (next.origin !== url.origin) headers = Object.fromEntries(Object.entries(headers).filter(([key]) => /^(accept|user-agent)$/i.test(key)));
      url = next; continue;
    }
    return { status: result.status, ok: result.status >= 200 && result.status < 300, body: result.body };
  }
  throw new Error('Too many API redirects.');
}
