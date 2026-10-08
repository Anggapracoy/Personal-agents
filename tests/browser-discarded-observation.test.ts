import assert from 'node:assert/strict';
import test from 'node:test';
import { compileDiscardedObservations, isBrowserObservationDiscarded } from '../lib/harness/browser/discarded-observation';
import { runBrowserScript } from '../lib/harness/browser/script';

test('only unused immediately superseded observations are deferred', () => {
 for (const code of [
  `const p=browser.page(); await p.wait(5000); print((await p.inspect()).snapshot.slice(0,100));`,
  `const p=browser.page(); await p.getByRole('button',{name:'Close'}).click({requiresApproval:false,purpose:'Close'}); await p.goto('https://example.com');`,
 ]) assert.match(compileDiscardedObservations(code),/__discardBrowserObservation/);
 for (const code of [
  `const p=browser.page(); const r=await p.wait(5000); print(await p.inspect());`,
  `const p=browser.page(); print(await p.wait(5000)); print(await p.inspect());`,
  `const p=browser.page(); await p.wait(5000);`,
  `const p=browser.page(); await p.wait(5000); print(false && await p.inspect());`,
  `const p=browser.page(); await p.wait(5000); if(false) await p.inspect();`,
  `const p=browser.page(); await p.wait(5000); print((await p.inspect('e1')).snapshot);`,
  `const p=browser.page(); p.wait=()=>{}; await p.wait(5000); await p.inspect();`,
  `const p=browser.page(); evil(p); await p.wait(5000); await p.inspect();`,
  `const p=browser.page(); await p.getByText('Next').click(options); await p.inspect();`,
  `const p=browser.page(); await p.wait(5000); print('hi'); await p.inspect();`,
 ]) assert.equal(compileDiscardedObservations(code),code);
});

test('deferral preserves duration, RPC order, final fresh evidence and printed output',async()=>{
 const calls:Array<{name:string;discarded:boolean;input:unknown}>=[];
 const result=await runBrowserScript(`const p=browser.page(); await p.wait(5000); print((await p.inspect()).snapshot);`,async(name,input)=>{
  calls.push({name,discarded:isBrowserObservationDiscarded(),input});
  return name==='browser_wait'?{observationDeferred:true}:{snapshot:'fresh',url:'https://example.com'};
 });
 assert.equal(result.$toolError,undefined);
 assert.deepEqual(calls.map(c=>[c.name,c.discarded]),[['browser_wait',true],['browser_inspect',false]]);
 assert.equal((calls[0].input as any).milliseconds,5000);
 assert.equal((calls[0].input as any).__discardObservation,undefined);
 assert.deepEqual(result.printed,['fresh']);
 assert.equal(result.snapshot,'fresh');
 assert.equal(isBrowserObservationDiscarded(),false);
});

test('failed next operation is not replayed or replaced with old evidence',async()=>{
 const calls:string[]=[];
 const result=await runBrowserScript(`const p=browser.page(); await p.wait(5000); await p.inspect();`,async(name)=>{
  calls.push(name);if(name==='browser_wait')return {observationDeferred:true};throw Error('disconnected');
 });
 assert.deepEqual(calls,['browser_wait','browser_inspect']);assert.equal(result.$toolError,true);assert.equal(result.snapshot,undefined);
});

test('compiled discarded clicks still stop immediately for approval',async()=>{
 const {ApprovalRequiredError}=await import('../lib/harness/actions');
 const approval=new ApprovalRequiredError({toolName:'browser_click',preview:'Purchase'} as import('../lib/harness/types').AgentAction);
 const calls:string[]=[];
 await assert.rejects(runBrowserScript(`const p=browser.page(); await p.ref('e1').click({requiresApproval:true,purpose:'Purchase'}); await p.inspect();`,async(name)=>{
  calls.push(name);assert.equal(isBrowserObservationDiscarded(),true);throw approval;
 }),error=>error===approval);
 assert.deepEqual(calls,['browser_click']);assert.equal(isBrowserObservationDiscarded(),false);
});

test('fresh locator read replaces an unused click snapshot without changing returned data',async()=>{
 const calls:Array<[string,boolean]>=[];
 const matches=[{ref:'e2',text:'Fresh details',enabled:true}];
 const result=await runBrowserScript(`const p=browser.page(); await p.ref('e1').click({requiresApproval:false,purpose:'Open details'}); print(await p.getByRole('region').innerText());`,async(name)=>{
  calls.push([name,isBrowserObservationDiscarded()]);
  if(name==='browser_click')return {observationDeferred:true};
  if(name==='browser_extended')return {matches};
  throw Error('Unexpected extra browser operation');
 });
 assert.deepEqual(calls,[['browser_click',true],['browser_extended',false]]);
 assert.equal(result.$toolError,undefined);assert.deepEqual(result.printed,['Fresh details']);assert.deepEqual(result.matches,matches);
});

test('ambiguous read gets one fresh fallback observation without replaying click',async()=>{
 const calls:string[]=[];
 const result=await runBrowserScript(`const p=browser.page(); await p.ref('e1').click({requiresApproval:false,purpose:'Open details'}); print(await p.getByRole('region').innerText());`,async(name)=>{
  calls.push(name);
  if(name==='browser_click')return {observationDeferred:true};
  if(name==='browser_extended')return {matches:[{ref:'e2'},{ref:'e3'}]};
  return {snapshot:'fresh after ambiguous read',url:'https://example.com'};
 });
 assert.deepEqual(calls,['browser_click','browser_extended','browser_inspect']);
 assert.equal(result.$toolError,true);assert.equal(result.snapshot,'fresh after ambiguous read');
 assert.match(String(result.error),/matched 2/);assert.equal(result.lastCompletedObservation,undefined);
});

