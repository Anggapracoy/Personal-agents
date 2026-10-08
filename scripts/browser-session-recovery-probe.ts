/** Isolated fault injection: close a CDP socket, never the browser/tab. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {CLOUD_BROWSER_CONTROLLER} from '../lib/harness/browser/cloud-controller';
import {getCloudBrowser,closeCloudBrowser} from '../lib/harness/browser/registry';
if(!process.env.COMPARISON_DATABASE_URL || new URL(process.env.COMPARISON_DATABASE_URL).hostname!=='127.0.0.1')throw new Error('Isolated local storage required');
process.env.DATABASE_URL=process.env.COMPARISON_DATABASE_URL;
const output=process.env.COMPARISON_OUTPUT_DIR!;assert.ok(output);mkdirSync(output,{recursive:true});
const owner=`connection-probe-${crypto.randomUUID()}@example.invalid`;
const browser=getCloudBrowser(owner,crypto.randomUUID());
const internal=browser as any;
const fault=String.raw`
                                if operation == "probe_close_socket":
                                    connection.sock.close()
                                    value = True
                                elif operation == "command":`;
const probe=String.raw`
        elif operation == "connection_recovery_probe":
            before_generation = BROWSER_STATE["generation"]
            before_targets = sorted(t["id"] for t in json_request("/json/list"))
            cdp_pool_exchange({"operation":"probe_close_socket", "key":BROWSER_CONNECTION.key})
            started = time.perf_counter()
            connect_browser({"operation":"snapshot"})
            value = {"elapsedMs":(time.perf_counter()-started)*1000,
                     "sameGeneration":BROWSER_STATE["generation"]==before_generation,
                     "sameTargets":sorted(t["id"] for t in json_request("/json/list"))==before_targets,
                     "url":evaluate(cdp,"location.href")}
`;
try{
 await browser.warm(owner,true);
 const controller=CLOUD_BROWSER_CONTROLLER.replace('                                if operation == "command":',fault).replace('        elif operation == "describe":',probe+'\n        elif operation == "describe":');
 assert.notEqual(controller,CLOUD_BROWSER_CONTROLLER);
 await internal.account.sandbox.files.write(internal.controllerPath,controller);
 await browser.open(owner,'https://example.com/');
 const rows=[];
 for(let i=0;i<3;i++){
  const result=await internal.run('connection_recovery_probe',{});
  assert.equal(result.sameGeneration,true);assert.equal(result.sameTargets,true);assert.equal(result.url,'https://example.com/');
  rows.push(result);console.log(JSON.stringify(result));
 }
 writeFileSync(`${output}/results.json`,JSON.stringify(rows,null,2));
}finally{
 await closeCloudBrowser(owner);
 writeFileSync(`${output}/cleanup.json`,JSON.stringify({closed:true}));
}
process.exit(0);
