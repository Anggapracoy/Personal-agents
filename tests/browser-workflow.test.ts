import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { CLOUD_BROWSER_CONTROLLER } from "../lib/harness/browser/cloud-controller";
import { generateText, type ModelMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { MemoryRunStore } from "../lib/harness/store";
import { createToolRegistry, secureVaultPage } from "../lib/harness/tools";
import { ApprovalRequiredError } from "../lib/harness/actions";
import { browserKeyApprovalBackstop, browserApprovalBackstop, browserTargetSchema, resolveBrowserTarget } from "../lib/harness/browser/policy";
import { financialApprovalType, reusablePurchaseControl } from "../lib/harness/browser/financial-approval";
import { withBrowserVision } from "../lib/harness/browser/vision";
import { type BrowserSnapshot, BrowserlessCloudBrowserProvider, formatDomSnapshot } from "../lib/harness/browser/cloud";
import type { SandboxProvider } from "../lib/harness/sandbox/types";

const pixel="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const control=(name:string,role='button',ref='e1')=>({ref,name,role,tag:'button',type:'submit',href:'',disabled:false,checked:null});

test('semantic targets reject ambiguity; submit type alone does not require approval',()=>{
 const page:BrowserSnapshot={title:'Example',url:'https://example.com',text:'',activeModalCount:0,elements:[control('Search')]};
 assert.equal(resolveBrowserTarget({role:'button',name:'Search'},page),'e1');
 assert.throws(()=>resolveBrowserTarget({role:'button',name:'missing'},page),/0 controls/);
 assert.throws(()=>resolveBrowserTarget('e2',page),/Stale/);
 page.elements.push(control('Search','button','e2'));
 assert.throws(()=>resolveBrowserTarget({role:'button',name:'Search'},page),/2 controls/);
 for(const name of ['Search','Ok','Measurements','Close dialog','Next','Continue']) assert.equal(browserApprovalBackstop(control(name)),null);
 assert.equal(browserApprovalBackstop({...control('Buy now'),tag:'a',href:'https://example.com/product'}),null);
 for(const name of ['Place order','Pay now','Buy now']) assert.equal(browserApprovalBackstop(control(name)),'purchase');
 assert.equal(browserApprovalBackstop(control('Make payment')),'purchase');
 assert.equal(browserApprovalBackstop(control('Transfer money')),'transfer');
 assert.equal(browserApprovalBackstop(control('Send')),'send');
 assert.equal(browserApprovalBackstop(control('Delete account')),'delete');
 assert.equal(browserApprovalBackstop({...control('Delete account'),tag:'a',href:'https://example.com/delete'}),'delete');
});

test('agent selects the shared money approval header while bill and transfer controls cannot masquerade as purchases',()=>{
 for (const name of ['Delete', 'Delete account', 'Move to Trash', 'Archive', 'Sign in', 'Log in']) {
   assert.equal(financialApprovalType(name, 'Authorized non-money action', 'payment'), null);
 }
 assert.equal(financialApprovalType('Delete', 'Delete the payment notification', 'purchase'), null);
 assert.equal(financialApprovalType('Place order','One bag for CA$16.78','purchase'),'purchase');
 assert.equal(financialApprovalType('Pay now','Pay Hydro One bill for CA$83.20','bill_payment'),'bill_payment');
 assert.equal(financialApprovalType('Transfer','Send CA$50 to Alex','transfer'),'transfer');
 assert.equal(financialApprovalType('Pay now','Pay CA$20','payment'),'payment');
 assert.throws(()=>financialApprovalType('Pay bill','Pay Hydro One', 'purchase'),/Choose bill_payment/);
 assert.throws(()=>financialApprovalType('Transfer money','Send to Alex', 'purchase'),/Choose transfer/);
 assert.throws(()=>financialApprovalType('Place order','One bag for CA$16.78', 'payment'),/Choose purchase/);
 assert.equal(reusablePurchaseControl('Place order'),true);
 assert.equal(reusablePurchaseControl('Pay now'),false);
 assert.equal(reusablePurchaseControl('Pay bill'),false);
});

test('bill payments require final confirmation without a reusable purchase preference',async()=>{
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'financial-approval@example.invalid',decisionId:null,title:'Pay',request:'Pay the bill',category:'test',metadata:{}});
 await store.updateRun(run.id,{status:'running'});
 const page:BrowserSnapshot={title:'Pay',url:'https://example.com/pay',text:'Pay Hydro bill CA$83.20',activeModalCount:0,elements:[control('Pay bill')]};
 const fake={click:async()=>({...page,formatted:formatDomSnapshot(page)}),preflightRef:async()=>({page:{...page,formatted:formatDomSnapshot(page)},element:page.elements[0]}),snapshot:async()=>({...page,formatted:formatDomSnapshot(page)}),describeRef:async()=>page.elements[0],currentUrl:()=>page.url,screenshot:async()=>Buffer.from(pixel,'base64')} as unknown as BrowserlessCloudBrowserProvider;
 const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'financial',store,cloudBrowser:fake,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
 try {
  const click=registry.browserActions.browser_click.execute!;
  const options={toolCallId:'bill',messages:[] as ModelMessage[],context:undefined};
  await assert.rejects(click({ref:'e1',requiresApproval:true,purpose:'Pay Hydro bill for CA$83.20',approvalType:'bill_payment'},options), /Paused: waiting for the user/);
  assert.equal((await store.getRun(run.id))?.status,'awaiting_approval');
  const pending=(await store.getSnapshot(run.id))?.actions.at(-1);
  assert.equal(pending?.input.approvalType,'bill_payment');
  assert.equal(pending?.input.approvalCategory,undefined);
  assert.equal(pending?.status,'proposed');
  assert.equal(pending?.approvedAt,null);
 } finally {await registry.close();}
});

