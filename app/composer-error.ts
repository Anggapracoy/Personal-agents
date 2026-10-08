/** UI copy is chosen here; server diagnostics never become composer content. */
export function composerError(value: unknown, fallback = "Couldn’t send. Try again."): string {
  if (!value) return "";
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  if (/^You’ve hit the limit for now\./.test(message)) return message;
  if (/^Too many requests/i.test(message)) return "You’ve hit the limit for now. Try again in a few minutes.";
  if (/^(Attach up to 6|Shared files are larger than 3 MB)/.test(message)) return "Choose up to 6 files, 3 MB total.";
  if (/^(Authentication required\.?|Unauthorized|Sign in)/i.test(message)) return "Sign in again to continue.";
  if (/^(Failed to fetch|NetworkError|Load failed|The Internet connection appears to be offline)/i.test(message)) return "Check your connection and try again.";
  return fallback;
}
