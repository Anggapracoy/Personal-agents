import { NextRequest } from 'next/server';

/** Bound streamed/chunked bodies before a parser or handler can act on them. */
export function withRequestBodyLimit<T extends Request, A extends unknown[]>(
  handler: (request: T, ...args: A) => Promise<Response>,
  maximumBytes = 1_048_576,
) {
  return async (request: T, ...args: A): Promise<Response> => {
    const tooLarge = () => Response.json({ error: 'Request body is too large.' }, { status: 413 });
    const length = request.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
      void request.body?.cancel().catch(() => undefined);
      return tooLarge();
    }
    if (!request.body) return handler(request, ...args);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('body-timeout')), 15_000); });
    try {
      while (true) {
        const { value, done } = await Promise.race([reader.read(), timeout]);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maximumBytes) return tooLarge();
        chunks.push(value);
      }
    } catch {
      return Response.json({ error: 'Request body could not be read.' }, { status: 408 });
    } finally {
      clearTimeout(timer);
      void reader.cancel().catch(() => undefined);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    // Rebuild from a plain Web Request. Passing a consumed NextRequest as the
    // source of a second NextRequest triggers an internal private-state error
    // in Next.js 16.
    const rebuilt = new Request(request.url, { method: request.method, headers: request.headers, body });
    const bounded = request instanceof NextRequest ? new NextRequest(rebuilt) : rebuilt;
    return handler(bounded as T, ...args);
  };
}
