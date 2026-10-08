/** Meta sometimes returns model_not_found for an otherwise available model. */
export function isTemporaryMetaModelNotFound(error: unknown): boolean {
  const seen = new Set<unknown>();
  function inspect(value: unknown): boolean {
    if (!value || typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    const item = value as Record<string, unknown>;
    if (inspect(item.lastError) || inspect(item.cause)) return true;
    if (item.statusCode !== 404 || typeof item.url !== "string") return false;
    try {
      if (new URL(item.url).origin !== "https://api.meta.ai") return false;
      const body = typeof item.responseBody === "string" ? JSON.parse(item.responseBody) : item.data;
      return body?.error?.code === "model_not_found";
    } catch { return false; }
  }
  return inspect(error);
}
