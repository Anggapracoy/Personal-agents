# Anakbuah WhatsApp foundation

This branch adds the first channel boundary for Anakbuah on top of Dash. It is intentionally a pure, provider-facing contract; it does not send messages, store credentials, or execute user actions.

`lib/channels/whatsapp.ts` covers the pieces that must be deterministic at the edge:

- Meta webhook challenge verification.
- `X-Hub-Signature-256` verification against the exact raw body.
- Extraction of text, button, and list replies while ignoring status events.
- Construction of text and approval-button payloads for the WhatsApp Cloud API.

`lib/channels/anakbuah-behavior.ts` maps normalized inbound messages to the three safe runtime intents needed by the prototype: ordinary user message, approval, or rejection. Approval IDs are preserved from interactive button replies so the durable Dash approval store can be wired in the next stage.

## Next integration stage

The webhook route should be added only after the durable ingress path is selected. It must authenticate the request, persist the provider message ID for idempotency, resolve the user identity, and enqueue a Dash run. The route must not call a model or perform a booking inline. Outbound WhatsApp delivery will likewise go through a provider client with explicit approval receipts and retry state.

Required configuration will be introduced with the route, not hard-coded in this contract:

- `WHATSAPP_VERIFY_TOKEN` for the Meta subscription challenge.
- `WHATSAPP_APP_SECRET` for signature verification.
- A server-side access token and phone-number ID for outbound delivery, stored in the deployment secret manager.

Until that route and durable ingress exist, this branch is a tested foundation rather than a production WhatsApp integration.