test('scoped targets require one scope and select only its descendants',()=>{
 const page:BrowserSnapshot={title:'Scopes',url:'https://example.com',text:'',activeModalCount:0,elements:[
  control('Primary','region','e1'),control('Secondary','region','e2'),
  {...control('Search','button','e3'),ancestorRefs:['e1']},
  {...control('Search','button','e4'),ancestorRefs:['e2']},
 ]};
 assert.throws(()=>resolveBrowserTarget({role:'button',name:'Search'},page),/2 controls/);
 assert.equal(resolveBrowserTarget({role:'button',name:'Search',within:{role:'region',name:'Secondary'}},page),'e4');
 assert.equal(resolveBrowserTarget({role:'button',name:'Search',within:'e1'},page),'e3');
 page.elements.push(control('Secondary','region','e5'));
 assert.throws(()=>resolveBrowserTarget({role:'button',name:'Search',within:{role:'region',name:'Secondary'}},page),/2 controls/);
});

test('cart edits execute without approval but cannot bypass final purchase controls',async()=>{
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'cart-test@example.invalid',decisionId:null,title:'Cart',request:'Add one item to my cart without ordering',category:'test',metadata:{}});
 await store.updateRun(run.id,{status:'running'});
 let clicks=0;
 const page:BrowserSnapshot={title:'Shop',url:'https://example.com/product',text:'One lamp $20',activeModalCount:0,elements:[control('Add to bag')]};
 const fake={preflightRef:async()=>({page:{...page,formatted:formatDomSnapshot(page)},element:page.elements[0]}),snapshot:async()=>({...page,formatted:formatDomSnapshot(page)}),describeRef:async()=>page.elements[0],currentUrl:()=>page.url,click:async()=>{clicks++;return {...page,formatted:formatDomSnapshot(page)};},screenshot:async()=>Buffer.from(pixel,'base64')} as unknown as BrowserlessCloudBrowserProvider;
 const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'test-step',store,cloudBrowser:fake,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
 try {
  const click=registry.browserActions.browser_click.execute!;
  const options={toolCallId:'cart',messages:[] as ModelMessage[],context:undefined};
  await click({ref:'e1',requiresApproval:false,purpose:'Add one lamp to the bag'},options);
  await click({ref:'e1',requiresApproval:false,purpose:'Add one lamp to the bag'},options);
  assert.equal(clicks,2); // A repeated routine interaction must not return a cached click.
  assert.equal((await store.getRun(run.id))?.status,'running');
  assert.equal((await store.getSnapshot(run.id))?.actions[0].risk,'write_reversible');
  page.elements=[control('Place order')];
  await assert.rejects(async()=>{await click({ref:'e1',requiresApproval:false,purpose:'Place order'},options);},/consequential/);
  assert.equal(clicks,2);
  await assert.rejects(async()=>{await click({ref:'e1',requiresApproval:true,purpose:'Order the lamp for $20'},options);},ApprovalRequiredError);
  assert.equal(clicks,2);
 } finally {await registry.close();}
});

test('encoded locator objects are parsed as data and revalidated, never evaluated',()=>{
 const target={role:'button',name:'Search',within:{role:'region',name:'Secondary'}};
 assert.deepEqual(browserTargetSchema.parse(JSON.stringify(target)),target);
 assert.deepEqual(browserTargetSchema.parse(target),target);
 for(const invalid of ['{bad json}', '{"role":"button"}', '{"role":"button","name":"Search","within":"document.body"}', 'document.querySelector("button").click()']) {
  assert.equal(browserTargetSchema.safeParse(invalid).success,false);
 }
});

test('Enter uses the same consequential-action approval and deduplication as clicking',async()=>{
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'keyboard-test@example.invalid',decisionId:null,title:'Keyboard approval',request:'Research only',category:'test',metadata:{}});
 await store.updateRun(run.id,{status:'running'});
 let presses=0;
 const page:BrowserSnapshot={title:'Message',url:'https://mail.google.com/message',text:'To Alice. Message: hello',activeModalCount:0,elements:[control('Send')]};
 const fake={preflightRef:async()=>({page:{...page,formatted:formatDomSnapshot(page)},element:page.elements[0]}),snapshot:async()=>({...page,formatted:formatDomSnapshot(page)}),describeRef:async()=>page.elements[0],currentUrl:()=>page.url,press:async()=>{presses++;return {...page,formatted:formatDomSnapshot(page)};},screenshot:async()=>Buffer.from(pixel,'base64')} as unknown as BrowserlessCloudBrowserProvider;
 const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'test-step',store,cloudBrowser:fake,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
 try {
  const press=registry.browserActions.browser_press.execute!;
  const options={toolCallId:'test',messages:[] as ModelMessage[],context:undefined};
  await assert.rejects(async()=>{await press({ref:'e1',key:'Enter',requiresApproval:false,purpose:'Read'},options);},/consequential/);
  const args={ref:'e1',key:'Enter',requiresApproval:true,purpose:'Send email hello to Alice'};
  await assert.rejects(async()=>{await press(args,options);},ApprovalRequiredError);
  const actions=(await store.getSnapshot(run.id))!.actions;
  assert.equal(presses,0);
  assert.equal(actions[0].toolName,'browser_press');
  assert.equal(actions[0].input.key,'Enter');
  await store.approveAction(actions[0].id,run.id,run.userId);
  await store.updateRun(run.id,{status:'running'});
  await press(args,options);
  await press(args,options);
  assert.equal(presses,1);
 } finally {await registry.close();}
});

