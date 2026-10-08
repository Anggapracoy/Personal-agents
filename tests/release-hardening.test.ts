import test from 'node:test';
import assert from 'node:assert/strict';
import { withRequestBodyLimit } from '../lib/request-body-limit';
import { parseSharedIntakeFiles } from '../lib/shared-intake-input';
import { quotaClientAddress } from '../lib/client-network';
import { installationNamespace } from '../lib/installation-identity';
import { agentModelMetadata, defaultAgentModelSettings, installationModelSettings } from '../lib/agent-model-settings';
import { handoffChallenge } from '../lib/auth/mobile-handoff';

test('chunked bodies stop at the limit before even a forgiving handler can mutate state', async () => {
  let called = false; let cancelled = false;
  const handler = withRequestBodyLimit(async request => { called = true; await request.json().catch(() => null); return Response.json({ ok: true }); }, 4);
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(3)); }, cancel() { cancelled = true; } });
  const response = await handler(new Request('http://localhost/test', { method: 'POST', body: stream, duplex: 'half' } as RequestInit));
  assert.equal(response.status, 413); assert.equal(called, false); assert.equal(cancelled, true);
  const normal = withRequestBodyLimit(async request => Response.json(await request.json()), 50);
  assert.deepEqual(await (await normal(new Request('http://localhost/test', { method: 'POST', body: '{"ok":true}' }))).json(), { ok: true });
});

test('multipart bodies remain parseable and oversized declared bodies never reach handlers', async () => {
  const form = new FormData(); form.set('file', new File(['abc'], 'sample.txt'));
  const handler = withRequestBodyLimit(async request => Response.json({ bytes: ((await request.formData()).get('file') as File).size }), 2048);
  assert.deepEqual(await (await handler(new Request('http://localhost/test', { method: 'POST', body: form }))).json(), { bytes: 3 });
  assert.equal((await handler(new Request('http://localhost/test', { method: 'POST', headers: { 'content-length': '999999' }, body: '' }))).status, 413);
});

test('shared files count decoded bytes rather than client-declared sizes', () => {
  const one = { name: 'a.bin', size: 0, dataBase64: Buffer.alloc(3 * 1024 * 1024).toString('base64') };
  assert.equal(parseSharedIntakeFiles([one])[0].size, 3 * 1024 * 1024);
  assert.throws(() => parseSharedIntakeFiles(Array(6).fill(one)), /in total/);
  assert.throws(() => parseSharedIntakeFiles([{ ...one, dataBase64: 'abcde' }]), /invalid/);
});

test('untrusted forwarded headers cannot choose the waitlist quota bucket', () => {
  const previous = { VERCEL: process.env.VERCEL, TRUSTED_CLIENT_IP_HEADER: process.env.TRUSTED_CLIENT_IP_HEADER };
  try {
    delete process.env.VERCEL; delete process.env.TRUSTED_CLIENT_IP_HEADER;
    const request = new Request('http://localhost', { headers: { 'x-forwarded-for': '1.2.3.4', 'x-vercel-forwarded-for': '5.6.7.8' } });
    assert.equal(quotaClientAddress(request), 'shared-ingress');
    process.env.TRUSTED_CLIENT_IP_HEADER = 'x-forwarded-for'; assert.equal(quotaClientAddress(request), '1.2.3.4');
  } finally { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test('browser installations remain distinct even when the same user and provider key are reused', () => {
  const previous = process.env.DASH_INSTALLATION_ID;
  try { process.env.DASH_INSTALLATION_ID = 'deployment-a'; const a = installationNamespace(); process.env.DASH_INSTALLATION_ID = 'deployment-b'; assert.notEqual(installationNamespace(), a); }
  finally { if (previous === undefined) delete process.env.DASH_INSTALLATION_ID; else process.env.DASH_INSTALLATION_ID = previous; }
});

test('operator model overrides take precedence over saved choices and preserve the explicit provider', () => {
  const keys = ['DASH_AGENT_MODEL_ID', 'DASH_AGENT_PROVIDER', 'OPENAI_AGENT_MODEL']; const previous = keys.map(key => process.env[key]);
  try {
    process.env.DASH_AGENT_MODEL_ID = 'custom-model-v2'; process.env.DASH_AGENT_PROVIDER = 'anthropic'; process.env.OPENAI_AGENT_MODEL = 'legacy-openai';
    const selected = agentModelMetadata(installationModelSettings(defaultAgentModelSettings));
    assert.equal(selected.modelId, 'custom-model-v2'); assert.equal(selected.modelProvider, 'anthropic');
    delete process.env.DASH_AGENT_MODEL_ID; assert.equal(installationModelSettings(defaultAgentModelSettings).modelId, 'legacy-openai');
  } finally { keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); }
});

test('device handoff proof follows the S256 test vector and rejects malformed verifiers', () => {
  assert.equal(handoffChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(handoffChallenge('short'), null);
});

test('Mac Chrome sessions require explicit operator opt-in and cannot be imported by another signed-in user', async () => {
  const { localChromeImportAvailable } = await import('../lib/browser/chrome-profile-import');
  const keys = ['CHROME_PROFILE_IMPORT_LOCAL','CHROME_PROFILE_IMPORT_OWNER']; const previous = keys.map(key => process.env[key]);
  try {
    delete process.env.CHROME_PROFILE_IMPORT_LOCAL; delete process.env.CHROME_PROFILE_IMPORT_OWNER;
    assert.equal(localChromeImportAvailable('http://localhost', 'operator@example.invalid'), false);
    process.env.CHROME_PROFILE_IMPORT_LOCAL = '1'; process.env.CHROME_PROFILE_IMPORT_OWNER = 'operator@example.invalid';
    assert.equal(localChromeImportAvailable('http://localhost', 'other@example.invalid'), false);
    assert.equal(localChromeImportAvailable('https://public.example', 'operator@example.invalid'), false);
    if (process.platform === 'darwin') assert.equal(localChromeImportAvailable('http://localhost', 'operator@example.invalid'), true);
  } finally { keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); }
});
