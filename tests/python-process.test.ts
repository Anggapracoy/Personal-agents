import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from './helpers/process';

test('large Python fixtures preserve argv and stdin without exceeding OS argument limits', () => {
  const program = '# fixture padding\n'.repeat(20_000) + "import sys,json\nprint(json.dumps({'argv':sys.argv,'input':sys.stdin.read()}))\n";
  assert.ok(Buffer.byteLength(program) > 128 * 1024);
  const result = spawnSync('python3', ['-c', program, 'fixture-argument'], { encoding: 'utf8', input: 'fixture-input' });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { argv: ['-c', 'fixture-argument'], input: 'fixture-input' });
});

test('non-Python child processes retain native spawn behavior', () => {
  const result = spawnSync(process.execPath, ['-e', 'process.stdout.write("ok")'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ok');
});
