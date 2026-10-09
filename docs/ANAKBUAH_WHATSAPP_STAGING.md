# Anakbuah WhatsApp staging checklist

Use a Meta test phone number and a single tester account first. Do not connect a production number until every item below passes.

## Configure the deployment

Set these server-only variables in staging:

```dotenv
WHATSAPP_VERIFY_TOKEN=<random-value>
WHATSAPP_APP_SECRET=<Meta-app-secret>
WHATSAPP_ACCESS_TOKEN=<Meta-system-user-token>
WHATSAPP_GRAPH_VERSION=v23.0
```

Also configure the normal Dash requirements: `DATABASE_URL`, `AUTH_SECRET`, Google OAuth values, an AI provider key, and Inngest keys. Never prefix these secrets with `NEXT_PUBLIC_`.

Run migrations against a backup of the staging database:

```sh
pnpm db:migrate
```

The ordered list includes migrations `0041` through `0044`. Do not run the full list against an existing production database without checking which migrations have already been applied.

## Configure Meta

Set the callback URL to:

```text
https://<staging-origin>/api/webhooks/whatsapp
```

Use the same `WHATSAPP_VERIFY_TOKEN` in Meta's subscription form. Subscribe to the `messages` field. Keep the test recipient limited to the owner account.

## Verify the flow

1. Sign in to the Anakbuah app and open Connected apps → WhatsApp.
2. Generate a link code and send `LINK <code>` to the Meta test number.
3. Confirm the one-time confirmation arrives and the code cannot be reused.
4. Send a normal Indonesian message and confirm it appears in the same Dash conversation after a second message.
5. Trigger a safe agent task that requires approval; confirm WhatsApp receives Setuju/Tolak buttons.
6. Tap Setuju and confirm the original run resumes. Tap Tolak in a separate run and confirm the external action is not executed.
7. Replay the same webhook payload and confirm no duplicate run or outbound message is created.
8. Temporarily remove the outbound token and confirm ingress remains authenticated but delivery is skipped safely.

Record provider message IDs, run IDs, and delivery keys while testing. Do not record access tokens or message bodies containing credentials.
