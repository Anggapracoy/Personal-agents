"""Report paired shopping trials from independently reviewed saved evidence."""
import json, statistics
from pathlib import Path
from collections import Counter
root=Path('artifacts/shopping-comparison')
rows=[]
for p in sorted(root.glob('*/*/run-*/result.json')):
 r=json.loads(p.read_text()); folder=p.parent
 def read(name):
  path=folder/name
  return json.loads(path.read_text()) if path.exists() else {}
 review=read('semantic-review.json'); mechanical=read('mechanical-review.json')
 rows.append(dict(task=r['task'],model=r['modelId'],repetition=r['repetition'],seconds=r['elapsedMs']/1000,cost=r.get('estimatedModelCostUSD'),status=r['status'],timedOut=r.get('timedOut',False),retryWaits=r.get('retryWaits',[]),costCoverage=r.get('costCoverage'),review=review,errors=mechanical.get('toolErrors',[]),requests=len(r.get('requests',[])),folder=str(folder.relative_to(root)),structured=r.get('result') is not None))
models=['muse-spark-1.3','gpt-5.6-terra']
lines=['# Updated-harness shopping comparison','',f'{len(rows)}/12 planned runs recorded. Both models use Medium reasoning, identical task prompts and the same frozen harness. Two attempts each on IKEA, Logitech and AS Colour. One Muse attempt failed provider billing verification and is excluded from capability totals. [Methodology](methodology.md).','', '| Model | Shopping flow + verification | Cart transitions completed | Site-blocked runs | Unnecessary approval pauses | Median seconds | Recorded model-cost estimate |','|---|---:|---:|---:|---:|---:|---:|']
for m in models:
 group=[r for r in rows if r['model']==m and not r['review'].get('excludedFromCapabilityComparison')]
 if not group:continue
 cost=sum(r['cost'] or 0 for r in group); missing=sum(r['cost'] is None for r in group); partial=any(r['retryWaits'] or r['timedOut'] for r in group)
 lines.append(f"| {m} | {sum(r['review'].get('flowCompleted') is True for r in group)}/{len(group)} | {sum(r['review'].get('cartTransitionsCompleted') is True for r in group)}/{len(group)} | {sum(r['review'].get('siteBlocked') is True for r in group)} | {sum(r['review'].get('falseApproval') is True for r in group)} | {statistics.median(r['seconds'] for r in group):.1f} | ${cost:.4f}"+(f' + {missing} unknown' if missing else '')+(' (partial usage)' if partial else '')+' |')
lines+=['','## Individual trials','','| Task | Model | Trial | Reviewed outcome | Seconds | Recorded model-cost estimate | Tool errors |','|---|---|---:|---|---:|---:|---:|']
for r in rows:
 cost=(f"${r['cost']:.4f}"+(" partial" if r["retryWaits"] or r["timedOut"] else "")) if r['cost'] is not None else 'unknown'
 lines.append(f"| {r['task']} | {r['model']} | {r['repetition']} | [{r['review'].get('verdict','awaiting review')}]({r['folder']}/semantic-review.json) | {r['seconds']:.1f} | {cost} | {len(r['errors'])} |")
lines+=['','## Evidence review','']
for r in rows:
 lines.append(f"### {r['task']} · {r['model']} · trial {r['repetition']}")
 if r['retryWaits']:lines.append(f"- Provider cooldowns: {len(r['retryWaits'])}, {sum(r['retryWaits'])/1000:.1f}s requested wait; model cost omits failed-turn usage.")
 for note in r['review'].get('reviewNotes',[]):lines.append('- '+note)
 lines.append('')
lines+=['## Interpretation','','Both models completed all four IKEA/Logitech cart transitions, including removal. Muse also completed both IKEA arithmetic checks; Terra omitted code arithmetic twice (and failed to verify the visible subtotal in its first run). Logitech shopping outcomes passed for both models, but neither fully exercised the requested search/filter workflow. These are outcome grades, not perfect instruction-compliance grades. AS Colour exposed a shared actionable-control gap: Muse timed out on its first run, while Terra returned accurate partial reports twice. The second Muse AS Colour run was interrupted by provider billing failure and is excluded from capability denominators and median times.','','The sample does not establish an overall model winner. Muse was stronger on the IKEA verification requirement; Terra handled the unsolved variant problem more efficiently and honestly. Fix and retest the shared variant-control path before switching models based on this site. Recorded costs are incomplete and cannot support a cost ranking.','','## Limits','','Site blocks remain in the table and are not silently retried. Completion requires the requested evidence and cart transitions, including removal. The model’s verified flag is not the grading rule. Tool-error counts include approval pauses. Timing includes the entire run and its cleanup; timeout flags identify incomplete timed-out work. Costs use the documented rate assumptions, exclude E2B charges, and are not billing receipts. Two repetitions per model/task are exploratory evidence, not a general ranking. Only IKEA repeats the earlier shopping task unchanged; the replacement sites prevent a direct before/after claim across all three tasks.','']
(root/'report.md').write_text('\n'.join(lines));(root/'summary.json').write_text(json.dumps(rows,indent=2));print(f'Reported {len(rows)}/12 runs; {sum(bool(r["review"]) for r in rows)} reviewed')
