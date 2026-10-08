/** Assert identical full-task choices/results before reporting A/B timing. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error('Pass before and after result directories');
type Result = { passed: boolean; elapsedMs: number; response: string; replay: boolean; timingReplay: boolean; artifactHistory: boolean; actions: Array<{ toolName: string; input: unknown; status: string }> };
const load = (path: string): Result[] => readdirSync(path).filter(f => f.endsWith('.json') && !f.endsWith('-messages.json')).map(f => JSON.parse(readFileSync(`${path}/${f}`, 'utf8')));
const before = load(beforePath), after = load(afterPath);
assert.ok(before.length >= 3 && after.length >= 3, 'At least three trials per variant required');
const signature = (row: Result) => row.actions.map(a => ({ tool: a.toolName, input: a.input, status: a.status }));
for (const row of [...before, ...after]) {
  assert.equal(row.passed, true);
  assert.equal(row.replay, true);
  assert.equal(row.timingReplay, before[0].timingReplay);
  assert.equal(row.artifactHistory, before[0].artifactHistory);
  assert.deepEqual(signature(row), signature(before[0]));
  assert.equal(row.response, before[0].response);
}
const median = (rows: Result[]) => { const values = rows.map(r => r.elapsedMs).sort((a, b) => a - b); const middle = Math.floor(values.length / 2); return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2; };
console.log(JSON.stringify({ beforeMs: before.map(r => r.elapsedMs), afterMs: after.map(r => r.elapsedMs), medianBeforeMs: median(before), medianAfterMs: median(after), reductionPercent: 100 * (1 - median(after) / median(before)), identicalActionsAndResponse: true, timingReplay: before[0].timingReplay, artifactHistory: before[0].artifactHistory }, null, 2));
