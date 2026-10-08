import assert from 'node:assert/strict';
import test from 'node:test';
import { browserScriptGuide, runBrowserScript } from '../lib/harness/browser/script';
import { workflowSystemPrompt } from '../lib/harness/model';
import { RunStoppedError } from '../lib/harness/actions';

test('script awaits actions, reads results and branches in order', async()=>{
 const calls:string[]=[];
 const result=await runBrowserScript(`const p=browser.page(); await p.goto('https://example.com'); const rows=await p.getByRole('button',{name:'Search'}).all(); if(rows.length===1) await rows[0].click({requiresApproval:false,purpose:'Search'}); print(await p.title());`,async(name)=>{calls.push(name);return name==='browser_extended'?{matches:[{ref:'e1'}]}:name==='browser_inspect'?{title:'Found'}:{};});
 assert.equal(result.$toolError,undefined);
 assert.deepEqual(calls,['browser_open','browser_extended','browser_click','browser_inspect']);
 assert.deepEqual(result.printed,['Found']);
});
test('runtime failure cannot be caught to continue dispatch',async()=>{
 let count=0;
 const result=await runBrowserScript(`try{await browser.page().goto('https://example.com')}catch(e){} await browser.page().inspect()`,async()=>{count++;throw Error('failed')});
 assert.equal(count,1); assert.equal(result.$toolError,true);
});
test('stop object escapes the script unchanged',async()=>{
 const stopped=new RunStoppedError();
 await assert.rejects(runBrowserScript(`try{await browser.page().inspect()}catch(e){}`,async()=>{throw stopped}),e=>e===stopped);
});
test('untrusted JavaScript cannot access host globals or run forever',async()=>{
 const r=await runBrowserScript(`print([typeof process,typeof require,typeof fetch]);`,async()=>({}));
 assert.deepEqual(r.printed,[['undefined','undefined','undefined']]);
 const loop=await runBrowserScript(`while(true){}`,async()=>({}),undefined,30);assert.equal(loop.$toolError,true);
});
test('screenshot remains explicit and newest operation invalidates it',async()=>{
 const screenshot=await runBrowserScript(`await browser.page().screenshot({purpose:'View',name:'view.png'})`,async()=>({artifact:{id:'image'}}));assert.equal(screenshot.lastBrowserAction,'browser_screenshot');
 const query=await runBrowserScript(`await browser.page().screenshot({purpose:'View',name:'view.png'});await browser.page().getByText('x').count()`,async(name)=>name==='browser_screenshot'?{artifact:{id:'image'}}:{matches:[]});assert.equal(query.artifact,undefined);
});

test('browser script stops after its action budget and after uncertain outcomes',async()=>{
 let count=0;
 const budget=await runBrowserScript(`for(let i=0;i<40;i++) await browser.page().inspect()`,async()=>{count++;return {}});
 assert.equal(count,32);assert.equal(budget.$toolError,true);
 count=0;
 const uncertain=await runBrowserScript(`await browser.page().inspect();await browser.page().inspect()`,async()=>{count++;return {outcomeObservation:{state:'unknown'}}});
 assert.equal(count,1);assert.equal(uncertain.$toolError,true);
});

test('overlapping browser operations are rejected before they can switch each other tabs',async()=>{
 let count=0;
 const result=await runBrowserScript(`await Promise.all([browser.tab('a').inspect(),browser.tab('b').inspect()])`,async()=>{count++;return {}});
 assert.equal(result.$toolError,true);assert.equal(count,0);
});

// Prevent instruction drift back to tools that are intentionally internal only.
test('browser workflow instructions use the model-facing scripting API', () => {
 assert.match(workflowSystemPrompt, /Use browser_run for all ordinary browser interactions/);
 assert.doesNotMatch(workflowSystemPrompt, /browser_(?:open|back|inspect|screenshot|click|press|type|select|check|scroll|hover|wait|wait_for)\b/);
 assert.match(workflowSystemPrompt, /browser_fill_login/);
 assert.match(workflowSystemPrompt, /browser_fill_card/);
 assert.match(workflowSystemPrompt, /page\.inspect\(\)/);
});

