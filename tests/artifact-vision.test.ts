import assert from 'node:assert/strict';
import test from 'node:test';
import { generateText, type ModelMessage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { MemoryRunStore } from '../lib/harness/store';
import { inspectedImage, withArtifactVision, withoutArtifactVision } from '../lib/harness/artifact-vision';
import { withBrowserVision } from '../lib/harness/browser/vision';
const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const receipt=(id:string):ModelMessage=>({role:'tool',content:[{type:'tool-result',toolName:'inspect_artifact',toolCallId:'inspect',output:{type:'json',value:{artifactId:id}}}]});

test('artifact inspection supplies actual pixels through the production provider adapter',async()=>{
 const store=new MemoryRunStore();
 const artifact=await store.createArtifact({runId:'artifact-test',actionId:null,name:'output.png',mimeType:'image/png',bytesBase64:pixel});
 const messages:ModelMessage[]=[{role:'user',content:'Check the image'},{role:'assistant',content:[{type:'tool-call',toolName:'inspect_artifact',toolCallId:'inspect',input:{artifactId:artifact.id}}]},receipt(artifact.id)];
 const prepared=await withArtifactVision(await withBrowserVision(messages,store,'artifact-test'),store,'artifact-test');
 assert.equal(prepared.length,4);
 assert.deepEqual(await withArtifactVision(prepared,store,'artifact-test'),prepared);
 assert.deepEqual(withoutArtifactVision(prepared),messages);
 let captured:Record<string,unknown>={};
 const provider=createOpenAICompatible({name:'meta',baseURL:'https://example.invalid/v1',apiKey:'test',fetch:async(_url,init)=>{
  captured=JSON.parse(String(init?.body));
  return new Response(JSON.stringify({id:'test',object:'chat.completion',created:1,model:'muse-spark-1.3',choices:[{index:0,message:{role:'assistant',content:'Seen'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}),{headers:{'content-type':'application/json'}});
 }});
 await generateText({model:provider('muse-spark-1.3'),messages:prepared});
 const outgoing=captured.messages as Array<{role:string;content:unknown}>;
 assert.deepEqual((outgoing.at(-1)!.content as unknown[])[2],{type:'image_url',image_url:{url:`data:image/png;base64,${pixel}`}});
 assert.ok(!JSON.stringify(outgoing.filter(m=>m.role==='tool')).includes(pixel));
 assert.equal((await withArtifactVision([...prepared,{role:'user',content:'New request'}],store,'artifact-test')).length,4);
 const newer:ModelMessage={role:'tool',content:[{type:'tool-result',toolName:'sandbox_run',toolCallId:'new',output:{type:'json',value:{}}}]};
 assert.equal((await withArtifactVision([...prepared,newer],store,'artifact-test')).length,4);
});

test('inspection enforces ownership, formats, missing files and size',async()=>{
 const store=new MemoryRunStore();
 const save=(mimeType:string,bytesBase64=pixel)=>store.createArtifact({runId:'owner',actionId:null,name:'file',mimeType,bytesBase64});
 const image=await save('image/png');
 await assert.rejects(inspectedImage(store,'other',image.id),/not found/);
 await assert.rejects(inspectedImage(store,'owner','missing'),/not found/);
 await assert.rejects(inspectedImage(store,'owner',(await save('application/pdf')).id),/Render other formats/);
 await assert.rejects(inspectedImage(store,'owner',(await save('image/png',Buffer.alloc(20*1024*1024+1).toString('base64'))).id),/limit/);
 const result=await withArtifactVision([receipt(image.id)],store,'other');
 assert.match(JSON.stringify(result),/could not be loaded/);
 assert.ok(!JSON.stringify(result).includes(pixel));
});
