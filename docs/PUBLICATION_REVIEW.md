# Final pre-publication review — October 8, 2026

## Decision

Keep the repository private for now. The release repository is fresh, Git history is cleaned, and current source uses licensed replacements. One confirmed code issue remains before publication: unauthenticated mobile handoff creation. The GitHub object-retention issue described below has been resolved for the release repository.

## Confirmed findings

### P2: mobile finish accepts an invalid session cookie

`app/api/mobile/auth/finish/route.ts` checks only whether the session-token cookie exists before calling `createMobileAuthHandoff`. It does not ask Auth.js to verify the session or check revocation first, and has no handoff quota.

Reproduced against the production build with a disposable PostgreSQL database and no live provider credentials: `/api/auth/session` returned null for a synthetic invalid cookie; `/api/mobile/auth/finish` with that same cookie and a correctly formatted device challenge returned 302 with a handoff code and created one database record. This proves unauthenticated database writes and potential resource abuse. It does **not** prove account takeover: the invalid session still fails Auth.js validation.

Before publication, verify the authenticated session before creating the handoff and add a bounded per-account handoff quota. Cover invalid/revoked cookies, no cookie, a valid bound handoff, and replay. Preserve the existing verifier binding and Apple callback behavior.

### Closed: GitHub retained removed objects despite cleaned history

Thirteen superseded Apple-icon/restaurant-photo blobs were stripped from every local Git ref. The latest complete tree was identical before and after filtering. The cleaned main branch was pushed with a lease protecting the previous remote head. Old objects were pruned locally, and normal clones no longer receive them through branch history.

However, a direct authenticated GitHub blob API request for an old object still succeeded afterward. Therefore the repository's branch history is clean, but a complete host-side purge cannot be claimed. GitHub documents that history rewriting alone may leave cached views or references.

Resolved without deleting the original repository: it is retained privately as `mg272011/Dash-opensource-private-archive`. A fresh private release repository now occupies `mg272011/Dash-opensource`. All 13 superseded image blob IDs return HTTP 404 through the fresh release repository’s API. The complete source tree was preserved. The private archive retains the old GitHub run history and settings, and must remain private. A recovery bundle also exists outside the release checkout.

Reference: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository

## Recommended hardening and operational work

- Add production configuration validation for known placeholder `AUTH_SECRET` values. The example value currently meets the encryption helper's minimum-length check. This is a misconfiguration risk, not an exploit demonstrated against a properly configured installation. The README already instructs operators to generate a unique random secret.
- Bound/fence external deletion cleanup below its five-minute lease. Google and Composio calls have deadlines, but browser cleanup can perform a sequence of provider operations. A slow self-hosted worker could outlive its lease; stale cleanup must not delete a newly created profile after another worker finishes. This is a conditional race/hardening concern, not a demonstrated live-provider failure.
- Enable and verify private vulnerability reporting when the public repository supports it. SECURITY.md is present; the previous enable/query attempts while private returned 404.
- Qualify real Google/Apple OAuth, supported provider APIs, APNs and signed-device installation on an isolated deployment. No paid or externally visible operations were run for this review. Provider-side spending limits and account access policy remain operator responsibilities.
- A CONTRIBUTING.md and issue templates would improve contributor onboarding; these are optional and do not block source publication.

## Verified / not new findings

- Latest cleaned source commit: `81810cf`. GitHub Source checks and database jobs both passed: https://github.com/mg272011/Dash-opensource-private-archive/actions/runs/37841306442 .
- Full dependency audit reports zero known vulnerabilities.
- All five reachable commits were scanned with Gitleaks. Only the two existing synthetic-token fixture matches remain.
- Fresh startup migration sequence applied all 34 listed scripts to a disposable local PostgreSQL server.
- Current icon assets retain the complete Lucide/Feather notices, including the native bundle. The restaurant image has a recorded free Unsplash license and attribution, and the venue is explicitly an example.
- All three cover fonts already had matching upstream OFL notices. The initial suggestion that these were missing was incorrect; no duplicate notices were kept.
- The default `gpt-6.1-sol`, `gpt-6-luna` and `gpt-transcribe` model IDs are listed in official OpenAI API documentation. Account access and end-to-end calls remain unverified: https://developers.openai.com/api/docs/models .
- Ownership checks, body limits, bound secret release, DNS-pinned fetches, escaped artifact filenames and static SVG rendering were reinspected. No additional confirmed bypass was found in this bounded pass.
- Landing, Terms and Privacy remain included. Source publication and application deployment remain separate steps.

This is a bounded engineering review, not a guarantee that the software or every operator configuration is free of vulnerabilities. The reproduced authentication finding should be fixed before publishing.
