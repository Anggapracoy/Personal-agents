import type { ModelMessage } from 'ai';
import type { RunStore } from '../harness/types';

/** Publish only confirmed waits, after their tool-call/result messages are durable. */
export async function persistPauseClosingMessages(store: RunStore, runId: string, messages: ModelMessage[]) {
  const confirmations = messages.flatMap(message => message.role === 'tool' ? message.content.flatMap(part => {
    if (part.type !== 'tool-result' || part.toolName !== 'pause' || part.output.type !== 'json') return [];
    const value = part.output.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const { saved, paused, id, closingMessage } = value;
    return saved === true && paused === true && typeof id === 'string' && typeof closingMessage === 'string' && closingMessage.trim()
      ? [{ id, text: closingMessage.trim() }] : [];
  }) : []);
  if (!confirmations.length) return;
  const prior = await store.listMessages(runId);
  const published = new Set(prior.map(item => item.message.providerOptions?.wdyt?.pauseId).filter(Boolean));
  for (const confirmation of confirmations) {
    if (published.has(confirmation.id)) continue;
    await store.appendMessages(runId, [{ role: 'assistant', content: confirmation.text, providerOptions: { wdyt: { pauseId: confirmation.id } } }]);
    published.add(confirmation.id);
  }
}
