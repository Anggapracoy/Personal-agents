import test from 'node:test';
import assert from 'node:assert/strict';
import { streamText, stepCountIs, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { restoreBrowserObservations, withBrowserObservationDiffs } from '../lib/harness/browser/observation-diff.ts';

// Exercise the real SDK's prepared-message carry-forward, not just a one-pass diff.
test('browser deltas survive actual SDK multi-step input preparation', async () => {
  const snapshot = value => 'Browser: Form, URL: https://example.com/\n\nn1 RootWebArea "Form"\n' +
    Array.from({length:20},(_,i)=>`  e${i+1} textbox "Field ${i+1}"${i===0 ? `, Value: ${value}` : ''}`).join('\n') +
    '\n\nThe focused UI element is e1';
  let calls=0;
  const model=new MockLanguageModelV4({doStream:async()=>({stream:new ReadableStream({start(controller){
    calls++;
    if(calls<=3) controller.enqueue({type:'tool-call',toolCallId:`call-${calls}`,toolName:'browser_type',input:'{}'});
    controller.enqueue({type:'finish',finishReason:{unified:calls<=3?'tool-calls':'stop',raw:'stop'},usage:{inputTokens:{total:1},outputTokens:{total:1}}});
    controller.close();
  }})})});
  const run=streamText({model,prompt:'Fill the form',stopWhen:stepCountIs(4),
    tools:{browser_type:tool({inputSchema:z.object({}),execute:async()=>({url:'https://example.com/',snapshot:snapshot(calls),browserSnapshotContext:{version:1,documentId:'one',scopeRef:null,complete:true}})})},
    prepareStep:({messages,initialMessages,responseMessages})=>({messages:withBrowserObservationDiffs(restoreBrowserObservations(messages,[...initialMessages,...responseMessages]))}),
  });
  await run.consumeStream();
  assert.equal(model.doStreamCalls.length,4);
  const prompt=JSON.stringify(model.doStreamCalls[3].prompt);
  assert.equal((prompt.match(/Accessibility changes/g)||[]).length,2);
  assert.doesNotMatch(prompt,/browserSnapshotContext/);
  const steps=await run.steps;
  assert.ok(steps[0].response.messages.some(m=>JSON.stringify(m).includes('browserSnapshotContext')),'original runtime receipts remain intact');
});
