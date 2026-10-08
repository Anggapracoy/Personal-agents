# Main-agent benchmarks

Use [the fixed v1 task catalog](../../docs/MAIN_AGENT_BENCHMARKS.md) for future
comparisons: ten exact requests, expected outcomes, versioning rules and commands.

Run `scripts/main-agent-hard-benchmark.ts` with Node's `react-server` condition, tsx,
and an explicit `COMPARISON_DATABASE_URL` pointing to a disposable PostgreSQL
instance on 127.0.0.1. Load provider keys from the local environment. Never point
this runner at the production database. The runner removes Browserless, E2B and
Inngest credentials and blocks external fetches except the two model providers.

The four tasks run through `runAgent`, with global model settings disabled:
DST scheduling, paginated ledger reconciliation, conflicting order evidence,
and browser procurement. The default comparison uses medium effort; set
`EVAL_EFFORTS` explicitly for effort comparisons. Model order rotates
per task. Each task/model gets a new synthetic user, run and (for browsing) Chrome
context. `EVAL_CASES`, `EVAL_MODELS`, and `EVAL_OUTPUT_ROOT` can select reruns and
keep output separate. The default is one run per task/model, not repeated trials.

`hard-shop.ts` serves a deterministic, offline multi-page store to real Chrome.
`verify-hard-shop.ts` independently enumerates feasible configurations and checks
the rendered review totals through Playwright. The model never sees the oracle.
The production browser controller operates Chrome; remote provisioning alone is
replaced. No real order is placed. Browser contexts are closed after each run.

Model usage is observed through the optional `onModelStep` hook. Model wait time
comes from production timing spans. Use `report-main-agent.ts <output-root>` to
produce the Markdown report and summary. Tool-call counts come from SDK execution
timings; browser sub-actions are counted separately, because one `browser_run`
can batch many operations. Prices use the same billing function as Dash.

Keep invalid fixture/infrastructure attempts separate from scored runs, document
why they are excluded, and rerun each affected task for all models. Do not hide
valid model failures or selectively retry them. Cache behavior is production-like
and not forcibly flushed; record cache reads/writes and avoid extrapolating a
single pass into a stable model ranking.

## Number-input role regression

`verify-number-role.ts` drives the real local controller: a native number field
must resolve as `spinbutton`, fill successfully, and preserve explicit role
and ordinary textbox behavior. `BROWSER_NUMBER_ROLE_BASELINE=1` restores only
the pre-fix number-role mapping in the **local evaluation transport**, for an
A/B control. It does not affect production code. Run three browser trials per
arm in alternating order using `EVAL_CASES=browser-procurement` and
`EVAL_MODELS=gpt-6.1-sol`. Keep the batching prompt identical in both arms.

## Low versus medium

Set `EVAL_MODELS=gpt-6.1-sol EVAL_EFFORTS=low,medium` to run the same four tasks
with both reasoning efforts. The order alternates per task; output filenames include
the effort. Use a fresh `EVAL_OUTPUT_ROOT`. This changes only benchmark metadata,
not Admin settings. Preserve failed runs and inspect both strict grading and the
actual outcome before recommending a default change.

## Harder low versus medium scenarios

`harder-effort-benchmark.ts` runs six additional cases from `harder-cases.ts`:
launch scheduling, expense reconciliation, vendor costs, stock recovery,
support-ticket drafts, and travel selection revalidation. The last three use
real local Chromium with deterministic sites. Run `verify-harder-cases.ts` first
to validate those sites independently of the model.

Use a fresh isolated local PostgreSQL database in `COMPARISON_DATABASE_URL`, set
`EVAL_EFFORTS=low,medium`, and choose a fresh `EVAL_OUTPUT_ROOT`. Run the harness
with the same environment and TypeScript loader as the original benchmark.
`python3 scripts/benchmarks/report-harder-effort.py <output-root>` preserves raw
strict grades while documenting equivalent-format adjudications separately.
One trial per case is directional evidence, not a reliability estimate.
