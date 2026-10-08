# Open-source release review — October 8, 2026

**Status: local checks passed and the dependency audit is clear after updates. Asset-rights and live-service verification remain before publication.** No GitHub repository was created, nothing was deployed, and no live database or provider account was used.

## Local installation and functionality

Testing used a new copy with a fresh `node_modules` install, Node 22.17.1, pnpm 10.32.1 and a disposable PostgreSQL 16.14 server bound to loopback. It did not reuse the original application's environment file or dependency directory.

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed. pnpm reported skipped optional install scripts for bufferutil, esbuild and protobufjs; the subsequent checks below passed. |
| Startup SQL sequence | All 32 current migrations listed by `db:migrate` applied to an empty database after removing subscription billing; no billing tables created. |
| `pnpm test` | 1,108 passed after billing removal; 30 integration/live-service tests skipped by default. |
| Additional real-PostgreSQL integration tests | 68 passed, none skipped in the selected suite after billing removal. Covered persistence, account isolation, schedules, pauses, replies, artifacts, session revocation and capacity limits. |
| `pnpm lint` | Passed. |
| `pnpm build` | Passed using the default Turbopack build. |
| Fresh-copy iOS simulator build | Passed with signing disabled in the initial review. No Swift or native project files changed in the dependency update. |
| Production-server HTTP checks | Nine checks passed: landing and authenticated native workspace rendered; owner could read stored run/messages; anonymous access returned 401; another account returned 404; former admin/analytics URLs returned 404. |

The SQL files were executed with the PostgreSQL client library against the real server because the disposable server package does not contain the `psql` executable. The README command's environment loading and migration file list were separately validated with a non-database stub in the preceding documentation check. This does not claim a literal `psql` run on this machine.

The integration suite needed a separate disposable capacity database and a non-`react-server` invocation for the direct Auth.js test. It used Node's `--test-force-exit` because some test workers retain connections after assertions finish. An old conversation-notification expectation was updated to include the existing `stale: false` field; no notification behavior was changed.

HTTP authentication used synthetic local sessions. Real Google/Apple OAuth, APNs delivery, Inngest Cloud, AI calls, Browserless/E2B, Composio, phone calls and signed-device installation were not exercised. No paid actions were initiated. Those need operator credentials and separate end-to-end qualification.

## Dependency findings — resolved

The initial full audit reported 59 advisory matches (24 high, 27 moderate, 8 low), covering 46 distinct advisory URLs. The initial production-only audit reported 55 matches (21 high, 26 moderate, 8 low), covering 42 distinct advisory URLs. These were dependency matches, not counts of proven exploits against this app.

After the updates, both `pnpm audit --json` and `pnpm audit --prod --json` report **zero known vulnerabilities**. No audit exclusions or severity filters were added. This is a result against the current advisory database, not a guarantee that no undiscovered vulnerability exists.

| Direct dependency | Before | After |
|---|---|---|
| Next.js | 16.3.6 | 16.3.8 |
| sharp | 0.35.4 | 0.35.5 |
| Nodemailer | 8.0.11 | 10.0.16 |

Targeted pnpm overrides patch the affected transitive versions of Undici, brace-expansion, PostCSS, nanoid, Kysely, @grpc/grpc-js, source-map-js and baseline-browser-mapping. E2B's optional `undici8` alias is explicitly patched too; changing only the normal `undici` package does not cover that alias. Retain the overrides until upstream dependency resolutions are verified to select fixed versions, and repeat the audit after dependency updates.

Nodemailer 10 includes its own TypeScript declarations, so the direct `@types/nodemailer` dev dependency was removed. Two offline regression tests exercise real MIME composition, Unicode, stable message/reply IDs, recipient receipts, all-recipient rejection and transport cleanup. They use an in-memory transport and send no email.

One **non-security peer-version warning** remains: the current Auth.js packages declare an optional Nodemailer 7/8 peer range. Dash configures Google, Apple and Credentials providers, not Auth.js's Nodemailer email-link provider; Nodemailer 10 is used separately for iCloud SMTP. The warning is documented rather than suppressed, and the real Auth.js session/revocation tests pass. If adding email-link authentication, verify supported upstream versions first; do not restore the vulnerable SMTP dependency to silence the warning. See [Nodemailer requirements](https://nodemailer.com/) and its [changelog](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md).

The first heavily parallel unit run hit an existing browser pool test timing issue. All 68 browser-runtime tests passed in isolation, and the full unmodified test command then passed. No production browser behavior or test assertion was relaxed for that retry.

Primary advisory references: [Next.js SSRF](https://github.com/advisories/GHSA-cjq9-62q9-8jv4), [sharp/librsvg](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), [Nodemailer parser denial of service](https://github.com/advisories/GHSA-v53p-9fqp-m79j). No attack payload was run against an external system.

The source review also inspected ownership checks for conversation/run reads, account deletion, workspace persistence, link-preview access and session revocation. The real-database and HTTP checks support those examined boundaries; they do not constitute a comprehensive penetration test.

## Subscription billing removed

The Stripe SDK, subscription API routes, checkout/portal/webhook handlers, plan page, usage-meter and upgrade UI, model/transcription credit accounting, weekly allowances and paid-plan guards have been removed. The production build passed, and all five former billing URLs returned 404. Model requests now go directly to their configured providers. Benchmark-only price estimation lives under `scripts/benchmarks/model-cost.ts` and does not enforce an application limit.

Migration `0038_remove_app_billing.sql` drops obsolete local billing tables and the billing feature flag. This is a local source change: it does not cancel external Stripe subscriptions. The original private repository and live services were not modified. Ordinary request-rate, concurrency, ownership and tool-approval protections remain.

## Secrets and personal data

- Gitleaks found only the two known dummy `recipientToken` fixtures in `tests/harness.test.ts`; no real credential was identified.
- Searches found no remaining original personal email, hosted-service domains, Apple team IDs, Stripe account IDs or original telemetry ID from the earlier cleanup.
- No unexpected environment files, private-key files or local database files were present in the release tree.
- The author copyright in `LICENSE` and README is intentional.
- Original repository contents were checked independently and left unchanged.

This assessment covers the release directory, not the original private Git history. Publish with fresh Git history as planned.

## Asset licensing

See [the asset review](THIRD_PARTY_ASSETS.md). Three missing SIL OFL notices were added for the bundled fonts, matching their embedded metadata. Existing card-network, iPhone-frame and cursor-motion notices were retained.

**Still unresolved:** redistribution permission for the copied Apple app icons and the L'Artusi restaurant photo. Attribution/source links alone do not establish permission. Confirm rights or replace these assets before distributing the repository. Confirm ownership of the project-supplied artwork as well.

## Next actions

1. Resolve the identified artwork permissions or replace the assets with redistributable alternatives.
2. Qualify real OAuth and whichever external providers will be supported, using an isolated deployment and explicit authorization for paid or externally visible actions.
3. Repeat the release scan on the final tree, then create and publish the new repository only after approval.
