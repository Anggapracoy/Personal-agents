# Open-source release review — October 8, 2026

**Status: the 16-item follow-up and a second code/secret/dependency review are complete locally. The GitHub repository remains private. Publication and deployment are separate release steps; see the Git history and Actions run for the committed source and CI status.** No live user credentials, paid model/browser/calling actions, or production database were used.

The reviewed baseline was commit `28db8e0`; the results below apply to the subsequent local working tree. This is a bounded review, not a claim that every possible vulnerability has been eliminated.

## Follow-up on all 16 findings

| # | Finding | Result |
|---|---|---|
| 1 | Public weather proxy | Authentication, per-user quota, coordinate validation and upstream timeout added. Anonymous HTTP request now returns 401. |
| 2 | Body buffering before limits | Shared byte-limited readers wrap application parsers, Auth.js, Resia and Inngest; chunked input and declared sizes are checked, body reads time out, and over-limit input cannot reach mutating handlers. Inngest has a separate 16 MiB envelope limit. |
| 3 | Spoofed shared-file size | Sizes are calculated from decoded bytes; malformed base64, extra files and oversized totals are rejected. The prior 18 MiB/zero-size reproduction now fails. |
| 4 | Provider outages stop deletion | Local deletion and an encrypted cleanup outbox commit together. Provider cleanup retries through Inngest or the operator CLI; pending cleanup temporarily blocks sign-in. Tested with a failing provider stub, local deletion, retry and lock removal. |
| 5 | Shared browser namespace | E2B metadata and Browserless profiles include installation identity. Upgrade instructions explain old-resource cleanup and separate provider projects. No live provider resources were changed. |
| 6 | SQL errors do not stop migration command | Every psql call uses `-X -v ON_ERROR_STOP=1`. The list remains an explicitly ordered startup sequence, not an upgrade ledger. |
| 7 | Missing login route | `/login` now explains the native sign-in flow and links home. It renders successfully; browser-only chat is still unsupported. |
| 8 | MIT/service-terms conflict | Source-license rights are explicitly preserved; hosted-service termination does not terminate MIT rights. |
| 9 | Privacy inaccuracies | AI-provider options, retired location moments, standing approvals and pending external-deletion cleanup are described accurately. Operators must qualify their own provider configuration. |
| 10 | Bearer-only mobile handoff | Native S256 verifier/challenge binding added; redemption is a POST and requires the verifier. Wrong-verifier attempts do not consume the real attempt; replay is rejected. Requires migration 0040 and wrapper version 3. |
| 11 | Spoofable waitlist IP | Only Vercel ingress or an explicitly configured, ingress-overwritten header is trusted. Other requests share a conservative quota. |
| 12 | Legacy records survive deletion | Deletion clears retired moment/delivery tables when present and the matching waitlist row. It also clears legacy user token/location/preferences fields when keeping the account. Legacy Google tokens join the encrypted revocation queue. |
| 13 | Fixed model selections | Main provider/model and proactive/transcription models are configurable. Main environment overrides take precedence over saved global choices. Availability and supported model options require operator verification. |
| 14 | Missing CI/security policy | GitHub workflow and SECURITY.md added. GitHub returned 404 when enabling private vulnerability reporting; verify and enable that feature before public release. The workflow runs on source pushes and pull requests; its current result is recorded in GitHub Actions. |
| 15 | Artwork permissions | Maintainer explicitly chose to retain existing Apple icons and the restaurant photograph. Unresolved redistribution rights remain documented in THIRD_PARTY_ASSETS.md. |
| 16 | Provider-spending exposure | Operator cost controls and access configuration are documented. Calling/proactive access remains on by default; no subscriptions, app credits or dollar cap were reintroduced. No live spending settings were changed. |

## Additional findings from the second pass

- Disabled Composio SDK usage tracking and background version checks explicitly; removing the application analytics SDKs alone did not change that provider SDK default.
- Local Mac Chrome-cookie import now requires explicit opt-in, the configured operator email and a loopback URL. Merely being a signed-in user is insufficient. Tests did not read any actual browser cookies.
- Both Google sign-in paths require an explicitly verified Google email before using it as the account identity.
- The legacy user-table cleanup and additional legacy-token revocation described above were discovered while rechecking deletion coverage.

No further confirmed code blocker was identified in the final bounded pass. The external/operational items below remain open.

## Verification

| Check | Result |
|---|---|
| Frozen dependency install | Passed using pnpm 10.32.1. Optional skipped build-script notices remain; the builds below passed. |
| Unit/contract suite | 1,117 passed, zero failed; 32 tests skipped by default. |
| Disposable PostgreSQL 16 integration suite | 70 passed, none skipped in the selected suite. Includes failed-provider deletion recovery and device-bound handoff redemption/replay. |
| Latest deletion/auth regression check | 5 passed after the final legacy-token cleanup adjustment. |
| Startup migrations | All 34 scripts in the package startup list applied to a fresh local database. |
| TypeScript | Passed. |
| Production Next.js build | Passed. |
| iOS simulator build | Passed with signing disabled, including wrapper version 3. |
| Production HTTP checks | 20 passed: public pages, login fallback, anonymous access, body limit, handoff proof/replay, weather validation, native workspace and owner isolation. |
| Browser inspection | Landing, Privacy and login fallback visually checked; Terms navigation and updated content verified. |
| Dependency audits | Full and production-only audits both report zero known vulnerabilities. |
| Secret scan | Current source, including new/untracked files, scanned with Gitleaks. Only the two existing synthetic test-token matches at tests/harness.test.ts:279 and :433. Git history was already scanned at the two-commit baseline. |
| Whitespace | `git diff --check` passed. |

The local PostgreSQL package lacks the psql executable. Migration SQL ran through the PostgreSQL client library against the real server; this is not a claim that the literal psql command was executed locally. CI uses psql against its disposable PostgreSQL service.

HTTP authentication used synthetic local sessions. Live Google/Apple OAuth, APNs, Inngest Cloud, model access, Browserless/E2B, Composio, calling and signed-device installation were not exercised. The native build and HTTP handoff tests do not replace those live integration checks. Temporary review servers and the disposable database are shut down after verification.

## Remaining release/operational work

1. Retained artwork still has unresolved redistribution rights, by the maintainer's explicit choice.
2. Enable/verify GitHub private vulnerability reporting when the repository's feature availability permits it; the attempt here returned 404.
3. Apply migrations 0039 and 0040 and distribute the matching wrapper version 3 when deploying these changes. Configure the cleanup worker and monitor pending deletion jobs. Clean up old browser namespaces through the provider before upgrading an existing installation.
4. Qualify the supported live providers using your own isolated deployment and credentials, and set provider-side spending/access limits.
5. Keep deployment and any change to public visibility as separately authorized release steps.

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
