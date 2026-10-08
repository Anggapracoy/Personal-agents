import assert from 'node:assert/strict';
import { localBrowser } from './local-browser';
const user='role-regression@example.invalid';
const browser=await localBrowser(user,crypto.randomUUID(),{url:'https://number-field.example/',html:url=>new URL(url).hostname==='number-field.example'?'<label>Quantity<input type="number" value="1"></label><label>Note<input type="text"></label><label>Explicit<input type="number" role="textbox"></label>':null});
try {
 await browser.provider.open(user,'https://number-field.example/');
 const numeric=await browser.provider.extended({action:'query',locator:{role:'spinbutton',name:'Quantity',exact:true}}) as {matches:Array<{ref:string}>};
 const wrong=await browser.provider.extended({action:'query',locator:{role:'textbox',name:'Quantity',exact:true}}) as {matches:unknown[]};
 const note=await browser.provider.extended({action:'query',locator:{role:'textbox',name:'Note',exact:true}}) as {matches:unknown[]};
 const explicit=await browser.provider.extended({action:'query',locator:{role:'textbox',name:'Explicit',exact:true}}) as {matches:unknown[]};
 if(process.env.BROWSER_NUMBER_ROLE_BASELINE==='1') {assert.equal(numeric.matches.length,0);assert.equal(wrong.matches.length,1);console.log('PRE-FIX BUG REPRODUCED: snapshot spinbutton does not resolve by role');}
 else {assert.equal(numeric.matches.length,1);assert.equal(wrong.matches.length,0);assert.equal(note.matches.length,1);assert.equal(explicit.matches.length,1);await browser.provider.type(numeric.matches[0].ref,'2');assert.equal(await browser.page.getByLabel('Quantity').inputValue(),'2');console.log('FIX VERIFIED: spinbutton resolves and fills; textbox and explicit roles preserved');}
} finally {await browser.close()}
