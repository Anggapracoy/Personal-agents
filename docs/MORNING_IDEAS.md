# Daily morning ideas

`dispatch-morning-ideas` checks every minute for onboarded accounts whose saved IANA timezone is between 06:00 and noon. Discovery starts at 06:00 local time; the remaining morning window permits recovery after an outage. Accounts without a valid saved timezone are skipped. There is no fixed UTC offset, so DST follows the saved timezone.

`generate-morning-ideas` claims one owner/local-day occurrence, reads personal context, researches and reviews suggestions, and atomically adds every accepted distinct suggestion to the existing Home conversations and queues its notification. It does not execute an offered action. The ordinary choice/reply flow starts execution later.

Both research and quality review use `gpt-5.6-luna`, high reasoning, explicit `serviceTier: default`, and `store: false`. This feature does not inherit fast-mode/provider defaults and has no fallback model. Research reuses the email discovery tool registry: web search/page reads, Exa answers, weather, public API fetches, calendar lookup, read-only cloud browsing, sandbox calculations and targeted Gmail verification, a 12-call budget, and a 240-second total deadline. There is no fixed candidate or publication quota; weak candidates are withheld. Research first surveys the supplied personal context for distinct grounded leads, changes direction after rejected candidates, and revisits overlooked connections before returning zero. Failed lookups call for a corrected query or alternative source. Relevance, evidence, personal-life scope, and semantic deduplication remain mandatory; budget or tool limits must not be described as an exhaustive search.

Context includes confirmed profile facts and custom instructions, the latest 30 conversations updated within 30 days (initial request, outcome, and up to eight recent human-visible messages each), current upcoming calendar events, existing suggestions/history, active or paused schedules, and the previous 30 days of morning ideas. Email is not loaded into the ideation context. Ideas must originate in chats, confirmed goals/interests, or personal plans; email-based tasks are rejected. Gmail tools require a valid non-email personal reference and serve only to corroborate an existing lead. Tool payloads, reasoning, attachments, and vault data are excluded from chat extraction. Labeled secrets and recognizable API keys are redacted; public-search instructions prohibit private query text. Source and personal-evidence references are checked mechanically, then Luna reviews relevance, freshness, and semantic duplication. Calendar gaps are never treated as confirmed availability.

The `morning_idea_runs` ledger has an owner/local-date primary key, a 20-minute lease, three attempts, and ten-minute failure backoff. Attempt numbers fence expired workers. Publishing locks the occurrence and workspace in one transaction, preserves unrelated workspace fields, increments its version, and records completion even when no idea passes review. Saved reports retain provenance and tool queries, not raw account context or research response bodies.

## Activation

Apply `db/migrations/0019_morning_ideas.sql` before releasing the registered workers. It is included in `pnpm db:migrate`. Follow the repository's normal deployment and Inngest synchronization procedure. `MORNING_IDEAS_ENABLED=false` disables new claims and dispatches. Local implementation alone does not activate production scheduling.

## Evaluation

Run against an authorized account without publishing or sending pushes:

```sh
node --env-file=.env.local --conditions=react-server --import tsx scripts/morning-ideas-eval.ts --owner account@example.com --output artifacts/morning-ideas/evaluation.json
```

The evaluation uses live account context and the same research/review harness. It writes a private-permission report and converted Home decisions, without raw account context. The evaluation loads the persisted prior-morning history, using the same duplicate comparison context as production. Dry-run outputs themselves are not published or added to that history.

`pnpm test` covers local-time/DST boundaries, evidence and expiry gates, message extraction, and stable decision conversion. To exercise the actual SQL claim/retry/publish path, run:

```sh
MORNING_DB_TEST=true node --env-file=.env.local --conditions=react-server --import tsx --test tests/morning-jobs-db.test.ts
```

The database test shadows relation names with temporary tables on a single transaction and always rolls back; it does not publish into any real account.

Morning suggestions focus exclusively on personal life: enjoyable experiences, food, hobbies, outings, leisure learning and meaningful time with people. Business meetings, investor preparation, product work and professional follow-ups are excluded even when grounded in a calendar or chat. Deduplicate specific recommendations and tasks, not entire interests; a past restaurant search does not prohibit a genuinely new experience matching the user’s tastes. Never fill a sparse personal shortlist with work tasks.

Admin → Daily proactive manages the independent `daily_proactive` flag using the Calling policy semantics: Admin only by default, Everyone, No one, and per-email allow/block overrides. Dispatch, claim, model generation and publishing enforce this access policy.