test('browser approval blocks the real action, binds the intended page, and executes an unchanged approved action once',async()=>{
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'browser-test@example.invalid',decisionId:null,title:'Browser approval',request:'Research only',category:'test',metadata:{actionType:'approval',chosenOption:'Research'}});
 await store.updateRun(run.id,{status:'running'});
 let clicks=0;
 let page:BrowserSnapshot={title:'Message',url:'https://mail.google.com/message',text:'To Alice. Message: hello',activeModalCount:0,elements:[control('Send')]};
 const fake={preflightRef:async()=>({page:{...page,formatted:formatDomSnapshot(page)},element:page.elements[0]}),snapshot:async()=>({...page,formatted:formatDomSnapshot(page)}),describeRef:async()=>page.elements[0],currentUrl:()=>page.url,click:async()=>{clicks++;return {...page,formatted:formatDomSnapshot(page)};},screenshot:async()=>Buffer.from(pixel,'base64')} as unknown as BrowserlessCloudBrowserProvider;
 const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'test-step',store,cloudBrowser:fake,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
 try {
  const click=registry.browserActions.browser_click.execute!;
  const options={toolCallId:'test',messages:[] as ModelMessage[],context:undefined};
  await assert.rejects(async()=>{await click({ref:'e1',requiresApproval:false,purpose:'Read'},options);},/consequential/);
  assert.equal(clicks,0);
  // The model may request approval even when the control name has no backstop.
  page={...page,elements:[control('Continue')]};
  const args={ref:{role:'button',name:'Continue'},requiresApproval:true,purpose:'Send email hello to Alice'};
  await assert.rejects(async()=>{await click(args,options);},ApprovalRequiredError);
  let actions=(await store.getSnapshot(run.id))!.actions;
  assert.equal(actions.length,1); assert.equal(clicks,0);
  await store.approveAction(actions[0].id,run.id,run.userId);
  await store.updateRun(run.id,{status:'running'});
  page={...page,url:'https://mail.google.com/other-message',text:'To Bob. Message: hello'};
  await assert.rejects(async()=>{await click(args,options);},ApprovalRequiredError);
  assert.equal(clicks,0);
  actions=(await store.getSnapshot(run.id))!.actions;
  assert.equal(actions.length,2);
  assert.notEqual(actions[0].input.pageEvidence,actions[1].input.pageEvidence);
  await store.approveAction(actions[1].id,run.id,run.userId);
  await store.updateRun(run.id,{status:'running'});
  await click(args,options);
  await click(args,options);
  assert.equal(clicks,1);
 } finally {await registry.close();}
});

test('purchase approval survives page-content changes and dispatches exactly once', async () => {
 const store = new MemoryRunStore();
 const run = await store.createRun({userId:'purchase-diagnostic@example.invalid',decisionId:null,title:'Purchase',request:'Order one item',category:'test',metadata:{}});
 await store.updateRun(run.id,{status:'running'});
 const before:BrowserSnapshot={title:'Checkout',url:'https://shop.example/checkout',documentId:'doc',text:'Order Review collapsed\nOne bag\nTotal $20',activeModalCount:0,elements:[control('Place order')]};
 const after={...before,text:'Order Review expanded\nOne bag\nTotal $20'};
 let dispatches=0;
 let approved=false;
 const fake={preflightRef:async()=>({page:{...before,formatted:formatDomSnapshot(before)},element:before.elements[0]}),snapshot:async()=>({...(approved?after:before),formatted:formatDomSnapshot(approved?after:before)}),currentUrl:()=>before.url,click:async()=>{dispatches++;return {...after,formatted:formatDomSnapshot(after)};},screenshot:async()=>Buffer.from(pixel,'base64')} as unknown as BrowserlessCloudBrowserProvider;
 const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'purchase',store,cloudBrowser:fake,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
 try {
  const click=registry.browserActions.browser_click.execute!;
  const args={ref:'e1',requiresApproval:true,purpose:'Place one order for $20'};
  const options={toolCallId:'purchase',messages:[] as ModelMessage[],context:undefined};
  await assert.rejects(async()=>click(args,options),ApprovalRequiredError);
  const action=(await store.getSnapshot(run.id))!.actions[0];
  assert.ok(action.input.pageEvidence);
  assert.equal(action.input.approvalBaseline,undefined);
  await store.approveAction(action.id,run.id,run.userId);
  await store.updateRun(run.id,{status:'running'});
  approved=true;
  await click(args,options);
  await click(args,options);
  assert.equal(dispatches,1);
 } finally {await registry.close();}
});