test('visible dialog filtering and object inspection work through the script facade', async () => {
 const calls:unknown[]=[];
 const result=await runBrowserScript(`const p=browser.page(); const observation=await p.inspect(); print(observation.snapshot.slice(0,5)); await p.getByRole('dialog').filter({visible:true}).getByRole('button',{name:'Continue'}).filter({visible:true}).click({requiresApproval:false,purpose:'Continue form'});`,async(name,args)=>{
  calls.push({name,args});
  return name==='browser_inspect'?{snapshot:'Fresh page',url:'https://example.com'}:name==='browser_extended'?{matches:[{ref:'e7'}]}:{};
 });
 assert.equal(result.$toolError,undefined);
 assert.deepEqual(result.printed,['Fresh']);
 const query=calls.find((call:any)=>call.name==='browser_click') as any;
 assert.equal(query.args.ref.locator.visible,true);
 assert.equal(query.args.ref.locator.scopes[0].visible,true);
});

test('print preserves labels and all values without changing single-value results', async () => {
 const result=await runBrowserScript(`print('count',4); print({visible:true}); print('zero',0,false,null);`,async()=>({}));
 assert.deepEqual(result.printed,[['count',4],{visible:true},['zero',0,false,null]]);
});

test('screenshot supplies png suffix for a bare name but preserves invalid paths for schema rejection', async () => {
 const names:unknown[]=[];
 const result=await runBrowserScript(`const p=browser.page();for(const name of ['checkout-cart-cleanup','view.png','../escape','view.jpg'])await p.screenshot({name,purpose:'Inspect'});`,async(_name,args:any)=>{names.push(args.name);return {}});
 assert.equal(result.$toolError,undefined);
 assert.deepEqual(names,['checkout-cart-cleanup.png','view.png','../escape','view.jpg']);
});

test('geometry uses locator reads, supports hidden controls, and requires an unambiguous target', async () => {
 const rect={x:10,y:20,width:100,height:40};
 const r=await runBrowserScript(`print(await browser.page().getByRole('button',{name:'Save'}).boundingBox());`,async(name)=>{assert.equal(name,'browser_extended');return {matches:[{visible:true,rect}]}});
 assert.deepEqual(r.printed,[rect]);
 const hidden=await runBrowserScript(`print(await browser.page().locator('.hidden').boundingBox());`,async()=>({matches:[{visible:false,rect:{x:0,y:0,width:0,height:0}}]}));
 assert.deepEqual(hidden.printed,[null]);
 const ambiguous=await runBrowserScript(`await browser.page().locator('button').boundingBox();`,async()=>({matches:[{visible:true,rect},{visible:true,rect}]}));
 assert.equal(ambiguous.$toolError,true);
});

test('option value attributes are available without exposing input values',async()=>{
 const result=await runBrowserScript(`print(await browser.page().getByRole('option',{name:'Two'}).getAttribute('value'));`,async()=>({matches:[{ref:'e1',attributes:{value:'2'}}]}));
 assert.deepEqual(result.printed,['2']);
 const denied=await runBrowserScript(`print(await browser.page().getByRole('textbox',{name:'Password'}).getAttribute('value'));`,async()=>({matches:[{ref:'e2',attributes:{type:'password'}}]}));
 assert.equal(denied.$toolError,true);
 assert.match(String(denied.error),/only.*native option/);
});

 test('documented search example returns action observation without another inspection', async () => {
 const example = browserScriptGuide.split('Example: ')[1].split('\n')[0];
 const calls: string[] = [];
 const result = await runBrowserScript(example, async (name) => {
  calls.push(name);
  if (name === 'browser_extended') return { matches: [{ ref: 'e1' }] };
  if (name === 'browser_type') return { snapshot: 'Search input filled' };
  if (name === 'browser_press') return { snapshot: 'Search results ready', url: 'https://example.com/search' };
  throw new Error(`Unexpected browser operation: ${name}`);
 });
 assert.equal(result.$toolError, undefined);
 assert.deepEqual(calls, ['browser_extended', 'browser_type', 'browser_press']);
 assert.deepEqual(result.printed, ['Search results ready']);
 assert.equal(result.snapshot, 'Search results ready');
});

