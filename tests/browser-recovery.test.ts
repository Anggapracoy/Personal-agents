import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from './helpers/process';
import { BrowserlessCloudBrowserProvider, createCloudBrowserAccountState } from '../lib/harness/browser/cloud';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';

test('cold worker operations initialize the known account before attaching', async () => {
  const provider = new BrowserlessCloudBrowserProvider('run', createCloudBrowserAccountState(), 'owner@example.invalid') as any;
  const calls: string[] = [];
  provider.ensureAccount = async (user: string) => { calls.push(user); provider.account.initialization = Promise.resolve(); };
  provider.ensureProviderAttached = async () => calls.push('attach');
  provider.requireSandbox = () => ({setTimeout:async()=>{}});
  provider.runControllerCommand = async () => ({url:'https://example.com',title:'Existing tab',text:'',elements:[]});
  assert.equal((await provider.snapshot()).title,'Existing tab');
  assert.deepEqual(calls,['owner@example.invalid','attach']);
});

test('timed-out click recovers once without replaying the click; next inspection works', async () => {
  const provider = new BrowserlessCloudBrowserProvider('run') as any;
  provider.account.sandbox = {setTimeout:async()=>{}};
  provider.account.sandboxId = 'sandbox';
  provider.ensureProviderAttached = async () => {};
  const calls: string[] = [];
  provider.runControllerCommand = async (_: unknown, operation: string) => {
    calls.push(operation);
    if (operation === 'click') throw new Error('CDP command Runtime.evaluate timed out');
    if (operation === 'target_health') return {responsive:false};
    if (operation === 'recover_target') return {recovered:true};
    return {url:'about:blank',title:'',text:'',elements:[]};
  };
  await assert.rejects(provider.click('e1'), /outcome is unknown; do not repeat a submission/);
  await provider.snapshot();
  assert.deepEqual(calls,['click','target_health','recover_target','snapshot']);
});

for (const health of ['responsive', 'unavailable'] as const) {
  test(`timed-out input preserves the original tab when health is ${health}`, async () => {
    const provider = new BrowserlessCloudBrowserProvider('run') as any;
    provider.account.sandbox = {setTimeout:async()=>{}};
    provider.account.sandboxId = 'sandbox';
    provider.ensureProviderAttached = async () => {};
    const calls: string[] = [];
    provider.runControllerCommand = async (_: unknown, operation: string) => {
      calls.push(operation);
      if (operation === 'click') throw new Error('CDP command Input.dispatchMouseEvent timed out');
      if (operation === 'target_health') {
        if (health === 'unavailable') throw new Error('Connection lost');
        return {responsive:true};
      }
      return {url:'https://example.com/checkout',title:'Existing checkout',text:'',elements:[]};
    };
    await assert.rejects(provider.click('e1'), health === 'responsive' ? /current tab is responsive and was preserved/ : /Input.dispatchMouseEvent timed out/);
    assert.equal((await provider.snapshot()).title,'Existing checkout');
    assert.deepEqual(calls,['click','target_health','snapshot']);
  });
}