test('Muse adapter receives browser pixels as image_url input, never a JSON image tool payload',async()=>{
 const store=new MemoryRunStore();
 const artifact=await store.createArtifact({runId:'vision-test',actionId:null,name:'frame.png',mimeType:'image/png',bytesBase64:pixel});
 const messages:ModelMessage[]=[{role:'user',content:'Inspect this page'},{role:'assistant',content:[{type:'tool-call',toolName:'browser_screenshot',toolCallId:'call',input:{}}]},{role:'tool',content:[{type:'tool-result',toolName:'browser_screenshot',toolCallId:'call',output:{type:'json',value:{url:'https://example.com',snapshot:'Price $59.99',artifact:{id:artifact.id}}}}]}];
 const prepared=await withBrowserVision(messages,store,'vision-test');
 assert.equal(prepared.length,4);
 assert.equal((await withBrowserVision(prepared,store,'vision-test')).length,4);
 assert.equal((await withBrowserVision([...messages,{role:'user',content:'New task'}],store,'vision-test')).length,4);
 let captured:Record<string,unknown>={};
 const provider=createOpenAICompatible({name:'meta',baseURL:'https://example.invalid/v1',apiKey:'test',fetch:async(_url,init)=>{
  captured=JSON.parse(String(init?.body));
  return new Response(JSON.stringify({id:'test',object:'chat.completion',created:1,model:'muse-spark-1.3',choices:[{index:0,message:{role:'assistant',content:'Seen'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}),{headers:{'content-type':'application/json'}});
 }});
 await generateText({model:provider('muse-spark-1.3'),messages:prepared});
 const outgoing=captured.messages as Array<{role:string;content:unknown}>;
 const imageMessage=outgoing.at(-1)!;
 assert.equal(imageMessage.role,'user');
 assert.deepEqual((imageMessage.content as Array<unknown>)[1],{type:'image_url',image_url:{url:`data:image/png;base64,${pixel}`}});
 assert.ok(!JSON.stringify(outgoing.filter(m=>m.role==='tool')).includes(pixel));
});


test('accessibility extraction preserves price and heading semantics without editable secret values',()=>{
 const source=CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('def accessibility_text('),CLOUD_BROWSER_CONTROLLER.indexOf('def snapshot(cdp):'));
 const nodes=[
  {nodeId:'1',role:{value:'RootWebArea'},childIds:['2','3','4','checked','readonly']},
  {nodeId:'2',role:{value:'heading'},name:{value:'Desk'},properties:[{name:'level',value:{value:1}}]},
  {nodeId:'3',role:{value:'StaticText'},name:{value:'Price $ 59.99'}},
  {nodeId:'checked',role:{value:'checkbox'},name:{value:'Enabled'},properties:[{name:'checked',value:{value:'true'}}]},
  {nodeId:'readonly',role:{value:'textbox'},name:{value:'Read only'},properties:[{name:'readonly',value:{value:true}}]},
  {nodeId:'4',role:{value:'textbox'},name:{value:'Payment card'},value:{value:'secret-card-number'}},
 ];
 for(let i=0;i<650;i++) {
  const nodeId=String(i+5);
  nodes[0].childIds!.push(nodeId);
  nodes.push({nodeId,role:{value:'StaticText'},name:{value:`Long product description ${i}: ${'x'.repeat(80)}`}});
 }
 const script='import json\n'+source+'\nclass CDP:\n def command(self,*args,**kwargs): return {"nodes": json.loads('+JSON.stringify(JSON.stringify(nodes))+')}\nprint(accessibility_text(CDP(),{}))';
 const result=spawnSync('python3',['-c',script],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/heading "Desk" \[level=1\]/);
 assert.match(result.stdout,/checkbox "Enabled" \[checked\]/);
 assert.match(result.stdout,/textbox "Read only" \[readonly\]/);
 assert.match(result.stdout,/Price \$ 59.99/);
 assert.doesNotMatch(result.stdout,/secret-card-number/);
 assert.match(result.stdout,/Long product description 649/);
});

test('native AX identities join by backend node across documents, not inferred labels or node order',()=>{
 const source=CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('def dom_ref_map('),CLOUD_BROWSER_CONTROLLER.indexOf('def accessibility_text('));
 const script=`
class CDP:
 def command(self, method, params=None, session_id=None):
  assert session_id == 'child-session'
  if method == 'Accessibility.getFullAXTree':
   assert params == {'frameId':'child-frame'}
   return {'nodes':[{'backendDOMNodeId':22,'role':{'value':'combobox'},'name':{'value':'Dropdown (select)'}},{'backendDOMNodeId':11,'role':{'value':'slider'},'name':{'value':'Example range'}},{'backendDOMNodeId':33,'ignored':True,'role':{'value':'none'}}]}
  if method == 'DOM.disable': return {}
  assert method == 'DOM.getDocument' and params == {'depth':-1,'pierce':True}
  return {'root':{'backendNodeId':1,'children':[{'backendNodeId':11,'attributes':['data-decision-feed-ref','e18'],'shadowRoots':[{'backendNodeId':22,'attributes':['data-decision-feed-ref','e8']}],'contentDocument':{'backendNodeId':33,'attributes':['data-decision-feed-ref','e19']}}]}}
nodes, identities=accessibility_identity(CDP(), {'frameId':'child-frame','sessionId':'child-session'})
assert identities == {'e8':{'role':'combobox','name':'Dropdown (select)'},'e18':{'role':'slider','name':'Example range'}}
`;
 const result=spawnSync('python3',['-c',source+'\n'+script],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});

test('formatted snapshot exposes readonly fields and uses native control identities for targeting',()=>{
 const page:BrowserSnapshot={title:'Form',url:'https://example.com',text:'',activeModalCount:0,elements:[{...control('Dropdown (select)','combobox','e8'),tag:'select'},{...control('Readonly input','textbox','e6'),readOnly:true}]};
 assert.equal(resolveBrowserTarget({role:'combobox',name:'Dropdown (select)'},page),'e8');
 assert.match(formatDomSnapshot(page),/e6 textbox \(readonly\) "Readonly input"/);
});

test('busy parent snapshots preserve later controls, child-frame text and secret redaction',()=>{
 const source=CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('def frame_observation_expression('),CLOUD_BROWSER_CONTROLLER.indexOf('def set_secret_mask(')) + CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('def observation_error_code('),CLOUD_BROWSER_CONTROLLER.indexOf('def evaluate_context(')) + CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('def snapshot(cdp):'),CLOUD_BROWSER_CONTROLLER.indexOf('def describe(cdp, ref):'));
 const script=`import json
SNAPSHOT_EXPRESSION = 'snapshot __REF_START__'
def recover_missing_hosted_fields(cdp): return None
def frame_contexts(cdp): return [{'main': True}, {'main': False}]
def evaluate_context(cdp, expression, context):
 if expression.startswith('snapshot'):
  start=int(expression.split()[1])
  count=650 if context['main'] else 2
  return {'title':'Busy shop','url':'https://example.invalid','nextRef':start+count,'elements':[{'ref':'e'+str(start+i+1),'name':'Product Size' if not context['main'] else 'Product '+str(i),'value':'secret' if not context['main'] else ''} for i in range(count)]}
 if expression.startswith('Array.from'): return ['e652']
 return 0
def accessibility_identity(cdp, context): return [], {}
def accessibility_rows(nodes, frame_index, redacted_refs=None): return []
def accessibility_text(cdp, context, nodes=None): return 'P'*30000 if context['main'] else 'C'*15000+'Body Size M: 38 inches'
page=snapshot(type('CDP', (), {})())
assert len(page['elements']) == 652
assert page['elements'][650]['name'] == 'Product Size'
assert page['text'].endswith('Body Size M: 38 inches')
assert 'value' not in page['elements'][651]
assert page['elements'][651]['valueRedacted'] is True
print('ok')
`;
 const result=spawnSync('python3',['-c',source+'\n'+script],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});

test('a failed navigation must not attach the previous page screenshot as current evidence',async()=>{
 const store=new MemoryRunStore();
 const artifact=await store.createArtifact({runId:'failed-navigation',actionId:null,name:'search.png',mimeType:'image/png',bytesBase64:pixel});
 const messages:ModelMessage[]=[
  {role:'user',content:'Open the product'},
  {role:'tool',content:[{type:'tool-result',toolName:'browser_open',toolCallId:'search',output:{type:'json',value:{url:'https://example.com/search',snapshot:'Search results',browserFrame:{id:artifact.id}}}}]},
  {role:'tool',content:[{type:'tool-result',toolName:'browser_open',toolCallId:'product',output:{type:'error-text',value:'Browser navigation failed: net::ERR_HTTP2_PROTOCOL_ERROR'}}]},
 ];
 assert.deepEqual(await withBrowserVision(messages,store,'failed-navigation'),messages);
});