test('deferred field batches perform one final observation with fresh locator resolution', async () => {
 const calls:string[]=[];
 const result=await runBrowserScript(`const p=browser.page();for(const name of ['Name','City','Notes'])await p.getByRole('textbox',{name}).fill(name,{observe:false});`,async(name,input)=>{
  calls.push(name);
  if(name==='browser_extended')return {matches:[{ref:'e1'}]};
  if(name==='browser_type'){assert.equal((input as {deferObservation:boolean}).deferObservation,true);return {observationDeferred:true};}
  assert.equal(name,'browser_inspect');return {snapshot:'Final filled form'};
 });
 assert.equal(result.$toolError,undefined);
 assert.equal(calls.filter(n=>n==='browser_extended').length,3);
 assert.equal(calls.filter(n=>n==='browser_inspect').length,1);
 assert.equal(result.snapshot,'Final filled form');
});

test('deferred batch cannot hide final observation failure or continue after a failed fill', async () => {
 for(const failFill of [true,false]){
  const calls:string[]=[];
  const result=await runBrowserScript(`await browser.page().ref('e1').fill('ordinary',{observe:false});`,async(name)=>{
   calls.push(name);
   if(name==='browser_extended')return {matches:[{ref:'e1'}]};
   if(name==='browser_type')return failFill?{$toolError:true}:{observationDeferred:true};
   return {$toolError:true};
  });
  assert.equal(result.$toolError,true);
  assert.equal(calls.includes('browser_inspect'),!failFill);
 }
});


test('reuses tab selection within a script, while preserving switches and close invalidation', async () => {
 const selections:string[]=[];
 const result=await runBrowserScript(`const a=browser.tab('a'),b=browser.tab('b');await a.inspect();await a.getByRole('button',{name:'Ready'}).count();await a.frame('child').inspect();await b.inspect();await a.inspect();await b.close();await a.inspect();`,async(name,input)=>{
  const value=input as {action?:string;id?:string};
  if(value.action==='tabs_select')selections.push(value.id!);
  if(value.action==='query')return {matches:[{ref:'e1'}]};
  return name==='browser_inspect'?{snapshot:'Current page'}:{};
 });
 assert.equal(result.$toolError,undefined);
 assert.deepEqual(selections,['a','b','a','a']);
 const again=await runBrowserScript(`await browser.tab('a').inspect();`,async(name,input)=>{
  if((input as {action?:string}).action==='tabs_select')selections.push('a');
  return name==='browser_inspect'?{snapshot:'Current page'}:{};
 });
 assert.equal(again.$toolError,undefined);
 assert.equal(selections.length,5,'Selection confidence must not persist across model calls');
});


test('combined locator interaction polls only before dispatch and retains the operation budget', async () => {
 const calls:string[]=[];
 let resolved=false;
 const result=await runBrowserScript(`await browser.page().getByRole('button',{name:'Continue'}).click({requiresApproval:false,purpose:'Continue'});`,async(name,args:any)=>{
  calls.push(name);
  if(name==='browser_extended'){assert.equal(args.poll.state,'attached');return {matches:[{ref:'e1'}]};}
  assert.equal(args.ref.locator.name,'Continue');
  if(!resolved){resolved=true;return {locatorMissing:true};}
  return {snapshot:'Clicked once'};
 });
 assert.deepEqual(calls,['browser_click','browser_extended','browser_click']);
 assert.deepEqual(result.completed,['browser_extended','browser_extended','browser_extended','browser_click']);
 assert.equal(result.snapshot,'Clicked once');
 let count=0;
 const budget=await runBrowserScript(`for(let i=0;i<32;i++)await browser.page().getByRole('button',{name:'Next'}).click({requiresApproval:false,purpose:'Next'});`,async()=>{count++;return {snapshot:'Next'};});
 assert.equal(count,16);
 assert.equal(budget.$toolError,true);
});

test('combined locator failure cannot be caught to retry a potentially dispatched click',async()=>{
 let calls=0;
 const result=await runBrowserScript(`try{await browser.page().ref('e1').click({requiresApproval:false,purpose:'Next'})}catch(e){}await browser.page().ref('e1').click({requiresApproval:false,purpose:'Retry'});`,async()=>{calls++;throw Error('Transport lost after dispatch');});
 assert.equal(calls,1);assert.equal(result.$toolError,true);
});


