/** Only human-visible text. Never include tools, reasoning, attachments or vault payloads. */
export function morningMessageText(message: unknown): { role: 'user' | 'assistant'; text: string } | null {
  if (!message || typeof message !== 'object') return null;
  const value = message as { role?: unknown; content?: unknown };
  if (value.role !== 'user' && value.role !== 'assistant') return null;
  const text = typeof value.content === 'string' ? value.content : Array.isArray(value.content)
    ? value.content.flatMap(part => part?.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n') : '';
  if (!text.trim()) return null;
  return { role: value.role, text: cleanMorningText(text, 2500) };
}

export function cleanMorningText(text: string, limit = 4000) {
  return text.replace(/\b(?:sk|rk|pk)[-_][a-zA-Z0-9_-]{16,}\b/g, '[redacted key]')
    .replace(/\b(?:password|passcode|verification code|one.time code|otp|cvv|cvc)\s*[:=]\s*\S+/gi, '[redacted secret]')
    .slice(0, limit);
}

