"""Report factual review, validation errors and raw provider encoding separately."""
import json
from collections import Counter
from pathlib import Path
from statistics import mean

root = Path('artifacts/muse-browser-capabilities')
rows = []
for path in sorted(root.glob('*/*/run-*/result.json')):
    result = json.loads(path.read_text())
    review = json.loads((path.parent/'mechanical-review.json').read_text())
    semantic_path = path.parent/'semantic-review.json'
    semantic = json.loads(semantic_path.read_text()) if semantic_path.exists() else None
    diagnostics = result.get('rawInputDiagnostics', [])
    rows.append({
        'task': result['task'], 'repetition': result['repetition'],
        'elapsedSeconds': result['elapsedMs']/1000,
        'estimatedModelCostUSD': result['estimatedModelCostUSD'],
        'structuredVerified': bool((result.get('result') or {}).get('verified')),
        'corePass': semantic.get('corePass') if semantic else None,
        'cleanPass': semantic.get('cleanPass') if semantic else None,
        'semanticVerdict': semantic.get('verdict') if semantic else 'not_reviewed',
        'semanticNotes': semantic.get('reviewNotes', []) if semantic else [],
        'errorCounts': dict(Counter(error['toolName'] for error in review['toolErrors'])),
        'rawCallsObserved': len(diagnostics),
        'rawUnparseableCalls': sum(not item['parseable'] for item in diagnostics),
        'encodedLocatorCalls': sum(bool(item['encodedTargets']) for item in diagnostics),
        'literalNullCalls': sum(bool(item['literalNullFields']) for item in diagnostics),
        'missingFactSourceCalls': sum(bool(item['missingFactSourceUrls']) for item in diagnostics),
        'actions': review['actions'], 'modelRequests': review['modelRequests'],
        'modelResponseSeconds': review['modelResponseSeconds'], 'cachePercent': review['cachePercent'],
        'failedMechanicalChecks': [key for key, value in review['checks'].items() if not value],
        'folder': str(path.parent.relative_to(root)),
    })

lines = [
    '# Browser capabilities and result-formatting evaluation', '',
    f'{len(rows)} of 8 planned runs recorded. Muse Spark 1.3 Medium only; two repetitions of the same four tasks, run serially. No Terra calls. Exact prompts, fingerprints and evaluated source files are retained alongside this report.', '',
    '| Task | Runs | Core facts correct | Structured verified | Mean time | Mean model cost | Tool errors |',
    '|---|---:|---:|---:|---:|---:|---:|',
]
for task in ['capabilities', 'ikea', 'acadia', 'firefox']:
    group = [row for row in rows if row['task'] == task]
    if not group:
        continue
    n = len(group)
    lines.append(f"| {task} | {n} | {sum(row['corePass'] is True for row in group)}/{n} | {sum(row['structuredVerified'] for row in group)}/{n} | {mean(row['elapsedSeconds'] for row in group):.1f}s | ${mean(row['estimatedModelCostUSD'] for row in group):.4f} | {sum(sum(row['errorCounts'].values()) for row in group)} |")

lines += ['', '## Errors and provider encoding', '']
for row in rows:
    lines += [f"- {row['task']} run {row['repetition']}: {row['errorCounts'] or 'no tool errors'}; {row['encodedLocatorCalls']} raw string-encoded locator calls; {row['literalNullCalls']} literal-null calls; {row['missingFactSourceCalls']} calls omitting a nullable fact-source URL. Raw diagnostics observed {row['rawCallsObserved']} calls."]
lines += ['', '## Semantic review', '']
for row in rows:
    lines.append(f"- {row['task']} run {row['repetition']}: {row['semanticVerdict']}.")
    for note in row['semanticNotes']:
        lines.append(f"  - {note}")
lines += [
    '', 'Raw diagnostics are collected before SDK normalization and store counts/field names, not argument content. A provider encoding mistake handled by the boundary is distinct from a rejected tool call. Zero tool errors does not establish perfect prompt compliance or factual correctness.',
    '', '## Per-run results', '',
    '| Task | Run | Seconds | Model cost | Actions | Model requests | Model response time |',
    '|---|---:|---:|---:|---:|---:|---:|',
]
for row in rows:
    lines.append(f"| [{row['task']}]({row['folder']}/semantic-review.json) | {row['repetition']} | {row['elapsedSeconds']:.1f} | ${row['estimatedModelCostUSD']:.4f} | {row['actions']} | {row['modelRequests']} | {row['modelResponseSeconds']:.1f}s |")

lines += [
    '', '## Chrome comparison', '',
    'The shared disposable fixture passed scoped search, focused text reading, Enter, select-all/backspace, condition waits, absent-target timeouts and named-panel scrolling in the local Chrome interface and the cloud implementation. Cloud hover was checked separately because the current local Chrome interface does not expose it. The cloud controller also passed live IKEA price/Measurements and Mozilla search checks.', '',
    'This is matching behavior for tested operations, not identical APIs or browser environments. Cloud hover currently requires a main-frame target. Cloud scrolling uses pixels; the native Chrome interface used pages. The bounded role/name implementation does not expose the full Playwright locator language or arbitrary JavaScript.',
    '', '## Earlier results', '',
    'The second IKEA run is the cost outlier: $1.8131 versus $0.4769 for the first. It used 19 versus 15 model requests, 2.34M versus 1.58M aggregate input tokens, and approximately 46% versus 89% cached input. Model response time was 194.1s versus 112.8s. More calls and lower cache reuse account for the observed increase; these measurements do not establish why the provider cache differed.', '',
    'The preceding three-run suite in ../muse-browser-final had correct core findings in 3/3 runs, verified structured delivery in 2/3, and seven present_result validation failures. The new formatting boundary accepts all seven original rejected calls. The preliminary capability iteration in ../muse-browser-capabilities-iteration1 exposed string-encoded locators and omitted nullable source fields; it was stopped, fixed, and is excluded from the final metrics.', '',
    'Earlier timings are descriptive context, not a controlled A/B comparison: those final three runs overlapped an older evaluation, and this update changes both tooling and prompting. Two repetitions per task are too few for a general speed, cost or model-ranking claim.',
    '', '## Cost and verification scope', '',
    f'Total estimated model cost for the eight final runs: ${sum(row["estimatedModelCostUSD"] for row in rows):.4f}. Separate smoke, contract and preliminary runs are excluded from this total.', '',
    'Costs are token estimates at $1.25/M uncached input, $0.15/M cached input and $4.25/M output; these rates match the published [Cursor Muse pricing table](https://cursor.com/docs/models/muse-spark-1-3#pricing). The direct Meta pricing page was unavailable to the web reader. These are not billing receipts; E2B/browser/sandbox costs are excluded. Elapsed time includes initialization, model responses, browser work and artifact creation.', '',
    'Per-run semantic reviews check actual evidence and deliverables separately from the model-supplied verified flag. Strict mechanical quote checks can flag combined accessible text fragments or redirect-query differences; any such exception is explained in the semantic review rather than silently marked exact.', '',
    'Validation: 440 tests passed, 10 skipped, zero failed; lint and git diff --check passed. All ten cloud fixture checks passed. Live Muse vision, approval and page-injection contract checks passed. Evaluated production source hashes and archived source files match the final working files.', '',
    'All work is local and uncommitted. No push or deployment performed.',
]
(root/'report.md').write_text('\n'.join(lines)+'\n')
(root/'summary.json').write_text(json.dumps(rows, indent=2))
print(f'Wrote report for {len(rows)} runs')
