import test from 'node:test';
import assert from 'node:assert/strict';
import {postNativeMessage} from '../app/native-bridge';

test('visual packets batch in order, preserving navigation ownership phases and request boundaries',async()=>{
 const previous=globalThis.window;
 const sent:any[]=[];
 const events=new EventTarget();
 globalThis.window={__decisionFeedNativeChromeBatch:true,dispatchEvent:events.dispatchEvent.bind(events),webkit:{messageHandlers:{decisionFeedNative:{postMessage:(message:unknown)=>sent.push(message)}}}} as unknown as Window&typeof globalThis;
 try{
  postNativeMessage({version:1,action:'navigationFrame',payload:{phase:'begin'}});
  postNativeMessage({version:1,action:'composerState',payload:{id:'next'}});
  postNativeMessage({version:1,action:'navigationFrame',payload:{phase:'frame',incoming:40}});
  assert.equal(sent.length,0);
  await Promise.resolve();
  assert.equal(sent.length,1);
  assert.deepEqual(sent[0].payload.messages.map((m:any)=>m.action),['navigationFrame','composerState','navigationFrame']);
  assert.equal(sent[0].payload.messages[0].payload.phase,'begin');
  postNativeMessage({version:1,action:'composerHide',payload:{id:'next'}});
  postNativeMessage({version:1,action:'requestCalendarAccess',payload:{}});
  assert.deepEqual(sent.slice(1).map(m=>m.action),['chromeBatch','requestCalendarAccess']);
  await Promise.resolve();assert.equal(sent.length,3);
  let resampled=0;events.addEventListener('decisionFeed:sheetLayout',()=>resampled++);
  postNativeMessage({version:1,action:'modalOverlayVisibility',payload:{visible:true}});
  assert.equal(resampled,1);
  await Promise.resolve();assert.equal(sent.at(-1).action,'chromeBatch');
 }finally{globalThis.window=previous;}
});

test('older shells retain individual packets and separate native bridge instances cannot mix batches',async()=>{
 const previous=globalThis.window;const first:any[]=[];const second:any[]=[];
 const bridge=(output:any[],batch:boolean)=>({__decisionFeedNativeChromeBatch:batch,webkit:{messageHandlers:{decisionFeedNative:{postMessage:(message:any)=>output.push(message)}}}}) as unknown as Window&typeof globalThis;
 try{
  globalThis.window=bridge(first,false);
  postNativeMessage({version:1,action:'sheetCoverage',payload:{x:1}});
  assert.equal(first[0].action,'sheetCoverage');
  globalThis.window=bridge(first,true);postNativeMessage({version:1,action:'homeHeaderState',payload:{id:'first'}});
  globalThis.window=bridge(second,true);postNativeMessage({version:1,action:'homeHeaderState',payload:{id:'second'}});
  await Promise.resolve();
  assert.equal(first.at(-1).payload.messages[0].payload.id,'first');
  assert.equal(second[0].payload.messages[0].payload.id,'second');
 }finally{globalThis.window=previous;}
});