test('tab health uses a bounded read, preserves loading pages and dialogs, and distinguishes timeouts from transport failure', () => {
  const program = `
ns={'__name__':'test'}
exec(${JSON.stringify(CLOUD_BROWSER_CONTROLLER)},ns)
closed=[]
mode='loading'
class FakeCDP:
 def __init__(self, endpoint): pass
 def observations(self): return {'dialog':{ 'type':'alert'}} if mode=='dialog' else {}
 def command(self, method, args, **kwargs):
  assert mode!='dialog'
  assert method=='Runtime.evaluate' and args['expression']=='document.readyState'
  assert kwargs['timeout']==2
  if mode=='timeout': raise RuntimeError('CDP command Runtime.evaluate timed out')
  if mode=='transport': raise OSError('socket closed')
  return {'result':{'value':mode}}
 def close(self): closed.append(True)
ns['CDP']=FakeCDP
for mode in ['loading','interactive','complete','dialog','timeout','transport','unknown']:
 try:
  result=ns['target_health']({'webSocketDebuggerUrl':'test'})
  assert mode not in ['transport','unknown']
  assert result=={'responsive':mode!='timeout'}
 except (OSError,RuntimeError):
  assert mode in ['transport','unknown']
assert len(closed)==7
`;
  const result=spawnSync('python3',['-c',program,'/tmp/unused-request.json'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});

test('controller recovery preserves old targets and enforces a durable bound', () => {
  const program = `import tempfile, os, json\nns={'__name__':'test'}\nexec(${JSON.stringify(CLOUD_BROWSER_CONTROLLER)},ns)\nwith tempfile.TemporaryDirectory() as root:\n ns['TARGET_DIR']=root\n calls=[]\n def request(path, method='GET'):\n  calls.append((path,method))\n  return {'id':'new-'+str(len(calls))}\n ns['json_request']=request\n path=ns['target_path']('run')\n with open(path,'w') as handle: handle.write('old')\n ns['recover_target']('run')\n assert ns['read_target_id'](path)=='new-1'\n assert ns['read_target_id'](path+'.retired-old.target')=='old'\n assert 'old' in ns['claimed_target_ids']()\n ns['recover_target']('run')\n try: ns['recover_target']('run')\n except RuntimeError as error: assert 'limit reached' in str(error)\n else: raise AssertionError('unbounded recovery')\n assert len(calls)==2\n assert all('about%3Ablank' in path and method=='PUT' for path,method in calls)\n`;
  const result = spawnSync('python3',['-c',program,'/tmp/unused-request.json'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});

test('inactive tab cleanup closes only stale owned tabs, preserving current, busy, recent and other tasks', () => {
  const program = `import tempfile, os, json, time, fcntl
ns={'__name__':'test'}
exec(${JSON.stringify(CLOUD_BROWSER_CONTROLLER)},ns)
with tempfile.TemporaryDirectory() as root:
 ns['TARGET_DIR']=root
 closed=[]
 targets=[{'id': key, 'type':'page', 'webSocketDebuggerUrl':key} for key in ['old','retired','current','busy','recent','active','shared']]
 ns['json_request']=lambda *args: targets
 class FakeCDP:
  def __init__(self, endpoint): self.endpoint=endpoint
  def command(self, method, args, **kwargs):
   assert method=='Target.closeTarget'
   assert args['targetId']==self.endpoint
   closed.append(self.endpoint)
   return {'success':True}
  def close(self): pass
 ns['CDP']=FakeCDP
 def mapping(key, target, age=3600, suffix=''):
  path=ns['target_path'](key)+suffix
  with open(path,'w') as f: f.write(target)
  os.utime(path,(time.time()-age,time.time()-age))
  return path
 old=mapping('old-run','old')
 retired=mapping('old-run','retired',suffix='.retired-retired.target')
 mapping('current-run','current')
 mapping('busy-run','busy')
 mapping('recent-run','recent',age=0)
 mapping('active-run','active')
 mapping('duplicate-owner','shared')
 mapping('protected-owner','shared')
 stale=mapping('gone-run','already-closed')
 with open(ns['target_lock_path']('busy-run'),'a') as busy:
  fcntl.flock(busy,fcntl.LOCK_EX)
  result=ns['prune_targets'](['old-run','current-run','busy-run','recent-run','duplicate-owner','gone-run'], 'current-run')
 assert set(closed)=={'old','retired'}, closed
 assert not os.path.exists(old) and not os.path.exists(retired) and not os.path.exists(stale)
 for key in ['current-run','busy-run','recent-run','active-run','duplicate-owner','protected-owner']:
  assert os.path.exists(ns['target_path'](key)),key
 ns['prune_targets'](['old-run'], 'current-run')
 assert len(closed)==2
`;
  const result = spawnSync('python3',['-c',program,'/tmp/unused-request.json'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});

test('tab cleanup is bounded, excludes the current task and never blocks the browser on cleanup failure', async () => {
  let lookups = 0;
  const provider = new BrowserlessCloudBrowserProvider('current', createCloudBrowserAccountState(), undefined, async () => {
    lookups++;
    return ['current', 'finished'];
  }) as any;
  provider.account.sandbox = {setTimeout:async()=>{}};
  provider.account.sandboxId = 'sandbox';
  provider.ensureProviderAttached = async () => {};
  const calls: string[] = [];
  provider.runControllerCommand = async (_: unknown, operation: string, payload: any) => {
    calls.push(operation);
    if (operation === 'prune_targets') {
      assert.deepEqual(payload.targetKeys,['finished']);
      throw new Error('Cleanup temporarily unavailable');
    }
    return {url:'https://example.com',title:'Current task',text:'',elements:[]};
  };
  assert.equal((await provider.snapshot()).title,'Current task');
  await provider.snapshot();
  assert.equal(lookups,1);
  assert.deepEqual(calls,['prune_targets','snapshot','snapshot']);
});

test('user-wait leases skip unused tasks and never recover or create a tab on timeout', async () => {
  const provider = new BrowserlessCloudBrowserProvider('run', createCloudBrowserAccountState(), 'owner@example.invalid') as any;
  const calls: string[] = [];
  // Another task may have already initialized this account's shared controller.
  provider.account.sandbox = {setTimeout:async()=>{}};
  provider.ensureAccount = async (_user: string, allowCreate: boolean) => {
    assert.equal(allowCreate, false);
    provider.account.initialization = Promise.resolve();
  };
  provider.ensureProviderAttached = async () => {};
  provider.runControllerCommand = async (_: unknown, operation: string) => {
    calls.push(operation);
    throw new Error('CDP command Target.getTargets timed out');
  };
  await provider.setWaitingForUser(true);
  assert.deepEqual(calls, []);
  await provider.setWaitingForUser(false, true);
  assert.deepEqual(calls, ['user_wait']);
});
