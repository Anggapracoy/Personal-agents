import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Sandbox } from '@e2b/code-interpreter';
import { getCloudBrowser, closeCloudBrowser } from '../lib/harness/browser/registry';
import { resolveBrowserTarget } from '../lib/harness/browser/policy';

const root='artifacts/browser-large-page';
mkdirSync(root,{recursive:true});
const owner=`large-page-${crypto.randomUUID()}@example.invalid`;
const fixture=await Sandbox.create({timeoutMs:10*60_000});
const browser=getCloudBrowser(owner);
try {
 await fixture.files.write('/home/user/index.html',`<!doctype html><title>Busy shop</title><style>iframe{position:fixed;top:10px;right:10px;width:360px;height:220px;background:white;z-index:5}</style><h1>Busy shop</h1>${Array.from({length:650},(_,i)=>`<button onclick="document.getElementById('result').textContent='Selected product ${i}'">Product ${i}</button>`).join('')}<p id="result"></p><iframe title="Size guide" src="/size.html"></iframe>`);
 await fixture.files.write('/home/user/size.html',`<!doctype html><title>Size guide</title><h1>Size guide</h1><button role="tab" onclick="document.querySelector('p').textContent='Product Size M: 22 inches garment width'">Product Size</button><button role="tab">Body Size</button><p>Body Size M: 38 inches chest</p>`);
 await fixture.commands.run('python3 -m http.server 8000 --directory /home/user',{background:true,timeoutMs:0});
 let page=await browser.open(owner,`https://${fixture.getHost(8000)}/index.html`);
 page=await browser.waitFor({role:'tab',name:'Product Size'},'visible',5000);
 assert.ok(page.elements.length>=652,`Only ${page.elements.length} controls exposed`);
 assert.match(page.text,/Body Size M: 38 inches chest/);
 const last=resolveBrowserTarget({role:'button',name:'Product 649'},page);
 page=await browser.click(last);
 assert.match(page.text,/Selected product 649/);
 page=await browser.click(resolveBrowserTarget({role:'tab',name:'Product Size'},page));
 assert.match(page.text,/Product Size M: 22 inches garment width/);
 writeFileSync(`${root}/snapshot.json`,JSON.stringify(page,null,2));
 writeFileSync(`${root}/page.png`,await browser.screenshot());
 const result={passed:true,controls:page.elements.length,checks:['all 650 parent controls exposed','last parent control clickable','child frame accessible text retained','child frame Product Size tab clickable']};
 writeFileSync(`${root}/checks.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {await closeCloudBrowser(owner);await fixture.kill();}