test('failed locator RPC is never retried or followed by automatic recovery',async()=>{
 const calls:string[]=[];
 const result=await runBrowserScript(`const p=browser.page(); await p.ref('e1').click({requiresApproval:false,purpose:'Open details'}); print(await p.getByRole('region').innerText());`,async(name)=>{
  calls.push(name);if(name==='browser_click')return {observationDeferred:true};throw Error('connection lost');
 });
 assert.deepEqual(calls,['browser_click','browser_extended']);assert.equal(result.$toolError,true);assert.equal(result.snapshot,undefined);
});

test('locator reads cannot discharge explicit field-batch observation requirement',async()=>{
 const calls:string[]=[];
 const result=await runBrowserScript(`const p=browser.page(); await p.ref('e1').fill('ordinary text',{observe:false,purpose:'Fill'}); await p.ref('e2').click({requiresApproval:false,purpose:'Open details'}); print(await p.getByRole('region').innerText());`,async(name)=>{
  calls.push(name);
  if(name==='browser_type'||name==='browser_click')return {observationDeferred:true};
  if(name==='browser_extended')return {matches:[{ref:'e3',text:'details'}]};
  return {snapshot:'full field batch evidence'};
 });
 assert.equal(result.$toolError,undefined);assert.equal(calls.at(-1),'browser_inspect');assert.equal(result.snapshot,'full field batch evidence');
});

test('conditional locator reads and computed read arguments cannot discard observations',()=>{
 for(const code of [
  `const p=browser.page(); await p.ref('e1').click(); print(false && await p.getByRole('region').innerText());`,
  `const p=browser.page(); await p.ref('e1').click(); print(await p.getByRole('region').getAttribute(attribute));`,
 ])assert.equal(compileDiscardedObservations(code),code);
});

test('unused straight-line fills batch automatically and retain the final observation',async()=>{
 const calls:Array<{name:string;discarded:boolean}>=[];
 const result=await runBrowserScript(`const p=browser.page();await p.getByLabel('First').fill('Ada');await p.getByPlaceholder('Last').fill('Lovelace');await p.getByTestId('city').fill('London');`,async(name)=>{
  const discarded=isBrowserObservationDiscarded();calls.push({name,discarded});
  if(name==='browser_extended')return {matches:[{ref:'e1'}]};
  return discarded?{observationDeferred:true}:{snapshot:'All three fields filled'};
 });
 assert.equal(result.$toolError,undefined);
 assert.deepEqual(calls.filter(c=>c.name==='browser_type').map(c=>c.discarded),[true,true,false]);
 assert.equal(result.snapshot,'All three fields filled');
 assert.equal(calls.filter(c=>c.name==='browser_inspect').length,0);
});

test('automatic fill batching preserves explicit observations, dependencies and page boundaries',()=>{
 for(const code of [
  `const p=browser.page();const first=await p.getByLabel('First').fill('Ada');await p.getByLabel('Last').fill('Lovelace');`,
  `const p=browser.page();await p.getByLabel('First').fill('Ada',{observe:true});await p.getByLabel('Last').fill('Lovelace');`,
  `const p=browser.page();await p.getByLabel('First').fill('Ada');await p.getByLabel('Last').fill(getLast());`,
  `const p=browser.page();await p.getByLabel('First').fill('Ada');if(ready)await p.getByLabel('Last').fill('Lovelace');`,
  `const p=browser.page();await p.getByLabel('First').fill('Ada');print(await p.inspect());await p.getByLabel('Last').fill('Lovelace');`,
  `const p=browser.page();const q=browser.page();await p.getByLabel('First').fill('Ada');await q.getByLabel('Last').fill('Lovelace');`,
 ])assert.equal(compileDiscardedObservations(code),code);
});

test('failed automatic fill batch never replays a partially completed input',async()=>{
 let fills=0;
 const result=await runBrowserScript(`const p=browser.page();await p.ref('e1').fill('First');await p.ref('e2').fill('Second');`,async(name)=>{
  if(name==='browser_extended')return {matches:[{ref:'e1'}]};
  if(++fills===1)return {observationDeferred:true};
  throw Error('Input acknowledgement lost');
 });
 assert.equal(result.$toolError,true);assert.equal(fills,2);assert.equal(result.snapshot,undefined);
});

test('page typing batches with an immediate known page key, including a consumed final result', () => {
 for(const code of [
  `const p=browser.page(); await p.keyboard.type('slate',{purpose:'Guess'}); await p.keyboard.press('Enter',{purpose:'Play',requiresApproval:false});`,
  `const p=browser.page(); await p.keyboard.type('slate'); const r=await p.keyboard.press('Enter'); print(r.snapshot);`,
 ]) assert.match(compileDiscardedObservations(code),/__discardBrowserObservation/);
 for(const code of [
  `const p=browser.page(); const typed=await p.keyboard.type('slate'); await p.keyboard.press('Enter');`,
  `const p=browser.page(); await p.keyboard.type('slate'); await p.inspect(); await p.keyboard.press('Enter');`,
  `const p=browser.page(); await p.keyboard.type('slate'); if(true) await p.keyboard.press('Enter');`,
  `const p=browser.page(); await p.keyboard.type('slate'); await p.keyboard.press('Enter',{requiresApproval:true});`,
 ]) assert.doesNotMatch(compileDiscardedObservations(code),/__discardBrowserObservation/);
});
