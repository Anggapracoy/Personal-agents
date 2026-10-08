/** Builds a separate diagnostic template. Does not change production configuration. */
import {Template,waitForFile} from 'e2b';
import {mkdirSync,writeFileSync} from 'node:fs';
const output=process.env.COMPARISON_OUTPUT_DIR;
if(!output||!process.env.E2B_TEMPLATE_ID)throw new Error('Isolated template configuration required');
mkdirSync(output,{recursive:true});
const template=Template().fromTemplate(process.env.E2B_TEMPLATE_ID)
 .setStartCmd('chromium --headless=new --no-sandbox --disable-dev-shm-usage --remote-debugging-address=127.0.0.1 --remote-debugging-port=0 --user-data-dir=/tmp/dash-prewarmed-chromium --no-first-run --no-default-browser-check about:blank',waitForFile('/tmp/dash-prewarmed-chromium/DevToolsActivePort'));
const alias='dash-browser-colocation-eval-'+Date.now();
const built=await Template.build(template,alias,{cpuCount:2,memoryMB:2048});
writeFileSync(output+'/template.json',JSON.stringify({templateId:built.templateId,alias,diagnosticOnly:true},null,2));
console.log(JSON.stringify({templateId:built.templateId,alias,diagnosticOnly:true}));
