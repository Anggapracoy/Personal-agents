import type { HistoryEntry } from "../lib/types";

export type SavingsSummary = { amount: number; currency: string; tasks: number; biggest: string };

/** A year of a recurring saving counts; a one-time saving counts once. */
function yearlyValue(saved: NonNullable<HistoryEntry["moneySaved"]>) {
  if (typeof saved === "number") return { amount: saved, currency: "USD" };
  return { amount: saved.cadence === "monthly" ? saved.amount * 12 : saved.amount, currency: saved.currency.toUpperCase() };
}

/** Money Dash saved this calendar year, in the user's main currency. Null when there is nothing to show. */
export function savingsThisYear(history: HistoryEntry[], now = new Date()): SavingsSummary | null {
  const year = now.getFullYear();
  const seen = new Set<string>();
  const byCurrency = new Map<string, { amount: number; tasks: number; biggest: { title: string; amount: number } }>();
  for (const entry of history) {
    if (!entry.moneySaved || entry.status === "failed" || entry.status === "dismissed") continue;
    const completed = entry.completedAt ? new Date(entry.completedAt) : null;
    if (!completed || completed.getFullYear() !== year) continue;
    const key = entry.runId ?? entry.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const { amount, currency } = yearlyValue(entry.moneySaved);
    if (!(amount > 0)) continue;
    const total = byCurrency.get(currency) ?? { amount: 0, tasks: 0, biggest: { title: entry.title, amount: 0 } };
    total.amount += amount;
    total.tasks += 1;
    if (amount > total.biggest.amount) total.biggest = { title: entry.title, amount };
    byCurrency.set(currency, total);
  }
  const [currency, total] = [...byCurrency.entries()].sort((a, b) => b[1].amount - a[1].amount)[0] ?? [];
  if (!currency || !total || total.amount < 1) return null;
  return { amount: Math.round(total.amount), currency, tasks: total.tasks, biggest: total.biggest.title };
}

export function formatSavings(amount: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount); }
  catch { return `${currency} ${amount}`; }
}
