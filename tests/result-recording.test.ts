import test from "node:test";
import assert from "node:assert/strict";
import { recordAgentResult } from "../lib/harness/model";
import { MemoryRunStore } from "../lib/harness/store";
import type { AgentResult } from "../lib/harness/types";

for (const outcome of ["no_action", "needs_user", "completed"] as const) {
  test(`an originally approved task accepts the current ${outcome} result without tool-count gates`, async () => {
    const store = new MemoryRunStore();
    const run = await store.createRun({ userId: "test", decisionId: null, category: "money", title: "Dispute", request: "Handle the dispute", metadata: { actionType: "approval" } });
    const result = {
      outcome, summary: "The deadline is Friday.", details: "The deadline is Friday.",
      verified: true, externalChange: outcome === "completed", options: [], followUpActions: [],
      facts: [], links: [], moneySaved: null, recommendedNextStep: null,
    } satisfies AgentResult;
    assert.equal((await recordAgentResult(store, run.id, result)).accepted, true);
    assert.deepEqual((await store.getRun(run.id))?.result, result);
  });
}

test('blocks-only completion preserves rendered result and rejects empty sanitized blocks', async () => {
 const store=new MemoryRunStore();const run=await store.createRun({userId:'test',decisionId:null,category:'travel',title:'Plan',request:'Plan',metadata:{}});
 const base={outcome:'completed' as const,summary:'Trip plan',details:'Trip plan',verified:true,externalChange:false,options:[],followUpActions:[],facts:[],links:[],moneySaved:null,recommendedNextStep:null};
 const blocks=[{type:'text' as const,style:'paragraph' as const,text:'Spend the morning in Old Montreal.'}];
 const recorded=await recordAgentResult(store,run.id,{...base,blocks,blocksOnly:true});
 assert.equal(recorded.accepted,true);assert.equal(recorded.blocksOnly,true);
 assert.deepEqual((await store.getRun(run.id))?.result?.blocks,blocks);
 assert.notEqual((await store.getRun(run.id))?.metadata.responseDisposition,'silent');
 const rejected=await recordAgentResult(store,run.id,{...base,blocks:[],blocksOnly:true});
 assert.equal(rejected.accepted,false);
 assert.deepEqual((await store.getRun(run.id))?.result?.blocks,blocks);
});

test('blocks-only history retains blocks without manufacturing a summary bubble', async () => {
 const {historyThreadItems}=await import('../app/history-thread');
 const items=historyThreadItems({id:'h',subtitle:'Plan my trip',chosenOption:'Plan',outcome:'Duplicate summary',result:{blocksOnly:true,blocks:[{type:'text',style:'paragraph',text:'Visit Old Montreal.'}]}} as any);
 assert.equal(items.some(item=>item.kind==='agent'&&item.text==='Duplicate summary'),false);
 assert.equal(items.some(item=>item.kind==='blocks'),true);
});
