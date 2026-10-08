"""Summarize paired low/medium runs without regrading or changing raw results."""
import json, sys
from pathlib import Path
root=Path(sys.argv[1]); rows=json.loads((root/'results.json').read_text())
summaries=[]
for effort in ['low','medium']:
 rr=[r for r in rows if r['effort']==effort]
 if not rr: continue
 assert all(a['model']==r['modelId'] and a['reasoning']['effort']==effort for r in rr for a in r['apiRequests'])
 s={'effort':effort,'tasks':len(rr),'passed':sum(r['passed'] for r in rr)}
 for key in ['elapsedMs','modelMs','costUSD','modelCalls','toolCalls','toolActions','failedActions']:
  s[key]=sum(r[key] for r in rr) if all(r[key] is not None for r in rr) else None
 s['usage']={key:sum(r['usage'][key] for r in rr) for key in rr[0]['usage']}
 summaries.append(s)
lines=['# GPT-6.1 Sol: low versus medium','',
'Same four original tasks, current Dash production harness and prompts. One run per task/effort, alternating order, fresh synthetic user/run and browser context. No Admin/default changes. Task/source fixtures were compared with the original benchmark and matched exactly.','',
'## Results','',
'| Task | Effort | Seconds | Model cost USD | Model calls | Tool calls | Persisted actions | Strict pass |',
'|---|---|---:|---:|---:|---:|---:|---|']
for r in rows:
 lines.append(f"| {r['task']} | {r['effort']} | {r['elapsedMs']/1000:.1f} | ${r['costUSD']:.4f} | {r['modelCalls']} | {r['toolCalls']} | {r['toolActions']} | {'Yes' if r['passed'] else 'No'} |")
lines+=['','## Aggregate','','| Effort | Passed | Seconds | Model cost USD | Model calls | Tool calls | Cache-read share |','|---|---:|---:|---:|---:|---:|---:|']
for s in summaries:
 lines.append(f"| {s['effort']} | {s['passed']}/{s['tasks']} | {s['elapsedMs']/1000:.1f} | ${s['costUSD']:.4f} | {s['modelCalls']} | {s['toolCalls']} | {100*s['usage']['cacheRead']/s['usage']['input']:.1f}% |")
lines+=['','## Method and limits','',
'- Scheduling: DST offsets, interdependent blocks, buffers, ignored events and required source-detail reads.',
'- Ledger: seven pages, 36 invoices, duplicate/out-of-order revisions, signed refunds and currency filtering.',
'- Orders: eight orders, 25 evidence messages, stale summaries and injected instructions; processor, carrier and merchant truth must be reconciled.',
'- Browser: real local Chromium driven by the production controller, using the same deterministic multi-page procurement store. Independently verified cart, totals, coupon, shipping, address, opt-out, review screenshot and no final submission. No Browserless/E2B or public merchant used.',
'- Wall time covers agent execution; local browser/database setup and post-run grading are excluded. It does not include production scheduler or remote browser startup/network latency.',
'- Tool calls count SDK executions. A browser_run can contain multiple persisted browser actions; those counts are kept separately.',
'- Cost uses provider-reported usage and [standard token rates](https://developers.openai.com/api/docs/pricing): $2 input, $0.10 cache reads, $2.50 cache writes, $10 output per million tokens. Reasoning is included in output. Infrastructure is excluded.',
'- Production caching was enabled without artificial warmup/flush. Actual cache usage is retained, so observed costs include cache variation.',
'- All API requests were checked for the requested model and effort. Both settings used the same prompt/tools, source data and oracle; only reasoning effort changed.',
'- One trial each is directional evidence, not a statistically stable speed or reliability estimate. No valid model failures were silently retried.',
'', '## Failed checks','']
failed=[r for r in rows if not r['passed']]
lines += [f"- {r['task']} / {r['effort']}: {', '.join(k for k,v in r['checks'].items() if not v)}. {r['error'] or ''}" for r in failed] or ['None.']
(root/'report.md').write_text('\n'.join(lines)+'\n')
(root/'summary.json').write_text(json.dumps({'summaries':summaries,'rows':[{k:r[k] for k in ['task','effort','elapsedMs','modelMs','costUSD','modelCalls','toolCalls','toolActions','failedActions','usage','checks','passed','runId']} for r in rows]},indent=2))
print(json.dumps(summaries,indent=2))