test('failed page operations invalidate the provider cached URL',async()=>{
 const browser=new BrowserlessCloudBrowserProvider();
 const internal=browser as unknown as {run(operation:string):Promise<BrowserSnapshot>;snapshotOperation(operation:string,payload:Record<string,unknown>):Promise<BrowserSnapshot>};
 internal.run=async(operation)=>{
  if(operation==='navigate')throw new Error('Browser navigation failed: net::ERR_HTTP2_PROTOCOL_ERROR');
  return {title:'Search',url:'https://example.com/search',text:'Search results',elements:[],activeModalCount:0};
 };
 await browser.snapshot();
 assert.equal(browser.currentUrl(),'https://example.com/search');
 await assert.rejects(internal.snapshotOperation('navigate',{url:'https://example.com/product'}),/ERR_HTTP2_PROTOCOL_ERROR/);
 assert.equal(browser.currentUrl(),'about:blank');
});


test('vault security checks reconnect after handoff and reject live insecure pages despite stale HTTPS cache', async () => {
 const browser = new BrowserlessCloudBrowserProvider();
 const internal = browser as unknown as { run(operation: string): Promise<BrowserSnapshot> };
 let liveUrl = 'https://example.com/checkout';
 let reads = 0;
 internal.run = async operation => {
  assert.equal(operation, 'snapshot');
  reads++;
  return {title:'Checkout',url:liveUrl,text:'',elements:[],activeModalCount:0};
 };
 assert.equal(browser.currentUrl(), 'about:blank');
 assert.equal((await secureVaultPage(browser, 'login')).url, liveUrl);
 assert.equal(reads, 1);
 // The user navigated during takeover: a previously secure cache is not authority.
 liveUrl = 'http://example.com/checkout';
 await assert.rejects(secureVaultPage(browser, 'login'), /Saved logins can only/);
 liveUrl = 'https://example.com/payment';
 assert.equal((await secureVaultPage(browser, 'payment_card')).url, liveUrl);
 liveUrl = 'about:blank';
 await assert.rejects(secureVaultPage(browser, 'payment_card'), /Payment cards can only/);
 internal.run = async () => { throw new Error('Browser unavailable'); };
 await assert.rejects(secureVaultPage(browser, 'login'), /Browser unavailable/);
});

test('repeated text, select and checkbox edits use live state rather than old receipts',async()=>{
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'setter-test@example.invalid',decisionId:null,title:'Setters',request:'Prepare form',category:'test',metadata:{}});
 await store.updateRun(run.id,{status:'running'});
 let value='', checked=false, writes=0;
 const page=():BrowserSnapshot=>({title:'Form',url:'https://example.com/form',text:'Form',activeModalCount:0,elements:[{...control('Value','textbox'),tag:'input',type:'text',value,checked}]});
 const snapshot=()=>({...page(),formatted:formatDomSnapshot(page())});
 const fake={preflightRef:async()=>({page:snapshot(),element:page().elements[0]}),snapshot:async()=>snapshot(),describeRef:async()=>page().elements[0],currentUrl:()=>page().url,
  type:async(_ref:string,text:string)=>{value=text;writes++;return snapshot();},
  select:async(_ref:string,text:string)=>{value=text;writes++;return snapshot();},
  setChecked:async(_ref:string,next:boolean)=>{checked=next;writes++;return snapshot();},
  screenshot:async()=>Buffer.from(pixel,'base64')} as unknown as BrowserlessCloudBrowserProvider;
 const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'same-turn',store,cloudBrowser:fake,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
 const options={toolCallId:'setter',messages:[] as ModelMessage[],context:undefined};
 try{
  for(const name of ['browser_type','browser_select']){
   for(const next of ['Alice','Bob','Alice']){
    const receipt=await registry.browserActions[name].execute!({ref:'e1',...(name==='browser_type'?{text:next}:{value:next}),purpose:'Set requested value'},options) as {snapshot:string};
    assert.equal(value,next); assert.match(receipt.snapshot,new RegExp(`Value: "${next}"`));
   }
  }
  for(const next of [true,false,true]){await registry.browserActions.browser_check.execute!({ref:'e1',checked:next,purpose:'Set requested checkbox'},options);assert.equal(checked,next);}
  assert.equal(writes,9);
 }finally{await registry.close();}
});

test('Enter in a field inherits the default submitter approval and approved submission executes once',async()=>{
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'implicit-test@example.invalid',decisionId:null,title:'Enter',request:'Prepare message',category:'test',metadata:{}});
 await store.updateRun(run.id,{status:'running'});
 const submitter=control('Send');
 const field={...control('Message','textbox'),tag:'input',type:'text',implicitSubmission:true,formMethod:'post',formSubmitter:submitter};
 const page:BrowserSnapshot={title:'Message',url:'https://mail.google.com/message',text:'To Alice: hello',activeModalCount:0,elements:[field,{...submitter,ref:'e2'}]};
 let presses=0;
 const fake={preflightRef:async()=>({page:{...page,formatted:formatDomSnapshot(page)},element:field}),snapshot:async()=>({...page,formatted:formatDomSnapshot(page)}),describeRef:async()=>field,currentUrl:()=>page.url,press:async()=>{presses++;return {...page,formatted:formatDomSnapshot(page)};},screenshot:async()=>Buffer.from(pixel,'base64')} as unknown as BrowserlessCloudBrowserProvider;
 const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'implicit',store,cloudBrowser:fake,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
 const options={toolCallId:'enter',messages:[] as ModelMessage[],context:undefined};
 try{
  const press=registry.browserActions.browser_press.execute!;
  await assert.rejects(async()=>{await press({ref:'e1',key:'Enter',requiresApproval:false,purpose:'Finish editing'},options);},/consequential/);
  assert.equal(presses,0);
  const args={ref:'e1',key:'Enter',requiresApproval:true,purpose:'Send email hello to Alice'};
  await assert.rejects(async()=>{await press(args,options);},ApprovalRequiredError);
  const action=(await store.getSnapshot(run.id))!.actions[0];
  await store.approveAction(action.id,run.id,run.userId);await store.updateRun(run.id,{status:'running'});
  await press(args,options);await press(args,options);assert.equal(presses,1);
 }finally{await registry.close();}
});


