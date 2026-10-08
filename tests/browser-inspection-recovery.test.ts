import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectBrowserTarget } from '../lib/harness/tools';
import type { BrowserlessCloudBrowserProvider } from '../lib/harness/browser/cloud';

test('stale inspection returns the full fresh page without preflight or action replay', async () => {
  const calls: string[]=[];
  const page={title:'Loaded checkout',url:'https://example.test',text:'Shipping',elements:[],activeModalCount:0,formatted:'Shipping form'};
  const browser={inspect:async()=>{calls.push('inspect');throw new Error('Browser element e24 is stale; inspect the page again');},snapshot:async()=>{calls.push('snapshot');return page;}} as unknown as BrowserlessCloudBrowserProvider;
  const result=await inspectBrowserTarget(browser,'e24');
  assert.deepEqual(calls,['inspect','snapshot']);
  assert.match(result.formatted,/Shipping form/);
  assert.match(result.formatted,/current full page/);
  assert.equal(result.scopeRef,undefined);
});

test('inspection does not disguise transport failures as stale targets', async () => {
  let snapshots=0;
  const browser={inspect:async()=>{throw new Error('CDP command timed out');},snapshot:async()=>{snapshots++;}} as unknown as BrowserlessCloudBrowserProvider;
  await assert.rejects(inspectBrowserTarget(browser,'e2'),/timed out/);
  assert.equal(snapshots,0);
});
