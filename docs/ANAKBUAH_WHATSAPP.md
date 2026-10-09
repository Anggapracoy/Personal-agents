# Anakbuah WhatsApp foundation

This branch adds the first channel boundary for Anakbuah on top of Dash. It is intentionally a pure, provider-facing contract; it does not send messages, store credentials, or execute user actions.

`lib/channels/whatsapp.ts` covers the pieces that must be deterministic at the edge:

- Meta webhook challenge verification.
- `X-Hub-Signature-256` verification against the exact raw body.
- Extraction of text, button, and list replies while ignoring status events.
- Construction of text and approval-button payloads for the WhatsApp Cloud API.

`lib/channels/anakbuah-behavior.ts` maps normalized inbound messages to the three safe runtime intents needed by the prototype: ordinary user message, approval, or rejection. Approval IDs are preserved from interactive button replies so the durable Dash approval store can be wired in the next stage.

## Ingress boundary

`app/api/webhooks/whatsapp/route.ts` now authenticates Meta requests, claims each provider message exactly once, resolves the sender through `whatsapp_identities`, creates a Dash run, and dispatches it through the existing durable worker. The route does not call a model or perform a booking inline. It returns `202` after admission; outbound WhatsApp delivery will go through a provider client with explicit approval receipts and retry state.

The app endpoint `POST /api/connections/whatsapp/link-code` creates a one-time code valid for ten minutes. Send `LINK <code>` to the Anakbuah WhatsApp number. The sender number is then bound to the authenticated app account; the sender number alone is never enough to choose an owner.

Manual provisioning remains available for operators during early staging:

```sql
insert into whatsapp_identities(phone_number_id, wa_id, owner_email)
values ('META_PHONE_NUMBER_ID', '628123456789', 'owner@example.com');
```

Unmapped senders are recorded as unlinked and are not dispatched. Duplicate provider message IDs are acknowledged without creating another run.

Required configuration will be introduced with the route, not hard-coded in this contract:

- `WHATSAPP_VERIFY_TOKEN` for the Meta subscription challenge.
- `WHATSAPP_APP_SECRET` for signature verification.
- A server-side access token and phone-number ID for outbound delivery, stored in the deployment secret manager.

`lib/channels/whatsapp-client.ts` provides the authenticated Graph API sender and refuses to send without an explicit payload. The Inngest worker now uses `whatsapp_outbound_deliveries` to send completion and approval receipts with a stable idempotency key. `whatsapp_identities.run_id` keeps normal messages in one durable Dash conversation; a missing or deleted run starts a fresh thread.
