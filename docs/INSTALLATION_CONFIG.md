# Installation-specific configuration

This source copy is independent of the original hosted service. Copy `.env.example` to `.env.local` and supply credentials for services you operate. Never commit real secrets.

## Web identity and access

- `NEXT_PUBLIC_APP_ORIGIN`: your public origin, used for metadata and the assistant's legal-page links. Defaults to `http://localhost:3000` for development.
- `NEXT_PUBLIC_SUPPORT_EMAIL`: your support address. The default `support@example.invalid` is a non-deliverable example.
- `NEXT_PUBLIC_IOS_DOWNLOAD_URL`: your App Store or TestFlight link; defaults to `/waitlist`.
- `GOOGLE_SITE_VERIFICATION`: optional Search Console verification token for your property.

`NEXT_PUBLIC_*` values are bundled at build time. Set them before `pnpm build` and rebuild after changing them. See the [Next.js environment variable guide](https://nextjs.org/docs/app/guides/environment-variables).

Google OAuth callbacks stay on the initiating origin. Register `/api/auth/callback/google` and `/api/connections/google/callback` in your own Google Cloud OAuth client for each supported origin. Configure Google push topics and webhook URLs in your own project.

## Privacy and feature access

This distribution has no administrator dashboard, cross-account conversation viewer, administrator login, product analytics collectors, or native telemetry upload endpoint. User-facing routes still enforce session ownership. Conversations remain server-stored and are not end-to-end encrypted from the database/hosting operator; describe that accurately in your deployment's privacy policy.

Calling and proactive work are enabled for all signed-in users by default, including fresh database migrations. They still require configured providers, connected sources and the relevant permissions. Rich structured replies (`rich_result_blocks`) are also enabled for everyone by default. App subscription billing and usage-credit enforcement have been removed. Feature policies are stored in `app_feature_flags`; saved policies, including explicit disables and per-user exclusions, are preserved. Modes are `selected`, `everyone`, or `none`. There is no privileged email identity. `selected` grants access only to normalized emails with an explicit enabled entry; an empty list grants nobody access. Configure these policies directly in your own deployment rather than through a public admin interface. `none` disables a feature globally. Configure the calling provider before use. Provider fees and provider-imposed limits still apply.

If upgrading an older installation, migration `0037_remove_telemetry.sql` deletes the obsolete analytics and run-diagnostic tables and converts legacy admin-only feature modes to explicit selected-user modes. Run migrations only against the intended database. This cleanup does not delete conversation history or external provider logs.

## Deployment registration

The Inngest GitHub workflow skips registration unless the repository variable `APP_ORIGIN` is set. Set it to your production HTTPS origin. The script registers that installation; it does not provision an account. For manual registration, use `pnpm inngest:sync https://your-deployment.example`.

Benchmark tools default to localhost. For a remote benchmark, pass your own `--base-url` or `DECISION_FEED_URL` where supported. The discovery evaluator only searches localhost browser cookies automatically; provide `DECISION_FEED_SESSION_COOKIE` explicitly for another installation.

## Native app

The example namespace is `com.example.dash`, with `group.com.example.dash` as the shared app group. Before distributing:

1. Replace every `com.example.dash` occurrence under `ios/` consistently, including extension/test bundle IDs, entitlements, shared-container references and Keychain service names. Changing the namespace after distribution requires a data migration plan.
2. Set your Apple team in `ios/Config/Shared.xcconfig` and the test target's signing settings. Register the app IDs and app group in your own developer account.
3. Set `DECISION_FEED_BASE_HOST` and `DECISION_FEED_BASE_URL` in `ios/Config/Release.xcconfig`. Preserve the `https:/$()/` xcconfig syntax. Debug uses localhost.
4. Match `APNS_BUNDLE_ID` to your main app identifier and supply your own APNs team, key ID and private key on the server.

The export/upload option files contain no team ID; Xcode derives it from the signed archive. No provisioning profile or hosted deployment is included.

## Retired subscription billing

Migration `0038_remove_app_billing.sql` removes the old subscription and usage-ledger tables and billing feature flag. It does not delete conversations or call Stripe. When upgrading an installation that previously charged subscriptions, retire those subscriptions in Stripe separately before dropping local billing records. The source removal does not cancel external charges.
