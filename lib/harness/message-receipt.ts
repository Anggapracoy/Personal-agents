/** Only provider acknowledgements advance receipts; queueing a run never does. */
export type MessageReceipt = { messageId: string; deliveredAt?: string; readAt?: string };
export function advanceMessageReceipt(receipt: MessageReceipt, event: string, at: string): MessageReceipt {
  if (event === 'response.created' || event === 'message_start') return receipt.deliveredAt ? receipt : { ...receipt, deliveredAt: at };
  if (['response.in_progress', 'reasoning-start', 'text-start', 'tool-input-start'].includes(event)) {
    return receipt.readAt ? receipt : { ...receipt, deliveredAt: receipt.deliveredAt ?? at, readAt: at };
  }
  return receipt;
}
export function readMessageReceipt(value: unknown): MessageReceipt | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (typeof r.messageId !== 'string') return null;
  const stamp = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : undefined;
  return { messageId: r.messageId, deliveredAt: stamp(r.deliveredAt), readAt: stamp(r.readAt) };
}
