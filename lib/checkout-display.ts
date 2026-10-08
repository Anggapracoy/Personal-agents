/** Display only an explicitly labelled total; never guess a currency or sum line items. */
export function checkoutDisplayTotal(purpose?: string): string | undefined {
  if (!purpose) return undefined;
  const money = "(?:[A-Z]{2,3}\\$|[A-Z]{3}\\s+|[$€£])\\s*\\d+(?:,\\d{3})*(?:\\.\\d{2})?";
  const matches = [...purpose.matchAll(new RegExp(`(${money})\\s+total\\b|\\btotal(?:\\s+of)?\\s*:?\\s*(${money})`, "gi"))].map(match => match[1] || match[2]);
  return matches.length === 1 ? matches[0] : undefined;
}
