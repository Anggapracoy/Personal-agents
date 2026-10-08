import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { getCloudBrowser, closeCloudBrowser } from "../lib/harness/browser/registry";
import { resolveBrowserTarget, browserApprovalBackstop } from "../lib/harness/browser/policy";
const owner=`browser-parity-${crypto.randomUUID()}@example.invalid`;
const browser=getCloudBrowser(owner);
const root="artifacts/browser-parity";
mkdirSync(root,{recursive:true});
try {
 let page=await browser.open(owner,"https://www.ikea.com/us/en/p/lagkapten-adils-desk-white-s29416758/");
 for(let i=0;i<5&&!page.text.includes("59.99");i++)page=await browser.wait(1500);
 writeFileSync(`${root}/ikea-before.json`,JSON.stringify(page,null,2));
 assert.match(page.text,/59\.99/);
 const ok=page.elements.find(e=>/^ok$/i.test(e.name));
 if(ok) {
  assert.equal(browserApprovalBackstop(await browser.describeRef(ok.ref)),null);
  page=await browser.click(ok.ref);
 }
 const stableBefore = page.elements.find(e=>e.role==="tab"&&e.name==="Measurements")?.ref;
 page=await browser.snapshot();
 assert.equal(page.elements.find(e=>e.role==="tab"&&e.name==="Measurements")?.ref,stableBefore);
 const measurements=resolveBrowserTarget({role:"tab",name:"Measurements"},page);
 assert.equal(browserApprovalBackstop(await browser.describeRef(measurements)),null);
 page=await browser.click(measurements);
 assert.match(page.text,/Measurements/);
 assert.match(page.text,/47 1\/4/);
 writeFileSync(`${root}/ikea-measurements.json`,JSON.stringify(page,null,2));
 writeFileSync(`${root}/ikea.png`,await browser.screenshot());
 console.log("PASS IKEA price and Measurements");
 page=await browser.navigate("https://support.mozilla.org/en-US/kb/firefox-users-windows-7-8-and-81-moving-extended-support");
 for(let i=0;i<5&&!page.elements.some(e=>e.role==='searchbox');i++)page=await browser.wait(1500);
 const search=page.elements.find(e=>e.role==='searchbox'||/Search questions/.test(e.name));
 assert.ok(search);
 page=await browser.type(search.ref,"Firefox macOS 10.14 ESR support");
 const submit=resolveBrowserTarget({role:"button",name:"Search"},page);
 assert.equal(browserApprovalBackstop(await browser.describeRef(submit)),null);
 page=await browser.click(submit);
 for(let i=0;i<5&&!page.text.includes("Found");i++)page=await browser.wait(1000);
 assert.match(page.text,/Firefox users on macOS 10.12, 10.13 and 10.14/);
 writeFileSync(`${root}/mozilla-search.json`,JSON.stringify(page,null,2));
 writeFileSync(`${root}/mozilla.png`,await browser.screenshot());
 console.log("PASS Mozilla search");
} finally {await closeCloudBrowser(owner);}
