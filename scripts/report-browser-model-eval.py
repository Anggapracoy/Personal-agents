import json,statistics
from pathlib import Path
BASE=Path('artifacts/browser-model-eval')
rows=[]
for p in sorted(BASE.glob('*/*/run-*/result.json')):
 r=json.loads(p.read_text());r['folder']=str(p.parent.relative_to(BASE))
 for key,name in [('mechanical','mechanical-review.json'),('semantic','semantic-review.json')]:
  r[key]=json.loads((p.parent/name).read_text()) if (p.parent/name).exists() else {}
 rows.append(r)
labels={'harness_blocked':'Harness blocked','harness_observation_limited':'Harness observation limited','partial_honest_unknown':'Partial: unknown fact','facts_correct_delivery_incomplete':'Correct facts; incomplete finalization','completed_with_caveats':'Completed with caveats','clean_completion':'Clean completion','model_failed':'Model failed','runtime_failed':'Runtime failed'}
lines=['# Repeated live-browser comparison','',f'{len(rows)} of 12 planned serial runs recorded. Muse Spark 1.3 Medium versus GPT-5.6 Terra Medium, three sites, two repetitions per configuration. September 14, 2026.','', '[Methodology and limitations](methodology.md) · [Exact prompts](protocol.json) · [Independent reference checks](oracle-notes.md)','', '## Interpretation', '', 'These twelve attempts do not establish a consistent Muse speed or cost advantage. On Acadia, Muse completed the core facts twice, averaging 186.7 seconds and $0.3125; Terra averaged 175.5 seconds and $0.2239 but omitted one required fact in its first attempt. On Firefox repeat 1, Muse was slightly faster and cheaper (117.7s / $0.1721 versus 126.2s / $0.2594), but failed structured finalization. Both second Firefox attempts were blocked by the search-button guard, so their short durations are not successful-completion timings.', '', 'Muse made ten invalid present_result calls across three research runs; Terra made none. Muse eventually recovered in both Acadia runs, but not Firefox repeat 1. In the second IKEA trial, both lacked price text in browser observations: Terra returned an honest partial result after 108.6 seconds; Muse reached the 40-action cap after 394.2 seconds without the requested findings/report. Lower token prices therefore did not guarantee lower task cost.', '', 'Four of twelve attempts stopped on false approval gates: IKEA privacy dismissal, IKEA Measurements tab, and Mozilla Search for both models. IKEA price text was also missing from observations even where visible in a captured image. These are harness issues and materially confound model comparison. The screenshot-path wording adds another disclosed interface ambiguity. Fix those issues before using this suite to select a default model; separately address Muse schema adherence and repeated attempts.', '', 'No general winner is justified by this small sample. Muse showed useful factual research ability; Terra showed more reliable structured finalization in the unblocked research runs. No production settings were changed by this evaluation.', '', '## Results','', '| Task | Model | Repeat | Review | Time | Est. model cost | Actions | Tool errors incl. approval pauses |','|---|---|---:|---|---:|---:|---:|---:|']
for r in rows:
 m=r['mechanical'];s=r['semantic'];cost=f"${r['estimatedModelCostUSD']:.4f}" if r['estimatedModelCostUSD'] is not None else 'unknown'
 lines.append(f"| {r['task']} | {'Muse Medium' if r['provider']=='meta' else 'Terra Medium'} | {r['repetition']} | {labels.get(s.get('verdict'),s.get('verdict','Review pending'))} | {r['elapsedMs']/1000:.1f}s | {cost} | {len(r['actions'])} | {len(m.get('toolErrors',[]))} |")
lines += ['', '## Per-task averages','', 'These averages include both attempts, including blocked or partial runs. Always read outcome counts alongside timing; an approval pause is not a speed win.','', '| Task | Model | Attempts | Core facts complete | Structured verified result | Mean elapsed | Mean estimated model cost |','|---|---|---:|---:|---:|---:|---:|']
for task in ['ikea','acadia','firefox']:
 for provider in ['meta','openai']:
  group=[r for r in rows if r['task']==task and r['provider']==provider]
  if not group:continue
  core=sum(r['semantic'].get('corePass') is True for r in group)
  structured=sum(bool((r.get('result') or {}).get('verified')) and bool((r.get('result') or {}).get('links')) for r in group)
  costs=[r['estimatedModelCostUSD'] for r in group if r['estimatedModelCostUSD'] is not None]
  cost=f'${statistics.mean(costs):.4f}' if len(costs)==len(group) else 'unknown'
  lines.append(f"| {task} | {'Muse Medium' if provider=='meta' else 'Terra Medium'} | {len(group)} | {core}/{len(group)} | {structured}/{len(group)} | {statistics.mean(r['elapsedMs']/1000 for r in group):.1f}s | {cost} |")
lines += ['', '## Review notes','']
for r in rows:
 s=r['semantic'];m=r['mechanical'];lines += [f"### {r['task']} · {'Muse Medium' if r['provider']=='meta' else 'Terra Medium'} · repeat {r['repetition']}",'',f"[Original result]({r['folder']}/result.json) · [Mechanical checks]({r['folder']}/mechanical-review.json) · [Semantic review]({r['folder']}/semantic-review.json)",'']
 notes=s.get('notes') or [s.get('explanation','Review pending.')]
 for note in notes:lines.append('- '+note)
 lines += [f"- Repeated identical page opens: {m.get('identicalOpenRepeats','?')}; maximum consecutive identical opens: {m.get('maxConsecutiveIdenticalOpens','?')}. Cached input tokens: {m.get('cachePercent',0):.1f}%.",'']
lines += ['## Cost scope','',f"Total estimated model cost for recorded runs: ${sum(r['estimatedModelCostUSD'] or 0 for r in rows):.4f}. E2B infrastructure costs are excluded. Actual billed amounts were not retrieved.",'', 'This is a small exploratory comparison, not a general benchmark. Research facts and final structured delivery are graded separately. The `verified` flag alone is not evidence that all requested facts were established.']
(BASE/'report.md').write_text('\n'.join(lines)+'\n')
print(f'Wrote report for {len(rows)}/12 runs')
