import assert from "node:assert/strict";
import test from "node:test";
import { watchConversation } from "../app/conversation-updates";
import type { AgentRunSnapshot } from "../lib/harness/types";

test("an open chat picks up the final message after an opening even without SSE, and recovers offline", async t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  const previousWindow=Object.getOwnPropertyDescriptor(globalThis,"window");
  const previousDocument=Object.getOwnPropertyDescriptor(globalThis,"document");
  const win=new EventTarget(); const doc=Object.assign(new EventTarget(),{hidden:false});
  let stop=()=>{};
  Object.defineProperty(globalThis,"window",{configurable:true,value:win});
  Object.defineProperty(globalThis,"document",{configurable:true,value:doc});
  t.after(()=>{
    stop();
    if(previousWindow) Object.defineProperty(globalThis,"window",previousWindow); else Reflect.deleteProperty(globalThis,"window");
    if(previousDocument) Object.defineProperty(globalThis,"document",previousDocument); else Reflect.deleteProperty(globalThis,"document");
  });
  let stage=0; let offline=false; let requests=0;
  t.mock.method(globalThis,"fetch",async()=>{
    requests++;
    if(offline) throw new Error("offline");
    return {ok:true,json:async()=>({id:"run",status:stage===0?"running":"done",updatedAt:String(stage),threadItems:[{id:"ack",kind:"agent",text:"Checking."},...(stage?[{id:"final",kind:"agent",text:"Here is the answer."}]:[])]})};
  });
  const received:AgentRunSnapshot[]=[];
  stop=watchConversation("run",snapshot=>received.push(snapshot));
  const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  await flush();
  assert.equal(received.at(-1)?.threadItems?.length,1);
  offline=true;stage=1;t.mock.timers.tick(2_000);await flush();
  assert.equal(received.length,1);
  offline=false;t.mock.timers.tick(2_000);await flush();
  assert.equal(received.at(-1)?.threadItems?.length,2,"final arrives while the chat stays open");
  const beforeHidden=requests;doc.hidden=true;t.mock.timers.tick(5_000);await flush();
  assert.equal(requests,beforeHidden);
  doc.hidden=false;doc.dispatchEvent(new Event("visibilitychange"));await flush();
  assert.equal(requests,beforeHidden+1);
  assert.equal(received.length,2,"unchanged replies are not delivered twice");
  stop();win.dispatchEvent(new Event("focus"));t.mock.timers.tick(15_000);await flush();
  assert.equal(requests,beforeHidden+1,"leaving the chat removes its polling and listeners");
});
