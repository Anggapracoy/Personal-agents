import type { LanguageModelMiddleware } from 'ai';

/** HTTP errors and post-acceptance stream errors use different SDK envelopes. */
export function providerErrorChain(error: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  function visit(value: unknown) {
    if (!value || typeof value !== 'object' || seen.has(value) || found.length >= 20) return;
    seen.add(value);
    const item = value as Record<string, unknown>;
    found.push(item);
    for (const key of ['lastError', 'cause', 'response', 'error']) visit(item[key]);
  }
  visit(error);
  return found;
}

export function providerErrorMessage(error: unknown) {
  const message = providerErrorChain(error).reverse().find(item => typeof item.message === 'string' && item.message.trim())?.message;
  return typeof message === 'string' ? message.slice(0, 2_000) : 'Agent turn failed';
}

const diagnosticId = (value: unknown): string | null => typeof value === 'string' && /^[\w.:-]{1,200}$/.test(value) ? value : null;

export type ProviderFailureDiagnostic = { code: string | null; type: string | null; status: number | null; requestId: string | null; responseId: string | null };

/** Keep response lookup identifiers and error codes, never provider bodies or inputs. */
export function providerFailureMiddleware(record: (failure: ProviderFailureDiagnostic) => Promise<void>): LanguageModelMiddleware {
  return {
    specificationVersion: 'v4',
    wrapStream: async ({ doStream }) => {
      let requestId: string | null = null;
      let responseId: string | null = null;
      let rawError: unknown;
      const report = async (error: unknown) => {
        const items = providerErrorChain(error);
        const code = items.map(item => diagnosticId(item.code)).find(Boolean) ?? null;
        const type = items.map(item => diagnosticId(item.type ?? item.name)).find(Boolean) ?? null;
        const status = items.map(item => item.statusCode ?? item.status).find(value => typeof value === 'number' && value >= 100 && value <= 599);
        const headers = items.map(item => item.responseHeaders ?? item.headers).find(value => value && typeof value === 'object') as Record<string, unknown> | undefined;
        try { await record({ code, type, status: typeof status === 'number' ? status : null, requestId: requestId ?? diagnosticId(headers?.['x-request-id']), responseId }); }
        catch { console.warn('[model-failure] diagnostic persistence unavailable'); }
      };
      try {
        const result = await doStream();
        requestId = diagnosticId(result.response?.headers?.['x-request-id']);
        return { ...result, stream: result.stream.pipeThrough(new TransformStream({
          async transform(part, controller) {
            if (part.type === 'response-metadata') responseId = diagnosticId(part.id);
            if (part.type === 'raw' && part.rawValue && typeof part.rawValue === 'object') {
              const raw = part.rawValue as { type?: string; error?: unknown; response?: { id?: string; error?: unknown } };
              if (raw.type === 'response.failed' || raw.type === 'error') {
                // The adapter strips Retry-After from response.failed. Carry the
                // original error envelope, without its output or request body.
                rawError = raw.type === 'response.failed' ? { type: raw.type, response: { error: raw.response?.error } } : raw;
                responseId = diagnosticId(raw.response?.id) ?? responseId;
              }
            }
            if (part.type === 'error') {
              const error = rawError ?? part.error;
              await report(error);
              controller.enqueue({ ...part, error });
            } else controller.enqueue(part);
          },
        })) };
      } catch (error) { await report(error); throw error; }
    },
  };
}

/** Preserve useful provider diagnostics without storing request bodies or credentials. */
export function providerBillingFailure(error: unknown): { status: number; code: string; requestId: string | null } | null {
  const seen = new Set<unknown>();
  const inspect = (value: unknown): ReturnType<typeof providerBillingFailure> => {
    if (!value || typeof value !== 'object' || seen.has(value)) return null;
    seen.add(value);
    const item = value as Record<string, unknown>;
    const nested = inspect(item.lastError) ?? inspect(item.cause);
    if (nested) return nested;
    const detail = [item.message, item.responseBody, item.code].filter(part => typeof part === 'string').join(' ');
    const status = Number(item.statusCode ?? item.status);
    const code = detail.match(/\b(billing_not_configured|insufficient_quota|usage_limit_exceeded)\b/i)?.[1]?.toLowerCase();
    if (status !== 402 && !code && !/billing verification failed/i.test(detail)) return null;
    const headers = item.responseHeaders as Record<string, unknown> | undefined;
    const rawId = headers?.['x-request-id'] ?? headers?.['X-Request-Id'];
    return { status: Number.isFinite(status) ? status : 402, code: code ?? 'provider_billing_error', requestId: typeof rawId === 'string' && /^[\w.-]{1,200}$/.test(rawId) ? rawId : null };
  };
  return inspect(error);
}