test('keyboard submission policy preserves search, newlines and selection but guards editor shortcuts',()=>{
 const field={name:'Name',tag:'input',type:'text',role:'textbox',implicitSubmission:true,formMethod:'post',formSubmitter:control('Pay now')};
 assert.equal(browserKeyApprovalBackstop(field,'Enter'),'purchase');
 assert.equal(browserKeyApprovalBackstop(field,'ArrowDown'),null);
 assert.equal(browserKeyApprovalBackstop({...field,formMethod:'get',formSubmitter:control('Search')},'Enter'),null);
 assert.equal(browserKeyApprovalBackstop({...field,formSubmitter:null},'Enter'),'implicit_submission');
 assert.equal(browserKeyApprovalBackstop({...field,tag:'textarea',implicitSubmission:false},'Enter'),null);
 assert.equal(browserKeyApprovalBackstop({...field,tag:'textarea',implicitSubmission:false},'ControlOrMeta+Enter'),'purchase');
 assert.equal(browserKeyApprovalBackstop({tag:'div',role:'textbox',isContentEditable:true},'ControlOrMeta+Enter'),'implicit_submission');
 assert.equal(browserKeyApprovalBackstop({tag:'select',role:'combobox'},'Enter'),null);
 assert.equal(browserKeyApprovalBackstop({tag:'input',type:'checkbox'},'Space'),null);
});

test('screenshots capture current pages and tolerate same-origin redirects without long URL copying',async()=>{
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'screenshot-test@example.invalid',decisionId:null,title:'Capture',request:'Show the page',category:'test',metadata:{}});
 await store.updateRun(run.id,{status:'running'});
 let captures=0;
 const page={title:'Rendered result',url:'https://example.com/resolved/very-long-path?state=updated',text:'Ready',elements:[],formatted:'Ready'};
 const fake={snapshot:async()=>page,screenshot:async()=>{captures++;return Buffer.from(pixel,'base64')}} as unknown as BrowserlessCloudBrowserProvider;
 const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'capture',store,cloudBrowser:fake,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
 try {
  const capture=registry.browserActions.browser_screenshot.execute!;
  const options={toolCallId:'capture',messages:[] as ModelMessage[],context:undefined};
  const current=await capture({name:'current.png',purpose:'Inspect current result'},options) as {actualUrl:string;artifact:{id:string}};
  assert.equal(current.actualUrl,page.url);
  assert.ok(await store.getArtifact(current.artifact.id,run.id));
  await capture({name:'redirect.png',purpose:'Inspect redirected result',expectedUrl:'https://example.com/start'},options);
  assert.equal(captures,2);
  await assert.rejects(async()=>{await capture({name:'wrong.png',purpose:'Wrong origin',expectedUrl:'https://other.example/start'},options)},/origin mismatch/);
  assert.equal(captures,2);
 } finally {await registry.close()}
});

test('routine clicks and Enter execute with scoped preflight while approvals require complete evidence', async () => {
 const store = new MemoryRunStore();
 const run = await store.createRun({userId:'scoped-controls@example.invalid',decisionId:null,title:'Browse',request:'Prepare checkout',category:'test',metadata:{}});
 await store.updateRun(run.id,{status:'running'});
 const page:BrowserSnapshot={title:'Shop',url:'https://example.com',text:'Total $20',elements:[control('Continue')],activeModalCount:0};
 const snapshot=()=>({...page,formatted:formatDomSnapshot(page)});
 const preflights:boolean[]=[];
 let clicks=0,presses=0,incomplete=false;
 const fake={
  preflightRef:async(ref:string,fullPage:boolean)=>{preflights.push(fullPage);return {page:fullPage && !incomplete ? snapshot() : {...snapshot(),text:'',scopeRef:ref},element:page.elements[0]};},
  snapshot:async()=>snapshot(),currentUrl:()=>page.url,
  click:async()=>{clicks++;return snapshot();},press:async()=>{presses++;return snapshot();},
  screenshot:async()=>Buffer.from(pixel,'base64'),
 } as unknown as BrowserlessCloudBrowserProvider;
 const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'scoped',store,cloudBrowser:fake,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
 const options={toolCallId:'scoped',messages:[] as ModelMessage[],context:undefined};
 try {
  for(const name of ['Search','Add to cart','Continue']) {
   page.elements=[control(name)];
   await registry.browserActions.browser_click.execute!({ref:'e1',requiresApproval:false,purpose:name},options);
   await registry.browserActions.browser_press.execute!({ref:'e1',key:'Enter',requiresApproval:false,purpose:name},options);
  }
  assert.equal(clicks,3);assert.equal(presses,3);
  assert.deepEqual(preflights,[false,false,false,false,false,false]);
  assert.ok((await store.getSnapshot(run.id))!.actions.every(action=>action.status==='executed' && action.risk==='write_reversible'));
  incomplete=true;
  await assert.rejects(async()=>{await registry.browserActions.browser_click.execute!({ref:'e1',requiresApproval:true,purpose:'Send email to Alice'},options);},/complete browser observation/);
  incomplete=false;
  await assert.rejects(async()=>{await registry.browserActions.browser_click.execute!({ref:'e1',requiresApproval:true,purpose:'Send email to Alice'},options);},ApprovalRequiredError);
  assert.deepEqual(preflights.slice(-2),[true,true]);
  assert.equal(clicks,3);assert.equal(presses,3);
 } finally {await registry.close();}
});

test('approved purchase dispatches without a second page or control comparison', async () => {
 for (const change of ['url','control']) {
  const store=new MemoryRunStore();
  const run=await store.createRun({userId:'swap@example.invalid',decisionId:null,title:'Purchase',request:'Order',category:'test',metadata:{}});
  await store.updateRun(run.id,{status:'running'});
  const before:BrowserSnapshot={title:'Checkout',url:'https://shop.example/checkout',documentId:'doc',text:'Total $20',activeModalCount:0,elements:[control('Place order')]};
  let approved=false,dispatches=0;
  const after=change==='url'?{...before,url:'https://other.example/checkout'}:{...before,elements:[control('Subscribe')]};
  const fake={preflightRef:async()=>({page:before,element:before.elements[0]}),snapshot:async()=>approved?after:before,currentUrl:()=>before.url,click:async()=>{dispatches++;return before;},screenshot:async()=>Buffer.from(pixel,'base64')} as unknown as BrowserlessCloudBrowserProvider;
  const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'swap',store,cloudBrowser:fake,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
  try {
   const args={ref:'e1',requiresApproval:true,purpose:'Place order for $20'};
   const options={toolCallId:'swap',messages:[] as ModelMessage[],context:undefined};
   await assert.rejects(async()=>registry.browserActions.browser_click.execute!(args,options),ApprovalRequiredError);
   const action=(await store.getSnapshot(run.id))!.actions[0];
   await store.approveAction(action.id,run.id,run.userId);await store.updateRun(run.id,{status:'running'});approved=true;
   await registry.browserActions.browser_click.execute!(args,options);
   assert.equal(dispatches,1);
  } finally {await registry.close();}
 }
});

