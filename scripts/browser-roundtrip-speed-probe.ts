/** Isolated measurement of browser round trips versus renderer and observation reads on a real page. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {CLOUD_BROWSER_CONTROLLER} from '../lib/harness/browser/cloud-controller';
import {getCloudBrowser,closeCloudBrowser} from '../lib/harness/browser/registry';
if(!process.env.COMPARISON_DATABASE_URL||new URL(process.env.COMPARISON_DATABASE_URL).hostname!=='127.0.0.1')throw new Error('Local diagnostic storage required');
process.env.DATABASE_URL=process.env.COMPARISON_DATABASE_URL;
const owner=`roundtrip-speed-${crypto.randomUUID()}@example.invalid`;
const browser=getCloudBrowser(owner,crypto.randomUUID());
const internal=browser as any;
const root=process.env.COMPARISON_OUTPUT_DIR!;mkdirSync(root,{recursive:true});
const branch=String.raw`
        elif operation == "roundtrip_probe":
            value=[]
            for i in range(6):
                for method,params in [("Browser.getVersion",{}),("Runtime.evaluate",{"expression":"1","returnByValue":True}),("Accessibility.getFullAXTree",{}),("DOM.getDocument",{"depth":-1,"pierce":True})]:
                    started=time.perf_counter()
                    result=cdp.command(method,params)
                    value.append({"iteration":i,"method":method,"elapsedMs":(time.perf_counter()-started)*1000,"bytes":len(json.dumps(result))})
`;

try{
 await browser.open(owner,'https://www.ikea.com/us/en/p/lagkapten-adils-desk-white-s29416758/');
 await browser.wait(1500);
 await internal.account.sandbox.files.write(internal.controllerPath,CLOUD_BROWSER_CONTROLLER.replace('        elif operation == "describe":',branch+'\n        elif operation == "describe":'));
 const rows=await internal.run('roundtrip_probe',{});
 writeFileSync(`${root}/results.json`,JSON.stringify(rows,null,2));
 for(const row of rows)console.log(JSON.stringify(row));
}finally{await closeCloudBrowser(owner);writeFileSync(`${root}/cleanup.json`,JSON.stringify({closed:true}))}
process.exit(0);
