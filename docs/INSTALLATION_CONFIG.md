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

## Request limits and trusted ingress

Routes that parse request bodies enforce byte limits while reading, including chunked requests with no Content-Length. Limits range from 2 KiB for iCloud credentials to 6 MiB for chat/share envelopes; file bytes still have their separate 3 MiB combined limit. Body reads time out after 15 seconds. Set corresponding body, header, connection and timeout limits at your reverse proxy too.

Weather requires a signed-in account and has per-account quotas. The waitlist trusts `x-vercel-forwarded-for` only on Vercel. Elsewhere, set `TRUSTED_CLIENT_IP_HEADER` only if your ingress **overwrites** it for every request and the app cannot be reached around that ingress. Without a trusted header, clients share a conservative waitlist quota; ordinary forwarded headers cannot choose a new bucket.

## Browser isolation and upgrades

Set a stable, unique `DASH_INSTALLATION_ID` for each production, staging or development installation. Every worker in that installation must use the same value. The fallback derives an identifier from the session secret, public origin and environment; changing those values can change the namespace. E2B controller metadata and Browserless profile names include this namespace. Never deliberately reuse installation identity and provider credentials across unrelated deployments.

Old controllers/profiles from before this change are not automatically adopted or deleted: they cannot be safely attributed to one installation. Before upgrading, stop its browser work and remove its old controllers/profiles through the provider account you control. Users will sign in to websites again in the new profiles. Do not delete resources belonging to another deployment. Rotate/remove stale provider resources when changing installation identity.

## Deletion and provider outages

Apply `0039_deletion_cleanup.sql` before updating the app. Local data deletion and an encrypted external-cleanup job commit together. The cleanup job retains only disconnection credentials/identifiers, retries failed Google/Composio/browser cleanup, and is removed on success. Sign-in is blocked while cleanup is pending so retrying an old deletion cannot delete newly connected accounts. Existing encrypted credentials require the same stable `AUTH_SECRET` until cleanup finishes.

Register the `retry-account-deletions` Inngest function; it retries every five minutes. For installations without Inngest, schedule or explicitly run:

```sh
node --env-file=.env.local -e 'require("node:child_process").execFileSync("pnpm", ["accounts:cleanup"], {stdio: "inherit"})'
```

This command contacts configured external providers to finish requested deletions. Inspect `account_deletion_jobs` counts, oldest `created_at`, and `attempts` during operations; restore missing provider credentials or resolve provider failures rather than deleting the pending jobs. Local deletion also clears retired moment/delivery tables if they still exist and removes the matching waitlist entry. Migration `0031` remains an explicit post-deployment transition, not part of the fresh startup command.

## Native authentication upgrade

Apply `0040_mobile_handoff_binding.sql` and build the matching iPhone wrapper version 3. New sign-in attempts create a random verifier on the device, send only its SHA-256 challenge during authorization, and redeem the one-time handoff with the verifier using a POST. A stolen handoff code alone is insufficient. Old unbound handoffs are invalidated by the migration. Existing signed-in sessions are not converted into new handoffs.

## Provider costs and access

Calling, proactive features and rich replies remain enabled for everyone by default, as intended. This source has no subscriptions, app usage credits or monetary spend cap. Set provider-side hard spending limits where supported, configure alerts, restrict who can sign in to your deployment, and configure feature policies before inviting users. Disabling a feature prevents new work in that feature; it does not undo an already submitted call, purchase or other external action. Quotas and concurrency limits are abuse controls, not a dollar budget. We did not change any live provider account or initiate paid validation.

## Security reports and CI

`checks.yml` runs frozen installation, unit tests, TypeScript, production build, a dependency audit, and isolated PostgreSQL tests. Native signing, live OAuth and provider actions require separate operator validation. See `SECURITY.md` for reporting. GitHub returned HTTP 404 when private vulnerability reporting was queried/enabled while this repository was private; verify feature availability and enable it before public release. Adding the policy file alone does not enable the GitHub reporting feature.

## Optional local Chrome import

Importing the Mac operator's Chrome sessions is disabled by default. To enable it, set `CHROME_PROFILE_IMPORT_LOCAL=1` and `CHROME_PROFILE_IMPORT_OWNER` to the operator's exact signed-in email. Only that account and a loopback URL are accepted. Bind the local server to loopback and do not expose it through a tunnel or public reverse proxy. This is a local operator tool, not a multi-user hosted feature. No local Chrome files or cookies were read during the security tests.

Use separate Composio projects/credentials for separate installations; its connected-account user identity is scoped to the provider project. Browser namespaces do not isolate unrelated services that share one provider project.

## Final authentication and cleanup hardening

Production authentication, OAuth state and encrypted credential use require a unique random `AUTH_SECRET` of at least 32 characters. Known examples/placeholders and repeated-character secrets are rejected at runtime. Building the source does not require live deployment secrets. Generate the value using the README command. Keep it stable: an older installation with a shorter secret needs a credential/data migration plan rather than blindly changing the encryption key.

Mobile sign-in finish validates the Auth.js session and revocation state before creating a handoff, and admits at most six handoffs per minute/thirty per hour per account. Cookie chunking and the native verifier are preserved. Temporary Google refresh transport failures are bounded and keep the verified identity usable while source access recovers.

Deletion cleanup has a shared two-minute deadline inside its five-minute lease. Google, Composio and browser operations receive abort signals, and destructive operations check ownership before execution. An expired/superseded attempt cannot clear the pending-account lock. Failed or malformed jobs remain queued for retry. Provider-side timeout outcomes still require the existing retry/idempotency behavior; local tests do not certify every live provider implementation.

### Publication step: private vulnerability reporting

GitHub only exposes private vulnerability reporting for public repositories. Once publication of this exact release repository has been authorized and performed, enable and verify it:

```sh
gh api --method PUT repos/mg272011/Dash-opensource/private-vulnerability-reporting
gh api repos/mg272011/Dash-opensource/private-vulnerability-reporting
```

Verify `enabled` is true. Do not change the visibility of `Dash-opensource-private-archive`. Live Google/Apple OAuth and provider qualification were explicitly deferred while code/local checks were completed; validate them on an isolated deployment before offering a hosted service.