test('wait conditions fail fast on wrong names/scopes and still poll genuine transitions', () => {
 const source = CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('def wait_for_target('), CLOUD_BROWSER_CONTROLLER.indexOf('def press_key('));
 const script = `
import json
class Clock:
    ticks = 0
    def monotonic(self): return self.ticks
    def sleep(self, seconds): self.ticks += seconds
time = Clock()
pages = []
reads = 0
def snapshot(cdp):
    global reads
    reads += 1
    return pages.pop(0) if len(pages) > 1 else pages[0]
def page(elements, warnings=[]): return {"elements": elements, "warnings": warnings}
def element(ref, role, name, **extra): return dict(ref=ref, role=role, name=name, **extra)
def fails(target, expected, state="visible"):
    global reads
    reads = 0
    try: wait_for_target(None, target, state, 1000)
    except RuntimeError as error: assert expected in str(error), str(error)
    else: raise AssertionError("Expected failure")
    assert reads == 1, reads
pages = [page([element("e1", "link", "Inbox 11 unread")])]
fails({"role":"link", "name":"Inbox"}, "Observed candidates")
pages = [page([element("e1", "main", ""), element("e2", "heading", "Conversations", ancestorRefs=["e1"])])]
fails({"role":"heading", "name":"Conversations", "within":{"role":"main", "name":" "}}, "scope matched 0")
assert wait_for_target(None, {"role":"heading", "name":"Conversations", "within":"e1"}, "visible", 1000) == pages[0]
fails({"role":"heading", "name":"Conversations", "within":"e99"}, "scope matched 0", "hidden")
pages = [page([]), page([element("e3", "textbox", "Enter your password")])]
assert wait_for_target(None, {"role":"textbox", "name":"Enter your password"}, "visible", 1000)["elements"][0]["ref"] == "e3"
pages = [page([element("e3", "button", "Continue", disabled=True)]), page([element("e3", "button", "Continue", disabled=False)])]
assert not wait_for_target(None, "e3", "enabled", 1000)["elements"][0]["disabled"]
pages = [page([], ["child frame unavailable"]), page([])]
reads = 0
wait_for_target(None, "e3", "hidden", 1000)
assert reads == 2
pages = [page([element("e1", "button", "Continue"), element("e2", "button", "Continue")])]
fails({"role":"button", "name":"Continue"}, "ambiguous")
pages = [page([])]
try: wait_for_target(None, "e99", "visible", 100)
except RuntimeError as error: assert "Inspect the whole page" in str(error)
else: raise AssertionError("Expected timeout")
`;
 const result = spawnSync('python3', ['-c', source + '\n' + script], { encoding: 'utf8' });
 assert.equal(result.status, 0, result.stderr);
});

test('browser_run cannot catch purchase approval and continue, and resumes only the approved action',async()=>{
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'script-approval@example.invalid',decisionId:null,title:'Order',request:'Buy one lamp',category:'test',metadata:{}});
 await store.updateRun(run.id,{status:'running'});
 let clicks=0,reads=0;
 const page:BrowserSnapshot={title:'Checkout',url:'https://example.com/checkout',text:'One lamp USD 20',activeModalCount:0,elements:[control('Place order')]};
 const fake={preflightLocator:async()=>({matches:[{ref:'e1'}],ref:'e1',page:{...page,formatted:formatDomSnapshot(page)},element:page.elements[0]}),extended:async()=>({matches:[{ref:'e1'}]}),preflightRef:async()=>({page:{...page,formatted:formatDomSnapshot(page)},element:page.elements[0]}),snapshot:async()=>{reads++;return {...page,formatted:formatDomSnapshot(page)}},describeRef:async()=>page.elements[0],currentUrl:()=>page.url,click:async()=>{clicks++;return {...page,formatted:formatDomSnapshot(page)}},screenshot:async()=>Buffer.from(pixel,'base64')} as unknown as BrowserlessCloudBrowserProvider;
 const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'script',store,cloudBrowser:fake,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
 const options={toolCallId:'script',messages:[] as ModelMessage[],context:undefined};
 try {
  assert.equal(registry.tools.browser_click,undefined);
  const execute=registry.tools.browser_run.execute!;
  const denied=await execute({purpose:'Order lamp',code:`await browser.page().ref('e1').click({requiresApproval:false,purpose:'Buy one lamp for USD 20'});`},options) as Record<string,unknown>;
  assert.equal(denied.$toolError,true);assert.equal(clicks,0);

  await assert.rejects(execute({purpose:'Order lamp',code:`try { await browser.page().ref('e1').click({requiresApproval:true,purpose:'Buy one lamp for USD 20',approvalType:'purchase'}); } catch(e) {} await browser.page().inspect();`},options) as Promise<unknown>,ApprovalRequiredError);
  assert.equal(clicks,0);assert.equal(reads,0);
  const snapshot=await store.getSnapshot(run.id);assert.equal(snapshot?.actions.at(-1)?.status,'proposed');
  await store.approveAction(snapshot!.actions.at(-1)!.id,run.id,run.userId);
  await store.updateRun(run.id,{status:'running'});
  const resume={purpose:'Order lamp',code:`await browser.page().ref('e1').click({requiresApproval:true,purpose:'Buy one lamp for USD 20',approvalType:'purchase'});`};
  await execute(resume,options); await execute(resume,options); assert.equal(clicks,1);
 } finally {await registry.close()}
});

