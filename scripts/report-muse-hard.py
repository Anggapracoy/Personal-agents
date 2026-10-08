from pathlib import Path
import json
base=Path('artifacts/muse-hard')
configs=[('muse-spark-1.3','medium','Muse medium'),('muse-spark-1.3','high','Muse high'),('gpt-5.6-terra','medium','Terra medium')]
text='''# Two hard harness tasks: Muse medium, Muse high, Terra medium

Six unassisted runs: the same two tasks under three configurations, one sample each. Run on September 14, 2026 through the actual `createAgentModel` / `runAgent` loop, prompt, tool schemas, guards, streaming, and artifact capture. Run state used MemoryRunStore; an isolated local PostgreSQL database supplied empty fictional profiles and connection metadata. No production data was modified.

Browser task: research three live Keychron low-profile wireless keyboards under $160; verify a concrete variant's price, stock, layout and wireless evidence; compute a deterministic ranking; deliver JSON, a Markdown report, and a screenshot of the winning product. All web research had to use the real E2B browser. Sandboxes could only calculate and generate artifacts.

Calendar task: read a synthetic Google Calendar fixture through the production `calendar_search_events` and `calendar_get_event` tools. Calendar HTTP responses alone were replaced with fixture responses; this is not a live Google Calendar integration/latency test. The model had to schedule a 90-minute prep, a 60-minute London/Toronto/Los Angeles kickoff, and a 45-minute follow-up across October 30–November 3, respecting DST, declined/transparent/cancelled events, expanded recurring instances, an opaque all-day block, 15-minute buffers, lunch, and ordered optimization. It had to exhaustively verify the optimum and export JSON, ICS and a proof without sending invitations.

## Results

| Configuration | Task | Outcome | Elapsed | Estimated model cost |
|---|---|---|---:|---:|
'''
for model,effort,label in configs:
 for task in ['browser','calendar']:
  folder=base/task/f'{model}-{effort}';p=folder/'grade.json'
  if not p.exists():continue
  g=json.loads(p.read_text());cost=g['estimatedModelCostUSD'];text+=f"| {label} | {task} | {g['outcome']} | {g['elapsedSeconds']:.1f}s | {'unavailable' if cost is None else '$'+format(cost,'.4f')} |\n"
text+='''
Durations include real harness work and E2B startup/tool latency. An unfinished or blocked run is not a speed win. Calendar API network/auth latency is excluded because that service was synthetic. Model costs use returned tokens, including reasoning and cache reads/writes, with [Muse rates](https://vercel.com/ai-gateway/models/muse-spark-1.3) and [Terra rates](https://developers.openai.com/api/docs/models/gpt-5.6-terra) checked September 14. They are list-price estimates, not billing statements, and exclude E2B infrastructure charges. Cache behavior and live storefront behavior were not controlled; one run per configuration cannot establish a general ranking.

## Independent accuracy review

The grader checks the calendar against its own exhaustive, exact-minute IANA-timezone enumeration. The unique optimal blocks are Friday October 30 14:45–16:15 Toronto prep, Monday November 2 11:00–12:00 Toronto kickoff, and Monday 13:45–14:30 follow-up. The kickoff is 16:00–17:00 London and 08:00–09:00 Los Angeles. Exactly four full schedules are feasible before optimization, differing only in follow-up placement.

All three calendar configurations selected those correct final slots. Full-task grading also includes the requested proof/verifier and exported calendar contents, rather than trusting a model's claimed success.

'''
for model,effort,label in configs:
 for task in ['browser','calendar']:
  folder=base/task/f'{model}-{effort}';p=folder/'manual-review.json'
  if p.exists():
   g=json.loads(p.read_text());text+=f'### {label} — {task}\n\n'+ '\n'.join('- '+x for x in g['findings'])+'\n\n'
text+='''## Reproducibility and evidence

- `scripts/muse-hard-eval.ts`: exact prompts, synthetic events, model settings, and execution runner. Requires `.env.local` credentials and `MUSE_TEST_DATABASE_URL` pointing at a migrated isolated localhost database; run with `node --conditions=react-server --env-file=.env.local --import tsx scripts/muse-hard-eval.ts browser` (or `calendar`).
- `scripts/grade-muse-hard.py`: independent oracle and artifact/receipt validation.
- Each configuration folder contains original `result.json`, `messages.json`, exported artifacts, `grade.json`, and any `manual-review.json`. Model-generated errors were preserved, not corrected in the deliverables.
- No approval, task-specific hint, or retry was injected to rescue a scored run. Test scripts and reports were added locally; no production deployment was performed.
'''
(base/'report.md').write_text(text)
