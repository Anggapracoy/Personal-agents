import { readFileSync, existsSync } from 'node:fs';
import { BrowserlessCloudBrowserProvider, createCloudBrowserAccountState } from '../lib/harness/browser/cloud';
import { CLOUD_BROWSER_CONTROLLER } from '../lib/harness/browser/cloud-controller';
for (const line of existsSync('.env.local') ? readFileSync('.env.local','utf8').split('\n') : []) {
 const match=line.match(/^([A-Z_0-9]+)=(.*)$/);if(match && !process.env[match[1]])process.env[match[1]]=match[2].replace(/^['"]|['"]$/g,'');
}
const account=createCloudBrowserAccountState();
const targetKey='browser-parity-'+crypto.randomUUID();
const browser=new BrowserlessCloudBrowserProvider(targetKey,account,targetKey);
try {
 await browser.open(targetKey,'https://example.com');
 const sandbox=account.sandbox!;
 const body=readFileSync(new URL('./fixtures/browserless-controls.py',import.meta.url),'utf8');
 const path='/home/user/.decision-feed/browser-parity-smoke.py';
 await sandbox.files.write(path,`controller=${JSON.stringify(CLOUD_BROWSER_CONTROLLER)}\ncontroller_path=${JSON.stringify((browser as unknown as {controllerPath:string}).controllerPath)}\ntarget_key=${JSON.stringify(targetKey)}\n`+body);
 const result=await sandbox.commands.run(`python3 ${path}`,{timeoutMs:180000,envs:{BROWSERLESS_API_TOKEN:process.env.BROWSERLESS_API_TOKEN!,BROWSERLESS_HOST:process.env.BROWSERLESS_HOST||'production-sfo.browserless.io',BROWSERLESS_PROFILE:`dash-dev-${account.userHash}`}});
 console.log(result.stdout);if(result.stderr)console.error(result.stderr);if(result.exitCode)throw Error('Browserless control fixture failed');
} finally {await browser.destroy(); console.log("CLEANUP_COMPLETE")}
process.exit(0);
