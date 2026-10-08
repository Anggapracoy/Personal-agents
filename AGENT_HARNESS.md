# Decision Feed Agent Harness

This document is the implementation contract for Decision Feed. A card is not a mock command: choosing an option creates a durable thread that receives the complete source context, works it with a selected model in one tool-calling loop, pauses before consequential changes, and ends with a structured `present_result` plus a plain-language reply. Follow-up messages continue the same thread.

## Capabilities

### Authenticated services

- Google OAuth grants Gmail read/write and Calendar event access.
- OAuth access tokens are copied into a run-scoped secret store. Secrets are never placed in model prompts, run metadata, snapshots, narration, artifacts, or E2B.
- Gmail tools can read a source message, download an attachment, create a reversible draft, and propose sending that draft. Sending always pauses for explicit approval.
- Calendar tools can read an event and propose an event update. Updating always pauses for explicit approval.
- Arbitrary billing and booking portals use an account-scoped E2B cloud-browser profile. Chrome and its cookies live entirely in E2B, persist between runs, and can be signed into through an authenticated remote takeover stream.
- Connected MCP tools remain supported. Unknown or mutating MCP tools default to approval-required; only explicit read patterns and drafts are auto-executed.

### Complete execution context

The card classifier sees every fetched inbox message. A resulting card retains:

- Gmail message/thread IDs, sender, recipients, subject, date, full normalized body, extracted HTTPS links, confirmation/order/booking identifiers, and attachment metadata.
- Calendar IDs, times, location, description, attendees, and Google event URL.
- The signed-in user's name and email.
- The exact selected option and its declared action type.

Attachments are fetched only when the agent requests them. Binary attachment data is stored as a run artifact and is never inserted into a prompt.

### Universal browser model

- The single `browser_*` tool family provides interactive and authenticated browsing inside an E2B Desktop sandbox. Model-authored `sandbox_run` is a separate E2B terminal workspace whose files persist across calls and whose outbound internet access is unrestricted. It receives no local files, browser cookies, host credentials, or API keys. Python/JavaScript may execute sandbox-local commands, tests, and bulk crawlers, never host commands.
- The cloud browser supports open, inspect, click, type, select, checkbox/radio changes, scrolling, back navigation, screenshots, waiting, and user takeover through DOM/accessibility-style element references. Snapshots expose current non-sensitive form values while redacting passwords, OTPs, card fields, tokens, and secrets. Screenshots require an intended HTTPS target and are rejected unless the live page identity matches it.
- Its E2B profile is keyed to the signed-in Decision Feed account and persists service sessions across pauses and later server processes. No code launches or attaches to a browser on the user's computer.
- When login, CAPTCHA, MFA, password entry, or a manual challenge is required, `browser_request_takeover` pauses the run. The authenticated E2B noVNC stream is available only to the run owner; after manual work, clicking Continue resumes from a fresh DOM snapshot.

### Approval invariant

The harness, not the prompt, enforces the boundary:

- Read-only API calls and page inspection run immediately.
- Drafting, typing, local files, and other reversible preparation run immediately and remain auditable.
- Sending, submitting, purchasing, paying, booking, cancelling, accepting, deleting, publishing, or updating an external system creates a proposed action and changes the run to `awaiting_approval`.
- A proposed action cannot execute without an approver identity and timestamp.
- Cloud-browser clicks are classified from the live DOM before execution. Consequential controls use the same durable approval path as external APIs.
- The browser controller is harness-owned and Chrome's DevTools port is bound only inside the E2B desktop. Arbitrary model-authored sandbox code runs in a separate network-disabled sandbox.

### Structured results

Every successfully completed run produces an `AgentResult` containing:

- outcome state, concise summary, grounded details, verification status, and whether an external change occurred;
- sourced facts and useful links;
- optional one-time, monthly, or annual money savings with currency and calculation basis;
- an optional recommended next step;
- an optional ordered `blocks` array (see Result blocks).

The original feed card stays present while its run is active, then expands with the structured result. Archiving the result moves the same grounded outcome, files, and money-saved amount into History. Failed runs restore the card's actions instead of silently deleting the decision.

### Result blocks

`present_result` accepts `blocks`, a list of at most 16 data-only blocks that the app renders in exactly the order the agent lists them. There is no model-authored code or markup. Types: `text`, `stats`, `callout`, `timeline`, `table`, `place`, `link_card`, `image_row`, `checklist`, `section` (a group of other blocks, never nested), `action`, `key_value`, `draft`, `event`, and `contact`. Schemas and normalization live in `lib/harness/result-blocks.ts`; rendering is `app/result-blocks.tsx`.

