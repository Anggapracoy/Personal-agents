"""Summarize shopping trials without treating model verified flags as independent review."""
import json
from collections import Counter
from pathlib import Path
from statistics import mean

root=Path('artifacts/muse-shopping')
rows=[]
for p in sorted(root.glob('*/*/run-*/result.json')):
 r=json.loads(p.read_text()); folder=p.parent
 review_path=folder/'mechanical-review.json'
 mechanical=json.loads(review_path.read_text()) if review_path.exists() else {}
 semantic_path=folder/'semantic-review.json'
 semantic=json.loads(semantic_path.read_text()) if semantic_path.exists() else {}
 findings_path=folder/'findings.json'
 try: findings=json.loads(findings_path.read_text()).get('findings',{})
 except (ValueError,FileNotFoundError): findings={}
 rows.append({'task':r['task'],'repetition':r['repetition'],'seconds':r['elapsedMs']/1000,'cost':r['estimatedModelCostUSD'],'status':r['status'],'structuredVerified':bool((r.get('result') or {}).get('verified')),'actions':len(r['actions']),'modelRequests':len(r['requests']),'errorCounts':dict(Counter(x['toolName'] for x in mechanical.get('toolErrors',[]))),'cartVerifiedClaim':findings.get('cartVerified'),'cartEmptiedClaim':findings.get('cartEmptied'),'review':semantic,'folder':str(folder.relative_to(root))})
lines=['# Live shopping evaluation','',f'{len(rows)}/6 planned trials recorded. Muse Spark 1.3 Medium; three shopping tasks, two repetitions each. Serial runs in isolated guest profiles. No login, personal data, checkout submission or purchases authorized. Only reversible test-cart changes authorized.','', '| Task | Trial | Reviewed outcome | Seconds | Estimated model cost | Tool errors |','|---|---:|---|---:|---:|---:|']
for r in rows:
 cost=f"${r['cost']:.4f}" if r['cost'] is not None else 'unknown'
 lines.append(f"| [{r['task']}]({r['folder']}/semantic-review.json) | {r['repetition']} | {r['review'].get('verdict','awaiting review')} | {r['seconds']:.1f} | {cost} | {sum(r['errorCounts'].values())} |")
completed=sum(r['review'].get('flowCompleted') is True for r in rows)
pauses=sum(r['status']=='awaiting_approval' for r in rows)
cost=sum(r['cost'] or 0 for r in rows)
lines+=['',f'Independently reviewed complete shopping flows: {completed}/{len(rows)}. Runs stopped awaiting approval: {pauses}. Total estimated model cost: ${cost:.4f}. Tool-error counts above include approval pauses.','', '## Review details','']
for r in rows:
 lines.append(f"### {r['task']} trial {r['repetition']}")
 lines.append(f"Tool errors: {r['errorCounts'] or 'none'}. Model claimed verified: {r['structuredVerified']}. Actions: {r['actions']}; model requests: {r['modelRequests']}.")
 for note in r['review'].get('reviewNotes',[]):lines.append('- '+note)
 lines.append('')
lines+=['## Scope and limitations','','Results distinguish factual product research, actual cart transitions, cleanup and structured delivery. A screenshot or model statement alone does not prove a successful mutation; semantic reviews inspect action receipts and saved artifacts. Blocked pages and partial attempts are included, not silently rerun or counted as fast successes.','', 'Token cost estimates use $1.25/M uncached input, $0.15/M cached input and $4.25/M output. These exclude E2B/browser charges and are not billing receipts. Two repetitions per task do not establish a general failure rate or a controlled comparison with the earlier research-only tasks.','', 'The exact protocol, production-source fingerprints and archived source are retained. Source copies use .ts.snapshot to remain outside TypeScript compilation. These trials do not validate native vault unlock, login or real payment completion. No deployment performed.','']
(root/'report.md').write_text('\n'.join(lines));(root/'summary.json').write_text(json.dumps(rows,indent=2));print('Reported',len(rows),'shopping trials')
