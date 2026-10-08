/** Isolated measurement of equivalent native DOM-ref reads on a real page. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {CLOUD_BROWSER_CONTROLLER} from '../lib/harness/browser/cloud-controller';
import {getCloudBrowser,closeCloudBrowser} from '../lib/harness/browser/registry';
if(!process.env.COMPARISON_DATABASE_URL||new URL(process.env.COMPARISON_DATABASE_URL).hostname!=='127.0.0.1')throw new Error('Local diagnostic storage required');
process.env.DATABASE_URL=process.env.COMPARISON_DATABASE_URL;
const owner=`dom-speed-${crypto.randomUUID()}@example.invalid`;
const browser=getCloudBrowser(owner,crypto.randomUUID());
const internal=browser as any;
const root=process.env.COMPARISON_OUTPUT_DIR!;mkdirSync(root,{recursive:true});
const branch=String.raw`
        elif operation == "dom_read_probe":
            value = []
            for method in ["DOMSnapshot.captureSnapshot","DOM.getDocument"] * 3:
                started = time.perf_counter()
                result = cdp.command(method, {"computedStyles":[]} if method.startswith("DOMSnapshot") else {"depth":-1,"pierce":True})
                elapsed = time.perf_counter() - started
                refs = {}
                if method.startswith("DOMSnapshot"):
                    strings = result["strings"]
                    for document in result["documents"]:
                        tree = document["nodes"]
                        for backend, attributes in zip(tree["backendNodeId"],tree["attributes"]):
                            for i in range(0,len(attributes),2):
                                if strings[attributes[i]] == "data-decision-feed-ref": refs[str(backend)] = strings[attributes[i+1]]
                else:
                    def visit(node):
                        attributes = node.get("attributes",[])
                        for i in range(0,len(attributes),2):
                            if attributes[i] == "data-decision-feed-ref": refs[str(node["backendNodeId"])] = attributes[i+1]
                        for child in node.get("children",[]) + node.get("shadowRoots",[]) + node.get("pseudoElements",[]): visit(child)
                        for key in ("contentDocument","templateContent"):
                            if node.get(key): visit(node[key])
                    visit(result["root"])
                value.append({"method":method,"elapsedMs":elapsed*1000,"bytes":len(json.dumps(result)),"refs":refs})
`;
try{
 await browser.open(owner,'https://www.ikea.com/us/en/p/lagkapten-adils-desk-white-s29416758/');
 await browser.wait(1500);
 await internal.account.sandbox.files.write(internal.controllerPath,CLOUD_BROWSER_CONTROLLER.replace('        elif operation == "describe":',branch+'\n        elif operation == "describe":'));
 const rows=await internal.run('dom_read_probe',{});
 writeFileSync(`${root}/results.json`,JSON.stringify(rows,null,2));
 for(const row of rows)console.log(JSON.stringify({...row,refs:Object.keys(row.refs).length}));
}finally{await closeCloudBrowser(owner);writeFileSync(`${root}/cleanup.json`,JSON.stringify({closed:true}))}
process.exit(0);