- Normalization keeps order and removes only what cannot render safely: non-HTTPS links and images, unknown action ids, malformed dates, and invalid phone numbers or email addresses. Short table rows are padded. Content is never invented.
- Consecutive titled `timeline` blocks and `section` blocks render together as one card of tappable rows. Rows start closed, show the timeline’s one-line `summary` (or its first stops when none is given), and open by animating height. A lone row starts open unless a section is marked collapsed. Untitled timelines render as a plain list.
- `action` blocks and an event's `calendarActionId` reference `followUpActions` ids. Pressing one sends that follow-up's `intent` as an ordinary user message, so every consequential step still reaches the harness approval path. Result screens without a composer (such as a dismissed-decision entry) hide them.
- `draft` is a read-only display of an email or message. Sending still uses the approval card and `gmail_send_draft`.
- Images load through the authenticated `/api/link-preview?image=` proxy. A `place` or `link_card` with a URL and no image falls back to that page's preview image, then to a letter tile.
- If a result has no blocks, the plain-text reply and any `options` render as before.

## Example workflows

1. **Message someone from an email:** read the source message, create a Gmail draft, show the exact recipients/subject/body, call `gmail_send_draft`, pause, and send only after approval.
2. **Inspect or cancel a booking:** open the source URL in the E2B cloud browser, use a saved login or the sign-in handoff if login is needed, inspect booking and cancellation details, then pause on the final cancellation control before clicking it.
3. **Pay or renew:** inspect the authenticated billing page, report the verified amount/payment method, and pause on the final pay/renew control. Never put payment credentials into E2B.
4. **Research choices:** use the DOM-driven E2B browser for a small or interactive investigation. For large lists or repeated extraction, use one rate-limited public-web terminal crawler that checkpoints, validates, deduplicates, and records an exact public `source_url` for every row; never infer an email from a domain.
5. **Fill an application:** open the form in the E2B cloud browser, fill known non-secret fields, use the sign-in handoff for login and remote takeover for MFA, preserve unanswered questions, and pause on the final submit control.
6. **Do nothing intentionally:** when the selected choice is to let something expire or skip it, make no external mutation. Record the outcome and only claim savings when the source supplies a defensible amount and cadence.

## Verification

- Unit tests cover context preservation, secret isolation, tool risk classification, approval/resume behavior, structured results, browser safety, and UI card restoration/expansion.
- Unit tests execute authenticated Gmail draft/send flows against a controlled Google API boundary. Live capability evaluations cover E2B cloud shopping research plus artifacts, cloud DOM form preparation, API and DOM-submit approval boundaries, persistent terminal builds, browser-plus-SQLite audits, URL-bound screenshots, and grounded structured results.

`present_result.blocksOnly=true` completes the model turn with the validated blocks as the user-visible answer and retains the structured result. It requires a nonempty sanitized block list. Otherwise the model can add a short useful reply; it must not duplicate the blocks. Never use `finish_without_reply` for this, because that intentionally discards the result.

New rich-result generation is controlled by the `rich_result_blocks` admin feature policy (default Off), with the standard everyone/admin/user overrides. Disabled turns omit blocks and blocksOnly from the result tool schema and receive plain-result guidance; execution also strips these fields. Existing saved blocks remain readable and interactive. Inline redesigns and existing approvals/receipts are not gated. No new database migration is required beyond the existing app_feature_flags table.

Rich blocks can be published at any meaningful point through the same present_result tool. phase=update appends a timestamped block message without setting the final result or stopping execution. phase=final records the final outcome; blocksOnly may end that final response without extra prose. Each block group is persisted at creation time and rendered in transcript order, including after reload or later replies. Earlier groups are never replaced by a later final result. The feature flag also gates phase; no separate action/section/presentation tools are added.

Manual browser takeover creates an idempotent pending browser_request_takeover action and sets awaiting_approval atomically. A persistent takeover epoch invalidates the active worker; a one-second ownership watcher aborts idle provider generation and ownership checks reject stale tool dispatch and message persistence. Continue releases browser control and resumes through the existing approval flow. Keep outcomes of already-dispatched actions in the audit; never infer that cancellation undid them.

When blocks benefit from a short introduction or recommendation, present_result accepts leadIn. It is stored as a separate assistant message immediately before the block message in the same append, never merged into earlier commentary. A final leadIn + blocks reply ends the turn without a trailing duplicate message; update-phase lead-ins do not end the turn. blocksOnly=true excludes leadIn. The rich-block feature flag also removes leadIn from the available schema.

All financial browser submissions (purchase, bill_payment, transfer, payment) require final recorded approval. Bill payments, transfers and generic payments cannot inherit an always-approved purchase preference. Selecting or unlocking a saved card is a separate handoff and does not approve the charge.

A navigation rejected specifically with ERR_TUNNEL_CONNECTION_FAILED gets one bounded retry: proxy CONNECT failed before the destination HTTP request. Persistent failure is surfaced. Do not use this recovery to replay clicks, fills, submissions or unrelated uncertain network errors.