test('browser_run screenshot reaches model vision and a newer query invalidates it',async()=>{
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'vision-script@test.invalid',decisionId:null,title:'Vision',request:'Look',category:'test',metadata:{}});
 const artifact=await store.createArtifact({runId:run.id,actionId:null,name:'view.png',mimeType:'image/png',bytesBase64:pixel});
 const messages:ModelMessage[]=[{role:'tool',content:[{type:'tool-result',toolCallId:'script',toolName:'browser_run',output:{type:'json',value:{artifact:{id:artifact.id},lastBrowserAction:'browser_screenshot',snapshot:'Current page',actualUrl:'https://example.com'}}}]}];
 assert.equal((await withBrowserVision(messages,store,run.id)).at(-1)?.role,'user');
 messages.push({role:'tool',content:[{type:'tool-result',toolCallId:'new',toolName:'browser_run',output:{type:'json',value:{lastBrowserAction:'browser_extended',matches:[]}}}]});
 assert.equal((await withBrowserVision(messages,store,run.id)).length,2);
});

test('discarded script results never defer consequential outcome checks or purchase approval',async()=>{
 const {withDiscardedBrowserObservation}=await import('../lib/harness/browser/discarded-observation');
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'deferred-observation@example.invalid',decisionId:null,title:'Navigation',request:'Close the dialog and delete the requested item',category:'test',metadata:{}});
 let ordinary=0,consequential=0;
 const page:BrowserSnapshot={title:'Example',url:'https://example.com',text:'',activeModalCount:0,elements:[control('Close')]};
 const fake={preflightRef:async()=>({page:{...page,formatted:formatDomSnapshot(page)},element:page.elements[0]}),currentUrl:()=>page.url,
  clickWithoutObservation:async()=>{ordinary++;return {observationDeferred:true}},
  click:async(_ref:string,options:{observeOutcome:boolean})=>{assert.equal(options.observeOutcome,true);consequential++;return {...page,formatted:formatDomSnapshot(page)}},
  screenshot:async()=>Buffer.from(pixel,'base64')} as unknown as BrowserlessCloudBrowserProvider;
 const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'deferred',store,cloudBrowser:fake,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
 const options={toolCallId:'deferred',messages:[] as ModelMessage[],context:undefined};
 try {
  const click=registry.browserActions.browser_click.execute!;
  await withDiscardedBrowserObservation(true,async()=>{await click({ref:'e1',requiresApproval:false,purpose:'Close dialog'},options)});
  assert.equal(ordinary,1);
  page.elements=[control('Delete')];
  await withDiscardedBrowserObservation(true,async()=>{await click({ref:'e1',requiresApproval:false,purpose:'Delete the requested item'},options)});
  assert.equal(consequential,1);assert.equal(ordinary,1);
  page.elements=[control('Place order')];
  await assert.rejects(withDiscardedBrowserObservation(true,async()=>{await click({ref:'e1',requiresApproval:true,purpose:'Buy one lamp for USD 20',approvalType:'purchase'},options)}),ApprovalRequiredError);
  assert.equal(consequential,1);assert.equal(ordinary,1);
 }finally{await registry.close()}
});

test('automatic field batch keeps guarded receipts for every fill and observes the last fill',async()=>{
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'batch-fields@example.invalid',decisionId:null,title:'Fill form',request:'Fill both fields',category:'test',metadata:{}});
 const calls:string[]=[];
 const page:BrowserSnapshot={title:'Form',url:'https://example.com',text:'First Ada Last Lovelace',activeModalCount:0,elements:[]};
 const fake={currentUrl:()=>page.url,extended:async()=>({matches:[{ref:'e1'}]}),
  typeWithoutObservation:async(_ref:string,text:string)=>{calls.push('deferred:'+text);return {observationDeferred:true}},
  type:async(_ref:string,text:string)=>{calls.push('observed:'+text);return {...page,formatted:formatDomSnapshot(page)}},
  screenshot:async()=>Buffer.from(pixel,'base64')} as unknown as BrowserlessCloudBrowserProvider;
 const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'batch',store,cloudBrowser:fake,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
 try {
  const result=await registry.tools.browser_run.execute!({purpose:'Fill both fields',code:`const p=browser.page();await p.getByLabel('First').fill('Ada');await p.getByLabel('Last').fill('Lovelace');`},{toolCallId:'batch',messages:[] as ModelMessage[],context:undefined}) as Record<string,unknown>;
  assert.equal(result.$toolError,undefined);
  assert.deepEqual(calls,['deferred:Ada','observed:Lovelace']);
  const actions=(await store.getSnapshot(run.id))!.actions.filter(a=>a.toolName==='browser_type');
  assert.equal(actions.length,2);assert.ok(actions.every(a=>a.status==='executed'));
  assert.equal(typeof result.snapshot,'string');
 }finally{await registry.close()}
});

test('page keyboard validates literal input and records one guarded action',async()=>{
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'page-keyboard@example.invalid',decisionId:null,title:'Keyboard',request:'Type text',category:'test',metadata:{}});
 const calls:string[]=[];
 const page:BrowserSnapshot={title:'Keyboard',url:'https://example.com',text:'slate',activeModalCount:0,elements:[]};
 const fake={currentUrl:()=>page.url,typePageText:async(text:string)=>{calls.push(text);return {...page,formatted:formatDomSnapshot(page)}},screenshot:async()=>Buffer.from(pixel,'base64')} as unknown as BrowserlessCloudBrowserProvider;
 const registry=await createToolRegistry({runId:run.id,userId:run.userId,stepId:'keyboard',store,cloudBrowser:fake,sandbox:{} as SandboxProvider,sandboxState:{created:false}});
 const options={toolCallId:'keyboard',messages:[] as ModelMessage[],context:undefined};
 try {
  const result=await registry.tools.browser_run.execute!({purpose:'Type text',code:`await browser.page().keyboard.type('slate',{purpose:'Type text'});`},options) as Record<string,unknown>;
  assert.equal(result.$toolError,undefined);
  assert.deepEqual(calls,['slate']);
  const actions=(await store.getSnapshot(run.id))!.actions.filter(a=>a.toolName==='browser_keyboard_type');
  assert.equal(actions.length,1);assert.equal(actions[0].status,'executed');
  const invalid=await registry.tools.browser_run.execute!({purpose:'Type text',code:`await browser.page().keyboard.type('slate\\n',{purpose:'Type text'});`},options) as Record<string,unknown>;
  assert.equal(invalid.$toolError,true);assert.deepEqual(calls,['slate']);
 }finally{await registry.close()}
});
