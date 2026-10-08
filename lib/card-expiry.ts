/** Display the expiry as entered while keeping month and year separated. */
export function formatCardExpiry(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 6);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/** Accept the two-digit expiry printed on most cards or a four-digit year. */
export function parseCardExpiry(value: string) {
  const match = /^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/.exec(value);
  if (!match) return null;
  const year = match[2]!;
  return { month: match[1]!, year: year.length === 2 ? `20${year}` : year };
}
