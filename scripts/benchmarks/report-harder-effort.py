"""Report outcomes separately from formatting, preserving raw strict grades."""
import json, sys, re
from pathlib import Path
root=Path(sys.argv[1]); rows=json.loads((root/'results.json').read_text())
for r in rows:
 checks=dict(r['checks']);notes=[]
 if r['task']=='launch-replanning' and isinstance(r.get('answer',{}).get('order'),list):
  checks['order']=''.join(r['answer']['order'])=='ABCDEFG'
  if checks['order']:notes.append('Order returned as equivalent list rather than string; accepted for outcome, raw strict grade retained.')
 if r['task']=='browser-stock-recovery' and not checks.get('shipping') and checks.get('state.shipping') and re.search(r'\bexpress\b',r.get('answer',{}).get('shipping',''),re.I):
  checks['shipping']=True;notes.append('Descriptive Express shipping string matches the actual saved Express option; accepted for outcome.')
 if r['task']=='browser-support-drafts' and checks.get('state.tickets'):
  for field,expected in [('closedTicket','T-81'),('damageTicket','T-82'),('unchangedTicket','T-83')]:
   value=(r.get('answer') or {}).get(field)
   if isinstance(value,dict) and value.get('id')==expected:
    checks[field]=True;notes.append(f'{field} returned as a detailed object with the correct ID rather than an ID string; saved records independently match.')
 r['outcomePassed']=all(checks.values());r['adjudication']=notes
 assert all(a['model']==r['modelId'] and a['reasoning']['effort']==r['effort'] for a in r['apiRequests'])
summary=[]
for effort in ['low','medium']:
 rr=[r for r in rows if r['effort']==effort]
 if not rr:continue
 s={'effort':effort,'tasks':len(rr),'correct':sum(r['outcomePassed'] for r in rr),'strict':sum(r['passed'] for r in rr)}
 for k in ['elapsedMs','modelMs','costUSD','modelCalls','toolCalls','toolActions','failedActions']:s[k]=sum(r[k] for r in rr)
 s['cacheReadShare']=sum(r['usage']['cacheRead'] for r in rr)/sum(r['usage']['input'] for r in rr)
 summary.append(s)
lines=['# Harder Dash tasks: GPT-6.1 Sol low versus medium','',
'Six new scenarios, one run per task/effort (12 runs), alternating effort order, identical current Dash harness and prompts, isolated synthetic users and local PostgreSQL. All three browser fixtures were independently completed and checked before model runs. No model-specific tuning or failed-model reruns.','',
'| Task | Effort | Seconds | Model cost USD | Model calls | Tool calls | Browser/internal actions | Outcome |',
'|---|---|---:|---:|---:|---:|---:|---|']
for r in rows:lines.append(f"| {r['task']} | {r['effort']} | {r['elapsedMs']/1000:.1f} | ${r['costUSD']:.4f} | {r['modelCalls']} | {r['toolCalls']} | {r['toolActions']} | {'Pass' if r['outcomePassed'] else 'Fail'} |")
lines+=['','## Totals','','| Effort | Correct | Seconds | Cost | Model calls | Tool calls | Cache-read share |','|---|---:|---:|---:|---:|---:|---:|']
for s in summary:lines.append(f"| {s['effort']} | {s['correct']}/{s['tasks']} | {s['elapsedMs']/1000:.1f} | ${s['costUSD']:.4f} | {s['modelCalls']} | {s['toolCalls']} | {s['cacheReadShare']*100:.1f}% |")
lines+=['','## Scenarios and grading','',
'- Launch replanning: reconcile stale policy with current release times, dependencies, breaks, due times and tie-break rules. Exhaustively enumerated scheduling oracle. Accept equivalent job-order list/string formatting.',
'- Expenses: employee versus company payments, excluded alcohol, missing receipts, corrected amount, FX rounding, per-day caps and receipt-order allocation. Check total and every reimbursement.',
'- Vendor selection: eligibility constraints, superseded metered price, changing seats/usage across two years, base-only annual discounts, setup fee. Check winner, all eligible totals and exclusions.',
'- Stock recovery: inspect the procurement catalog, prepare the cheapest quote, encounter lost stock at review, remove stale item and choose the cheapest remaining feasible combination. Check actual cart, totals, address, coupon and shipping.',
'- Support drafts: distinguish two tickets for the same customer, apply refund policy, save fields and internal notes despite a transient failure, leave the third ticket unchanged, send no response or money.',
'- Travel revalidation: choose the cheapest rail/hotel pair under arrival, connection, refund, accessibility and cancellation constraints; handle dependent dropdown refresh and an expired selection, remove default insurance and verify saved draft.',
'', '## Interpretation','',
'- These are controlled synthetic workflows, not a representative sample of every production user task. “Harder” describes added constraints and recovery requirements; difficulty is not independently calibrated.',
'- Real local Chromium and production browser controller are used. No Browserless/E2B credits, external merchant, real account, payment or final order. Browser fixtures intercept network requests.',
'- Wall time excludes local setup and post-run grading; includes agent/model/tool work. Remote browser network/provisioning and production scheduler latency are excluded.',
'- Tool calls are model-facing SDK executions; one browser_run can produce many internal actions. Actual provider usage (including cache writes/reads and reasoning output) is priced using Dash standard rates. Infrastructure costs excluded.',
'- One trial per combination: useful directional evidence, not proof of reliability equivalence. Cache was neither artificially flushed nor prewarmed; cache variation is reported.',
'- No production default or deployed code was changed.',
'', '## Adjudication and failures','']
for r in rows:
 for n in r['adjudication']:lines.append(f"- {r['task']} / {r['effort']}: {n}")
 if not r['outcomePassed']:lines.append(f"- {r['task']} / {r['effort']}: failed {', '.join(k for k,v in r['checks'].items() if not v)}. {r.get('error') or ''}")
(root/'report.md').write_text('\n'.join(lines)+'\n')
(root/'summary.json').write_text(json.dumps({'summary':summary,'rows':[{k:r[k] for k in ['task','effort','runId','elapsedMs','modelMs','costUSD','modelCalls','toolCalls','toolActions','failedActions','checks','passed','outcomePassed','adjudication']} for r in rows]},indent=2))
print(json.dumps(summary,indent=2))
