import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from './helpers/process';
import type { ModelMessage } from 'ai';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
import { formatDomSnapshot, type BrowserSnapshot, type BrowserAXNode } from '../lib/harness/browser/cloud';
import { resolveBrowserTarget } from '../lib/harness/browser/policy';
import { browserSnapshotContext, diffBrowserSnapshots, restoreBrowserObservations, withBrowserObservationDiffs } from '../lib/harness/browser/observation-diff';

function page(): BrowserSnapshot {
  return {
    documentId:'document-one', title:'Form', url:'https://example.com/form', text:'legacy text is not duplicated', activeModalCount:0,
    focusedRef:'e2',
    axTree:[
      {id:'n0_1',parentId:null,role:'RootWebArea',name:'Form'},
      {id:'e1',ref:'e1',parentId:'n0_1',role:'region',name:'Settings'},
      ...Array.from({length:12},(_,i)=>({id:`e${i+2}`,ref:`e${i+2}`,parentId:'e1',role:'textbox',name:`Field ${i+1}`})),
    ],
    elements:[
      {ref:'e1',tag:'section',role:'region',name:'Settings',href:'',type:'',disabled:false,checked:null},
      ...Array.from({length:12},(_,i)=>({ref:`e${i+2}`,ancestorRefs:['e1'],tag:'input',role:'textbox',name:`Field ${i+1}`,href:'',type:'text',disabled:false,readOnly:false,settable:true,checked:null,value:''})),
    ],
  };
}
const result = (name:string,p:BrowserSnapshot):ModelMessage => ({role:'tool',content:[{type:'tool-result',toolCallId:name,toolName:name,output:{type:'json',value:{url:p.url,snapshot:formatDomSnapshot(p),browserSnapshotContext:browserSnapshotContext(p)!}}}]});
function value(message:ModelMessage):Record<string,unknown> {
  assert.equal(message.role,'tool');
  assert.ok(Array.isArray(message.content));
  const part=message.content[0]; assert.equal(part.type,'tool-result');
  assert.equal(part.output.type,'json');
  return part.output.value as Record<string,unknown>;
}
const rendered=(message:ModelMessage)=>value(message).snapshot as string;

test('one tree preserves exact control identity, hierarchy, states, safe values, actions and focus',()=>{
  const p=page();
  p.elements[1]={...p.elements[1],ref:'e2',role:'combobox',tag:'select',name:'Dropdown (select)',value:'2',options:[{value:'2',label:'Two',selected:true}]};
  p.axTree![2]={id:'e2',ref:'e2',parentId:'e1',role:'combobox',name:'Dropdown (select)',expanded:false};
  p.axTree!.splice(3,0,{id:'n0_option',parentId:'e2',role:'option',name:'Two',selected:true});
  p.elements[2]={...p.elements[2],readOnly:true,value:'Readonly input'};
  p.elements[3]={...p.elements[3],disabled:true};
  p.elements[4]={...p.elements[4],role:'switch',tag:'div',type:'',checked:'mixed'};
  p.axTree!.find(row=>row.id==='e5')!.role='switch';
  p.elements[5]={...p.elements[5],required:true,valid:false,validationMessage:'Choose a value'};
  const text=formatDomSnapshot(p);
  assert.match(text,/e2 combobox \(settable, collapsed\) "Dropdown \(select\)", Value: "2", Secondary Actions: Expand \(locator\.click\), Select \(locator\.selectOption\)/);
  assert.match(text,/    e2 /);
  assert.match(text,/n0_option option \(selected\) "Two"/);
  assert.match(text,/e3 textbox \(readonly\)/);
  assert.match(text,/e4 textbox \(disabled\)/);
  assert.match(text,/checked=mixed/);
  assert.match(text,/Secondary Actions: Check \(locator\.setChecked\)/);
  assert.match(text,/required, invalid/);
  assert.match(text,/Validation: "Choose a value"/);
  assert.match(text,/The focused UI element is e2 combobox/);
  assert.doesNotMatch(text,/Interactive elements:|legacy text/);
  assert.equal(text.split('\n').filter(line=>/^\s*e2 /.test(line)).length,1);
  assert.equal(resolveBrowserTarget({role:'combobox',name:'Dropdown (select)',within:{role:'region',name:'Settings'}},p),'e2');
});

