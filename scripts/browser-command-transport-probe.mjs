/** Diagnostic only: fixed public-page JSON, no browser or command-execution HTTP endpoint. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {Sandbox} from 'e2b';
const output=process.env.COMPARISON_OUTPUT_DIR;
assert.ok(output);mkdirSync(output,{recursive:true});
const messages=JSON.parse(readFileSync('/tmp/dash-ikea-ref-batch-full-live/messages.json','utf8'));
const snapshots=messages.flatMap(m=>Array.isArray(m.message.content)?m.message.content:[]).filter(c=>c.type==='tool-result').map(c=>c.output?.value?.snapshot).filter(s=>typeof s==='string');
const snapshot=snapshots.sort((a,b)=>b.length-a.length)[0];assert.ok(snapshot);
const payload=JSON.stringify({ok:true,snapshot});
const capability=randomBytes(32).toString('hex');
const sandbox=await Sandbox.create({timeoutMs:120000,metadata:{purpose:'fixed-response-transport-probe'}});
const rows=[];
try {
 await sandbox.files.write('/home/user/probe-response.json',payload);
 await sandbox.files.write('/home/user/probe-server.py',String.raw`
import gzip,hmac,os
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
raw=open('/home/user/probe-response.json','rb').read()
compressed=gzip.compress(raw,mtime=0)
capability='Bearer '+os.environ['PROBE_CAPABILITY']
class Handler(BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path!='/' or not hmac.compare_digest(self.headers.get('Authorization',''),capability):
   self.send_response(401);self.send_header('Content-Length','0');self.end_headers();return
  use_gzip='gzip' in self.headers.get('Accept-Encoding','')
  body=compressed if use_gzip else raw
  self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)))
  if use_gzip:self.send_header('Content-Encoding','gzip')
  self.end_headers();self.wfile.write(body)
ThreadingHTTPServer(('0.0.0.0',3434),Handler).serve_forever()
`);
 await sandbox.commands.run('python3 /home/user/probe-server.py',{background:true,envs:{PROBE_CAPABILITY:capability}});
 const url=`https://${sandbox.getHost(3434)}/`;
 let ready=false;
 for(let i=0;i<10;i++){
  const response=await fetch(url,{signal:AbortSignal.timeout(3000)});
  await response.arrayBuffer();
  if(response.status===401){ready=true;break;}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(ready,'Fixed-response server not ready');
 for(const arm of ['command','http','http','command','command','http','http','command','command','http','http','command']){
  const start=performance.now();
  const text=arm==='command'
   ?(await sandbox.commands.run('python3 -c "import sys;sys.stdout.write(open(\'/home/user/probe-response.json\').read())"',{timeoutMs:10000})).stdout
   :await (async()=>{const r=await fetch(url,{headers:{Authorization:`Bearer ${capability}`},signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);return r.text();})();
  const elapsedMs=performance.now()-start;
  assert.equal(text,payload);rows.push({arm,elapsedMs});
 }
 const summary={bytes:Buffer.byteLength(payload),rows,...Object.fromEntries(['command','http'].map(arm=>{const values=rows.filter(r=>r.arm===arm).map(r=>r.elapsedMs);return [arm,{meanMs:values.reduce((a,b)=>a+b,0)/values.length,minMs:Math.min(...values)}]}))};
 writeFileSync(`${output}/results.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
} finally {
 const killed=await sandbox.kill();assert.equal(killed,true);
 writeFileSync(`${output}/cleanup.json`,JSON.stringify({sandboxKilled:true}));
}
