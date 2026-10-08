import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const url = process.env.DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || new URL(url).pathname !== '/dash_security_test') throw new Error('Use a disposable local dash_security_test database with the migrations applied.');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'HOME', 'TMPDIR', 'LANG'].includes(key)));
env.DATABASE_URL = url;
env.AUTH_SECRET = 'disposable-database-test-secret';
for (const flag of ['SCHEDULE', 'REPLY', 'ARTIFACT_SNAPSHOT', 'CONVERSATION_IDENTITY', 'MANUAL_TAKEOVER', 'SECURITY']) env[`${flag}_TEST_DATABASE_URL`] = url;
const capacity = new URL(url); capacity.pathname = '/dash_capacity_test';
env.CAPACITY_TEST_DATABASE_URL = capacity.href;
env.MORNING_DB_TEST = 'true';
const files = readdirSync('tests').filter(name => name.endsWith('.integration.test.ts') && !['security-boundaries.integration.test.ts', 'user-capacity.integration.test.ts'].includes(name)).map(name => `tests/${name}`);
for (const args of [
  ['--conditions=react-server', ...files, 'tests/morning-jobs-db.test.ts'],
  ['tests/security-boundaries.integration.test.ts'],
  ['--conditions=react-server', 'tests/user-capacity.integration.test.ts'],
]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-force-exit', '--test-concurrency=2', ...args], { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
