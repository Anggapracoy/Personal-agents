import { providerErrorChain } from "./provider-error";

/** Temporary provider throttling is resumable; quota/billing errors are not. */
export function rateLimitDelay(error: unknown, now = Date.now()): number | null {
  const items = providerErrorChain(error);
  const details = items.map(item => {
    const message = typeof item.message === "string" ? item.message : "";
    const body = typeof item.responseBody === "string" ? item.responseBody : "";
    return `${message} ${body} ${item.code ?? ""}`;
  });
  // A nested quota error takes precedence over an outer HTTP 429 wrapper.
  if (details.some(detail => /insufficient_quota|billing|credit balance|usage_limit_exceeded|request too large/i.test(detail))) return null;
  if (!items.some((item, index) => item.statusCode === 429 || item.status === 429 || /rate.limit.(?:reached|exceeded)|rate_limit_error/i.test(details[index]))) return null;
  let delay = 60_000;
  for (const item of items) {
    const headers = (item.responseHeaders ?? item.headers) as Record<string, string> | undefined;
    const retry = headers?.["retry-after"];
    const seconds = retry ? Number(retry) : NaN;
    const requested = retry ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - now) : 0;
    const millis = Number(headers?.["retry-after-ms"] ?? 0);
    delay = Math.max(delay, Number.isFinite(requested) ? requested : 0, Number.isFinite(millis) ? millis : 0);
  }
  return delay;
}
