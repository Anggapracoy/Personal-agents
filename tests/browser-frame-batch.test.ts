import assert from 'node:assert/strict';
import test from 'node:test';
import { browserFrameForResult, withBrowserFrameBatch } from '../lib/harness/browser/frame-batch';
const frame={id:'final',name:'frame.png',mimeType:'image/png'};

test('a script captures only its final automatic frame without deferring page observations',async()=>{
 const captured:string[]=[];
 const result=await withBrowserFrameBatch(async()=>{
  for(const snapshot of ['before','after']){
   const value=await browserFrameForResult({snapshot,url:'https://example.com',capture:async()=>{captured.push(snapshot);return frame;}});
   assert.equal(value,null); assert.deepEqual(captured,[]);
  }
  return {snapshot:'after',url:'https://example.com',lastBrowserAction:'browser_inspect'};
 });
 assert.deepEqual(captured,['after']); assert.deepEqual(result.browserFrame,frame);
});

test('failed scripts, explicit images and non-observation results never acquire a stale frame',async()=>{
 for(const result of [{$toolError:true},{lastBrowserAction:'browser_screenshot',artifact:frame},{matches:[]}]){
  await withBrowserFrameBatch(async()=>{
   await browserFrameForResult({snapshot:'earlier',url:'https://example.com',capture:async()=>{throw Error('stale frame captured');}});
   return result;
  });
 }
});

test('separate executions retain their own frame and ordinary tools capture immediately',async()=>{
 const results=await Promise.all(['a','b'].map(snapshot=>withBrowserFrameBatch(async()=>{
  await browserFrameForResult({snapshot,url:snapshot,capture:async()=>({...frame,id:snapshot})});
  await new Promise(resolve=>setTimeout(resolve,5));
  return {snapshot,url:snapshot};
 })));
 assert.deepEqual(results.map(r=>(r.browserFrame as typeof frame).id),['a','b']);
 assert.deepEqual(await browserFrameForResult({snapshot:'c',url:'c',capture:async()=>frame}),frame);
});

test('viewer capture overlaps inference but is drained before leaving the execution scope',async()=>{
 const {withBackgroundBrowserFrames}=await import('../lib/harness/browser/frame-batch');
 let finish!:()=>void;let started=false;let scopeFinished=false;
 const gate=new Promise<void>(resolve=>{finish=resolve;});
 const work=withBackgroundBrowserFrames(async()=>{
  const result=await withBrowserFrameBatch(async()=>{
   await browserFrameForResult({snapshot:'page',url:'url',capture:async()=>{started=true;await gate;return frame;}});
   return {snapshot:'page',url:'url',lastBrowserAction:'browser_inspect'};
  });
  assert.equal(started,true);assert.equal(result.browserFrame,null);
  return 'model finished';
 }).then(result=>{scopeFinished=true;return result;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(started,true);assert.equal(scopeFinished,false);
 finish();assert.equal(await work,'model finished');assert.equal(scopeFinished,true);
});

test('failed capture cannot fail the run and run failure still drains outstanding captures',async()=>{
 const {withBackgroundBrowserFrames}=await import('../lib/harness/browser/frame-batch');
 let captured=false;
 await assert.rejects(withBackgroundBrowserFrames(async()=>{
  await browserFrameForResult({snapshot:'page',url:'url',capture:async()=>{await new Promise(resolve=>setImmediate(resolve));captured=true;throw Error('capture failed');}});
  throw Error('original run error');
 }),/original run error/);
 assert.equal(captured,true);
});
