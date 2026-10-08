import crypto from 'node:crypto';

export function verifyWebhook(mode, token, challenge, expectedToken) {
  if (mode !== 'subscribe' || !token || !expectedToken || token.length !== expectedToken.length) return null;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken)) ? challenge : null;
}

export function verifySignature(rawBody, signature, appSecret) {
  if (!rawBody || !signature || !appSecret || !signature.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = signature.slice('sha256='.length);
  return received.length === expected.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export function parseWebhook(payload) {
  const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message || !message.from) return null;
  const text = message.type === 'text' ? message.text?.body : message.type === 'interactive' ? message.interactive?.button_reply?.id : null;
  if (!text) return null;
  return { messageId: message.id, userId: message.from, text, receivedAt: message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date() };
}

export function textMessage(to, body) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body } };
}

export function approvalButtonMessage(to, body, reminderId) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'interactive', interactive: { type: 'button', body: { text: body }, action: { buttons: [{ type: 'reply', reply: { id: `approve:${reminderId}`, title: 'Setuju' } }, { type: 'reply', reply: { id: `cancel:${reminderId}`, title: 'Batal' } }] } } };
}

export async function sendWhatsAppMessage({ phoneNumberId, accessToken, to, message, apiVersion = 'v23.0' }) {
  if (!phoneNumberId || !accessToken) throw new Error('WhatsApp sender is not configured');
  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(message)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`WhatsApp API ${response.status}: ${body.error?.message || 'request failed'}`);
  return body;
}