test('print overflow keeps the successful observation instead of requiring another browser read',async()=>{
 const snapshot='Fresh observation '.repeat(7000);
 const metadata={version:1,documentId:'document',complete:true,scopeRef:null};
 let reads=0;
 const result=await runBrowserScript(`print((await browser.page().inspect()).snapshot);`,async()=>{reads++;return {snapshot,url:'https://example.com/',browserSnapshotContext:metadata};});
 assert.equal(reads,1);assert.equal(result.$toolError,true);
 assert.equal(result.snapshot,snapshot);assert.deepEqual(result.browserSnapshotContext,metadata);
 assert.equal(result.lastBrowserAction,'browser_inspect');
 assert.deepEqual(result.completed,['browser_inspect']);
 assert.match(String(result.instruction),/Use it instead of repeating/);
});

test('print recovery never attaches a prior snapshot after a later uncertain browser operation',async()=>{
 const snapshot='Fresh observation '.repeat(7000);
 let calls=0;
 const result=await runBrowserScript(`try {print((await browser.page().inspect()).snapshot)}catch(e){} await browser.page().ref('e1').click({requiresApproval:false,purpose:'Continue'});`,async()=>{
  if(++calls===1)return {snapshot};
  throw Error('Connection lost after possible dispatch');
 });
 assert.equal(calls,2);assert.equal(result.$toolError,true);assert.equal(result.snapshot,undefined);
 assert.match(String(result.instruction),/Inspect and resume/);
});


test('ambiguous read preserves the preceding action observation as historical evidence',async()=>{
 const result=await runBrowserScript(`const p=browser.page();await p.ref('e1').click({requiresApproval:false,purpose:'Open measurements'});print(await p.getByRole('tabpanel').innerText());`,async(name)=>{
  if(name==='browser_click')return {snapshot:'Measurements: 40 by 20',url:'https://example.com/desk'};
  return {matches:[{ref:'e2'},{ref:'e3'}]};
 });
 assert.equal(result.$toolError,true);assert.equal(result.snapshot,undefined);
 assert.deepEqual(result.lastCompletedObservation,{snapshot:'Measurements: 40 by 20',url:'https://example.com/desk',title:undefined,observedAfter:'browser_click'});
 assert.match(String(result.instruction),/not a new inspection/);
});

test('historical evidence is cleared before a later input, even when that input fails',async()=>{
 let clicks=0;
 const result=await runBrowserScript(`const p=browser.page();await p.ref('e1').click({requiresApproval:false,purpose:'Open'});await p.ref('e2').click({requiresApproval:false,purpose:'Continue'});`,async()=>{
  if(++clicks===1)return {snapshot:'Before second action'};
  throw Error('Connection lost after possible input');
 });
 assert.equal(clicks,2);assert.equal(result.snapshot,undefined);assert.equal(result.lastCompletedObservation,undefined);
});

test('sequential typing batches supported literal text into one guarded press', async () => {
 const calls:Array<{name:string;input:any}>=[];
 const result=await runBrowserScript(`await browser.page().getByRole('button',{name:'Keyboard target'}).pressSequentially('Abc123',{purpose:'Enter text',requiresApproval:false});`,async(name,input)=>{
  calls.push({name,input});return {snapshot:'Abc123'};
 });
 assert.equal(result.$toolError,undefined);
 assert.equal(calls.length,1);
 assert.equal(calls[0].name,'browser_press');
 assert.equal(calls[0].input.key,'Abc123');
 assert.equal(calls[0].input.requiresApproval,false);
 assert.deepEqual(calls[0].input.ref.locator,{role:'button',name:'Keyboard target'});
 assert.equal(result.snapshot,'Abc123');
});

test('sequential typing preserves literal named keys and unsupported text', async () => {
 for(const text of ['Enter','Tab','F1','a b','café','']){
  const keys:string[]=[];
  const result=await runBrowserScript(`await browser.page().ref('e1').pressSequentially(${JSON.stringify(text)},{purpose:'Literal text',requiresApproval:false});`,async(_name,input:any)=>{keys.push(input.key);return {}});
  assert.equal(result.$toolError,undefined);
  assert.deepEqual(keys,Array.from(text));
 }
});

test('batched sequential typing does not replay or fall back after uncertain failure', async () => {
 let count=0;
 const result=await runBrowserScript(`try{await browser.page().ref('e1').pressSequentially('slate',{purpose:'Enter text',requiresApproval:false})}catch{};await browser.page().ref('e1').press('Enter',{purpose:'Submit',requiresApproval:false});`,async()=>{count++;throw new Error('Connection lost after dispatch')});
 assert.equal(result.$toolError,true);
 assert.equal(count,1);
});

