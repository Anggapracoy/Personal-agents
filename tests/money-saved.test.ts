import test from "node:test";
import assert from "node:assert/strict";
import { savingsThisYear } from "../app/money-saved";
import type { HistoryEntry } from "../lib/types";

const entry = (overrides: Partial<HistoryEntry>): HistoryEntry => ({
  id: crypto.randomUUID(), category: "money", title: "Task", subtitle: "", time: "", group: "TODAY", status: "saved",
  originalContext: "", chosenOption: "", steps: [], outcome: "", completedAt: "2026-09-10T12:00:00Z", ...overrides,
});

test("nothing saved means nothing shown, never $0", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  assert.equal(savingsThisYear([], now), null);
  assert.equal(savingsThisYear([entry({ status: "done" })], now), null);
  assert.equal(savingsThisYear([entry({ moneySaved: { amount: 0, currency: "USD", cadence: "one_time", basis: "none" } })], now), null);
});

test("this year's savings add up, counting a year of monthly savings", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  const summary = savingsThisYear([
    entry({ title: "Cancelled Hulu", moneySaved: { amount: 18, currency: "USD", cadence: "monthly", basis: "Stopped the plan" } }),
    entry({ title: "Refund for headphones", moneySaved: { amount: 89, currency: "usd", cadence: "one_time", basis: "Refund" } }),
    entry({ title: "Last year", completedAt: "2025-12-30T12:00:00Z", moneySaved: { amount: 500, currency: "USD", cadence: "one_time", basis: "Old" } }),
    entry({ title: "Failed", status: "failed", moneySaved: { amount: 40, currency: "USD", cadence: "one_time", basis: "No" } }),
  ], now);
  assert.deepEqual(summary, { amount: 18 * 12 + 89, currency: "USD", tasks: 2, biggest: "Cancelled Hulu" });
});