test('native AX values and redacted DOM values never enter the formatted tree or focus footer',()=>{
  const p=page();
  p.elements[1]={...p.elements[1],value:'do-not-expose',valueRedacted:true};
  const row=p.axTree![2] as BrowserAXNode & {value:string};
  row.value='raw-native-secret';
  const text=formatDomSnapshot(p);
  assert.doesNotMatch(text,/do-not-expose|raw-native-secret/);
  assert.match(text,/Value: \[redacted\]/);
  assert.match(text,/The focused UI element is e2.*Value: \[redacted\]/);
});

test('structured AX extraction preserves states and suppresses editable descendants in every frame',()=>{
  const start=CLOUD_BROWSER_CONTROLLER.indexOf('def accessibility_rows(');
  const source=CLOUD_BROWSER_CONTROLLER.slice(start,CLOUD_BROWSER_CONTROLLER.indexOf('def accessibility_text(',start));
  const script=`
nodes=[
 {'nodeId':'1','backendDOMNodeId':1,'role':{'value':'RootWebArea'},'childIds':['2','3']},
 {'nodeId':'2','backendDOMNodeId':2,'controlRef':'e8','role':{'value':'combobox'},'name':{'value':'Card code'},'childIds':['4'],'properties':[{'name':'expanded','value':{'value':False}},{'name':'focused','value':{'value':True}}]},
 {'nodeId':'3','backendDOMNodeId':3,'controlRef':'e9','role':{'value':'switch'},'properties':[{'name':'checked','value':{'value':'mixed'}}]},
 {'nodeId':'4','backendDOMNodeId':4,'role':{'value':'StaticText'},'name':{'value':'secret-echo'}},
]
rows=accessibility_rows(nodes,2,{'e8'})
assert rows[0]['id']=='n2_1'
assert rows[1]['id']=='e8' and rows[1]['parentId']=='n2_1'
assert rows[1]['expanded'] is False and rows[1]['focused'] is True
assert rows[2]['checked']=='mixed'
assert len(rows)==3
`;
  const result=spawnSync('python3',['-c',source+'\n'+script],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});

test('routine updates show only changed rows and preserve full durable receipts',()=>{
  const first=page();const second=structuredClone(first);second.elements[1].value='Alice';
  const messages=[result('browser_open',first),result('browser_type',second)];
  const original=JSON.stringify(messages);
  const prepared=withBrowserObservationDiffs(messages);
  assert.equal(rendered(prepared[0]),formatDomSnapshot(first));
  assert.match(rendered(prepared[1]),/Accessibility changes/);
  assert.match(rendered(prepared[1]),/~     e2 textbox.*Value: "Alice"/);
  assert.doesNotMatch(rendered(prepared[1]),/e13 textbox/);
  assert.match(rendered(prepared[1]),/The focused UI element is e2/);
  assert.ok(rendered(prepared[1]).length<formatDomSnapshot(second).length);
  assert.equal('browserSnapshotContext' in value(prepared[0]),false);
  assert.equal(JSON.stringify(messages),original);
});

test('replacement controls explicitly invalidate old refs and expose new actionable refs',()=>{
  const first=page();const second=structuredClone(first);
  second.elements[1]={...second.elements[1],ref:'e90'};
  second.axTree![2]={...second.axTree![2],id:'e90',ref:'e90'};
  second.focusedRef='e90';
  const text=diffBrowserSnapshots(formatDomSnapshot(first),formatDomSnapshot(second));
  assert.match(text,/-     e2 textbox/);
  assert.match(text,/\+     e90 textbox/);
  assert.match(text,/Invalidated refs: e2/);
  assert.throws(()=>resolveBrowserTarget('e2',second),/Stale/);
  assert.equal(resolveBrowserTarget('e90',second),'e90');
});

test('navigation, explicit inspect, partial observations, errors and user input restore full trees',()=>{
  const first=page();const second=structuredClone(first);second.elements[1].value='Changed';
  const full=formatDomSnapshot(second);
  assert.equal(rendered(withBrowserObservationDiffs([result('browser_open',first),result('browser_inspect',second)])[1]),full);
  const navigated={...second,documentId:'replacement-document'};
  assert.equal(rendered(withBrowserObservationDiffs([result('browser_open',first),result('browser_type',navigated)])[1]),formatDomSnapshot(navigated));
  const interruptions:ModelMessage[]=[
    {role:'user',content:'Continue'},
    {role:'tool',content:[{type:'tool-result',toolCallId:'failed',toolName:'browser_click',output:{type:'error-text',value:'Navigation failed'}}]},
    result('browser_inspect',{...first,scopeRef:'e1'}),
    result('browser_inspect',{...first,warnings:['AX unavailable']}),
    {role:'tool',content:[{type:'tool-result',toolCallId:'other',toolName:'other_tool',output:{type:'json',value:{done:true}}}]},
  ];
  for(const interruption of interruptions) {
    const prepared=withBrowserObservationDiffs([result('browser_open',first),interruption,result('browser_type',second)]);
    assert.equal(rendered(prepared[2]),full);
  }
  // After history compaction the first surviving result must establish a full baseline.
  assert.equal(rendered(withBrowserObservationDiffs([result('browser_type',second)])[0]),full);
});

test('moves, reordered nodes, duplicate IDs and large changes use the complete observation',()=>{
  const first=page();
  const variants=[structuredClone(first),structuredClone(first),structuredClone(first),structuredClone(first)];
  [variants[0].axTree![2],variants[0].axTree![3]]=[variants[0].axTree![3],variants[0].axTree![2]];
  variants[1].axTree![2].parentId='n0_1';
  variants[2].axTree![3].id=variants[2].axTree![2].id;
  for(const element of variants[3].elements)element.value='New value';
  for(const p of variants) assert.equal(diffBrowserSnapshots(formatDomSnapshot(first),formatDomSnapshot(p)),formatDomSnapshot(p));
});

test('unchanged observations retain current focus and consequential outcome evidence',()=>{
  const first=page();const second=structuredClone(first);second.focusedRef='e3';
  second.outcomeObservation={state:'unknown',reason:'No confirmation',elapsedMs:1000,navigationObserved:false,pageChanged:false,preexistingValidationErrorCount:0,freshValidationErrors:[],mutationRequests:[{method:'POST',url:'https://example.com/order',status:500,finished:true,failed:false}]};
  const text=diffBrowserSnapshots(formatDomSnapshot(first),formatDomSnapshot(second));
  assert.match(text,/No accessibility changes/);
  assert.match(text,/The focused UI element is e3/);
  assert.match(text,/State: unknown/);
  assert.match(text,/POST https:\/\/example.com\/order -> 500/);
});


test('prepared messages are idempotent and an orphaned delta requests a fresh observation',()=>{
  const first=page();const second=structuredClone(first);second.elements[1].value='Alice';
  const prepared=withBrowserObservationDiffs([result('browser_open',first),result('browser_type',second)]);
  assert.deepEqual(withBrowserObservationDiffs(prepared),prepared);
  const orphan=withBrowserObservationDiffs([prepared[1]]);
  assert.match(rendered(orphan[0]),/full accessibility baseline is unavailable/);
  assert.match(rendered(orphan[0]),/Call page\.inspect\(\) in browser_run/);
  assert.doesNotMatch(rendered(orphan[0]),/~ .*e2/);
});

test('a child-frame document replacement invalidates the observation baseline',()=>{
  const start=CLOUD_BROWSER_CONTROLLER.indexOf('def snapshot(cdp):');
  const source=CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('def frame_observation_expression('),CLOUD_BROWSER_CONTROLLER.indexOf('def set_secret_mask(')) + CLOUD_BROWSER_CONTROLLER.slice(CLOUD_BROWSER_CONTROLLER.indexOf('def observation_error_code('),CLOUD_BROWSER_CONTROLLER.indexOf('def evaluate_context(')) + CLOUD_BROWSER_CONTROLLER.slice(start,CLOUD_BROWSER_CONTROLLER.indexOf('def describe(cdp, ref):',start));
  const script=`
SNAPSHOT_EXPRESSION='snapshot __REF_START__'
child_document='child-one'
def recover_missing_hosted_fields(cdp): return None
def frame_contexts(cdp): return [{'main':True,'frameId':'main'},{'main':False,'frameId':'child'}]
def evaluate_context(cdp,expression,context):
 if expression.startswith('snapshot'):
  return {'title':'Form','url':'https://example.com','elements':[],'nextRef':0,'documentId':'main-one' if context['main'] else child_document}
 if expression.startswith('Array.from'): return []
 return 0
def accessibility_identity(cdp,context): return [],{}
def accessibility_text(cdp,context,nodes=None): return ''
def accessibility_rows(nodes,frame_index,redacted_refs=None): return []
first=snapshot(type('CDP', (), {})())
assert snapshot(type('CDP', (), {})())['documentId']==first['documentId']
child_document='child-two'
assert snapshot(type('CDP', (), {})())['documentId']!=first['documentId']
`;
  const result=spawnSync('python3',['-c','import hashlib,json\n'+source+'\n'+script],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});


test('SDK carried-forward inputs retain diffs across successive browser steps',()=>{
  const first=page(); const second=structuredClone(first); second.elements[1].value='Alice';
  const third=structuredClone(second); third.elements[2].value='Bob';
  const originals=[result('browser_open',first),result('browser_type',second),result('browser_check',third)];
  let prepared:ModelMessage[]=[];
  for(let i=0;i<originals.length;i++) {
    prepared=withBrowserObservationDiffs(restoreBrowserObservations([...prepared,originals[i]],originals.slice(0,i+1)));
  }
  assert.match(rendered(prepared[1]),/Accessibility changes/);
  assert.match(rendered(prepared[2]),/Accessibility changes/);
  assert.match(rendered(prepared[2]),/Bob/);
  assert.doesNotMatch(JSON.stringify(prepared),/browserSnapshotContext/);
  assert.deepEqual(withBrowserObservationDiffs(restoreBrowserObservations(prepared,originals)),prepared);
  // A compaction cut starts with a full baseline, never an orphan delta.
  const cut=withBrowserObservationDiffs(restoreBrowserObservations(prepared.slice(2),originals));
  assert.equal(cut.length,1);
  assert.equal(rendered(cut[0]),formatDomSnapshot(third));
  assert.equal(value(originals[1]).snapshot,formatDomSnapshot(second));
});

test('restoring browser observations preserves errors and does not match another tool',()=>{
  const original=result('browser_open',page());
  const error:ModelMessage={role:'tool',content:[{type:'tool-result',toolName:'browser_open',toolCallId:'browser_open',output:{type:'error-text',value:'failed'}}]};
  assert.deepEqual(restoreBrowserObservations([error],[original]),[error]);
  const other:ModelMessage={role:'tool',content:[{type:'tool-result',toolName:'other',toolCallId:'browser_open',output:{type:'json',value:{ok:true}}}]};
  assert.deepEqual(restoreBrowserObservations([other],[original]),[other]);
});

test('browser_run uses its final action for lossless deltas and preserves explicit inspection',()=>{
  const first=page(); const second=structuredClone(first); second.elements[1].value='Alice';
  const script=(last:string)=>{
    const receipt=result('browser_run',second);
    Object.assign(value(receipt),{lastBrowserAction:last,printed:['Selected Alice']});
    return receipt;
  };
  const clicked=withBrowserObservationDiffs([result('browser_open',first),script('browser_type')]);
  assert.match(rendered(clicked[1]),/Accessibility changes/);
  assert.match(rendered(clicked[1]),/Alice/);
  assert.deepEqual(value(clicked[1]).printed,['Selected Alice']);
  const inspected=withBrowserObservationDiffs([result('browser_open',first),script('browser_inspect')]);
  assert.equal(rendered(inspected[1]),formatDomSnapshot(second));
});

test('historical script inspections are lossless deltas while the newest inspection stays complete',()=>{
 const first=page(); const second=structuredClone(first); second.elements[1].value='Alice';
 const script=(snapshot:typeof first)=>{const receipt=result('browser_run',snapshot);Object.assign(value(receipt),{lastBrowserAction:'browser_inspect'});return receipt;};
 const originals=[script(first),script(second),script(second)];
 originals.forEach((receipt,index)=>{if(receipt.role==='tool' && receipt.content[0].type==='tool-result') receipt.content[0].toolCallId='script-'+index;});
 const prepared=withBrowserObservationDiffs(originals);
 assert.equal(rendered(prepared[0]),formatDomSnapshot(first));
 assert.match(rendered(prepared[1]),/Accessibility changes/);
 assert.match(rendered(prepared[1]),/Alice/);
 assert.equal(rendered(prepared[2]),formatDomSnapshot(second));
 assert.deepEqual(withBrowserObservationDiffs(restoreBrowserObservations(prepared,originals)),prepared);
 // Removing the original baseline cannot leave an orphan delta.
 const cut=withBrowserObservationDiffs(restoreBrowserObservations(prepared.slice(1),originals));
 assert.equal(rendered(cut[0]),formatDomSnapshot(second));
});

test('printing the complete inspection does not duplicate the snapshot in model input',()=>{
 const original=result('browser_run',page());
 const full=value(original).snapshot;
 Object.assign(value(original),{lastBrowserAction:'browser_inspect',printed:[{snapshot:full},full,'Keep this selected excerpt']});
 const saved=JSON.stringify(original);
 const prepared=withBrowserObservationDiffs([original])[0];
 assert.equal(value(prepared).snapshot,full);
 assert.deepEqual(value(prepared).printed,[{snapshot:"[Identical to this tool result's snapshot; duplicate omitted.]"},"[Identical to this tool result's snapshot; duplicate omitted.]",'Keep this selected excerpt']);
 assert.equal(JSON.stringify(original),saved);
});

test('older inspections can reuse a visible historical baseline across failures while the latest stays full',()=>{
 const first=page(); const second=structuredClone(first); second.elements[1].value='Alice';
 const script=(snapshot:typeof first,id:string)=>{const receipt=result('browser_run',snapshot);Object.assign(value(receipt),{lastBrowserAction:'browser_inspect'});if(receipt.role==='tool'&&receipt.content[0].type==='tool-result')receipt.content[0].toolCallId=id;return receipt;};
 const failure:ModelMessage={role:'tool',content:[{type:'tool-result',toolName:'browser_run',toolCallId:'failure',output:{type:'json',value:{$toolError:true,error:'Outcome uncertain',completed:['browser_click']}}}]};
 const original=[script(first,'first'),failure,script(second,'older'),failure,script(second,'latest')];
 const prepared=withBrowserObservationDiffs(original);
 assert.equal(rendered(prepared[0]),formatDomSnapshot(first));
 assert.deepEqual(prepared[1],failure);
 assert.match(rendered(prepared[2]),/Accessibility changes/);
 assert.match(rendered(prepared[2]),/Alice/);
 assert.deepEqual(prepared[3],failure);
 assert.equal(rendered(prepared[4]),formatDomSnapshot(second));
 assert.equal(rendered(withBrowserObservationDiffs(original.slice(1))[1]),formatDomSnapshot(second));
 assert.deepEqual(withBrowserObservationDiffs(restoreBrowserObservations(prepared,original)),prepared);
});

test('long link URLs remain exact for execution and can be read on demand without bloating observations',()=>{
 const p=page();const href='https://example.com/product?selection='+encodeURIComponent(JSON.stringify({item:'Dinner',tracking:'x'.repeat(1800)}));
 p.elements[1]={...p.elements[1],role:'link',tag:'a',href,name:'Dinner',settable:false};
 const original=structuredClone(p);
 const formatted=formatDomSnapshot(p);
 assert.match(formatted,/e2 link "Dinner"/);
 assert.match(formatted,/Link destination: https:\/\/example.com/);
 assert.match(formatted,/page.ref\("e2"\)\.getAttribute\("href"\)/);
 assert.ok(!formatted.includes('tracking'));
 assert.deepEqual(p,original);
 assert.equal(resolveBrowserTarget('e2',p),'e2');
 const changed=structuredClone(p);changed.elements[1].href+='&item=other';
 assert.notEqual(formatDomSnapshot(changed),formatted,'A changed destination must remain observable');
 p.elements[1].href='https://example.com/short';
 assert.match(formatDomSnapshot(p),/, URL: https:\/\/example.com\/short/);
});