test('missing interaction target stops on ambiguous or absent poll results', async () => {
 for(const matches of [[],[{ref:'e1'},{ref:'e2'}]]){
  const calls:string[]=[];
  const result=await runBrowserScript(`await browser.page().getByRole('button',{name:'Ready'}).click({purpose:'Continue',requiresApproval:false});`,async(name)=>{
   calls.push(name);
   if(name==='browser_click')return {locatorMissing:true};
   assert.equal(name,'browser_extended');return {matches};
  });
  assert.equal(result.$toolError,true);
  assert.deepEqual(calls,['browser_click','browser_extended']);
 }
});

test('missing interaction target never retries input after a failed poll', async () => {
 const calls:string[]=[];
 const result=await runBrowserScript(`await browser.page().getByRole('button',{name:'Continue'}).press('Enter',{purpose:'Continue',requiresApproval:false});`,async(name)=>{
  calls.push(name);if(name==='browser_press')return {locatorMissing:true};
  throw Error('Observation connection lost');
 });
 assert.equal(result.$toolError,true);
 assert.deepEqual(calls,['browser_press','browser_extended']);
});


test('page keyboard sends literal text in one call without locator focus', async () => {
 const calls: unknown[]=[];
 const result=await runBrowserScript(`await browser.page().keyboard.type('Enter',{purpose:'Type literal text'})`,async(name,args)=>{calls.push({name,args});return {snapshot:'Entered'};});
 assert.equal(result.$toolError,undefined);
 assert.deepEqual(calls,[{name:'browser_keyboard_type',args:{text:'Enter',purpose:'Type literal text'}}]);
 const frame=await runBrowserScript(`await browser.page().frame('child').keyboard.type('abc',{purpose:'Type'})`,async()=>{throw Error('Must not dispatch')});
 assert.equal(frame.$toolError,true);
 assert.match(String(frame.error),/main document/);
});

test('page keyboard press stays separate from text, rejects frames and stops after a blocked key', async () => {
 const calls:string[]=[];
 const result=await runBrowserScript(`const p=browser.page(); await p.keyboard.type('slate'); const r=await p.keyboard.press('Enter',{requiresApproval:false,purpose:'Guess'}); print(r.snapshot);`,async(name)=>{calls.push(name);return name==='browser_keyboard_type'?{observationDeferred:true}:{snapshot:'Accepted SLATE',url:'https://example.com',title:'Game'}});
 assert.deepEqual(calls,['browser_keyboard_type','browser_keyboard_press']);assert.equal(result.snapshot,'Accepted SLATE');
 const blocked=await runBrowserScript(`const p=browser.page(); await p.keyboard.type('slate'); await p.keyboard.press('Enter'); await p.keyboard.type('crony');`,async(name)=>{if(name==='browser_keyboard_press')throw Error('Focus changed');return {observationDeferred:true}});
 assert.equal(blocked.$toolError,true);assert.match(String(blocked.error),/Focus changed/);assert.deepEqual(blocked.completed,['browser_keyboard_type']);
 const frame=await runBrowserScript(`await browser.page().frame('child').keyboard.press('Enter')`,async()=>{throw Error('Must not dispatch')});assert.equal(frame.$toolError,true);assert.match(String(frame.error),/main document/);
});

test('ambiguous interaction returns fresh candidates and stops without dispatch or extra inspection',async()=>{
 const candidates=[{ref:'e12',name:'Close',visible:true,containers:[{role:'dialog',name:'Bonus notice'}]},{ref:'e20',name:'Close',visible:false,containers:[{role:'dialog',name:'Old notice'}]}];const calls:string[]=[];
 const result=await runBrowserScript(`const p=browser.page();try{await p.getByRole('button',{name:'Close'}).click({requiresApproval:false,purpose:'Dismiss notice'})}catch(e){}await p.ref('e12').click({requiresApproval:false,purpose:'Retry'});`,async(name)=>{calls.push(name);return {locatorAmbiguous:true,matches:candidates,matchCount:2,inputDispatched:false}});
 assert.equal(result.$toolError,true);assert.deepEqual(result.ambiguity,{candidates,matchCount:2,inputDispatched:false});assert.deepEqual(result.completed,['browser_extended']);assert.deepEqual(calls,['browser_click']);assert.match(String(result.instruction),/Candidates are fresh/);
});
