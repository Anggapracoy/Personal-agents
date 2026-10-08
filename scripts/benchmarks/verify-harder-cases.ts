import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {harderCases} from './harder-cases';
const browser=await chromium.launch({headless:true});
try{
 for(const test of harderCases.filter(c=>c.browser)){
  const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(10000);page.on("pageerror",e=>console.log("PAGE ERROR",test.id,e.message));
  await context.route('**/*',route=>{const html=test.browser!.html(route.request().url());return html?route.fulfill({contentType:'text/html; charset=utf-8',body:html}):route.abort()});
  await page.goto(test.browser!.url);
  if(test.id==='browser-stock-recovery'){
   async function add(id:string,sku:string){await page.goto(test.browser!.url+'product/'+id);await page.getByLabel('Configuration').selectOption(sku);await page.getByLabel('Quantity').fill('2');await page.getByRole('button',{name:'Add to cart',exact:true}).click()}
   async function checkout(){await page.goto(test.browser!.url+'checkout');for(const [label,value] of Object.entries({'Full name':'Alex Benchmark',Email:'dash.benchmark@example.invalid',Street:'100 Queen Street West',City:'Toronto',Province:'Ontario','Postal code':'M5H 2N2',Coupon:'SAVE10'}))await page.getByLabel(label,{exact:true}).fill(value);await page.getByLabel('Shipping').selectOption('express');await page.getByRole('button',{name:'Review quote'}).click();await page.waitForURL('**/review')}
   await add('swift','swift32');await add('dockpro','dockpro');await checkout();assert.match(await page.locator('main').innerText(),/zero stock/);assert.equal(await page.evaluate(()=>sessionStorage.getItem('review')),null);
   await page.goto(test.browser!.url+'cart');await page.getByRole('button',{name:'Remove swift32'}).click();await add('nova','nova32');await checkout();
   const state=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('review')!));assert.equal(state.totalCents,273596);assert.equal(state.cart.length,2);assert.ok(state.cart.some((x:any)=>x.sku==='nova32'));
  }else if(test.id==='browser-support-drafts'){
   for(const [id,status,priority,tag,refund,note]of [['T-81','Closed','Normal','resolved','0','CAD 20 settled refund'],['T-82','Open','High','damage-review','4500','Pending refund review']]){
    await page.getByRole('article',{name:'Ticket '+id}).getByRole('button',{name:'Edit'}).click();const d=page.getByRole('dialog');await d.getByLabel('Status').selectOption(status);await d.getByLabel('Priority').selectOption(priority);await d.getByLabel('Tag').fill(tag);await d.getByLabel('Proposed refund cents').fill(refund);await d.getByLabel('Internal note').fill(note);await d.getByRole('button',{name:'Save',exact:true}).click();if(id==='T-81'){assert.equal(await page.evaluate(()=>sessionStorage.getItem('tickets')),null);await d.getByRole('button',{name:'Save',exact:true}).click()}
   }
   const state=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('tickets')!));assert.equal(state[0].status,'Closed');assert.equal(state[1].refundCents,4500);assert.equal(state[2].status,'Open');assert.equal(await page.evaluate(()=>sessionStorage.getItem('sent')),null);
  }else{
   await page.locator('#train').selectOption(String(test.expected.train));await page.getByLabel('Hotel').selectOption(String(test.expected.hotel));await page.getByLabel('Passenger').fill('Jordan Example');await page.getByLabel('Email').fill('jordan@example.invalid');await page.getByLabel('Travel insurance CAD 25').uncheck();await page.getByRole('button',{name:'Save draft'}).click();assert.equal(await page.evaluate(()=>sessionStorage.getItem('trip')),null);await page.getByLabel('Hotel').selectOption(String(test.expected.hotel));await page.getByRole('button',{name:'Save draft'}).click();await page.waitForURL('**/review');const state=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('trip')!));assert.equal(state.totalCents,test.expected.totalCents);assert.equal(state.insurance,false);
  }
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('submitted')),null);await context.close();console.log('PASS',test.id);
 }
 console.log('ORACLES',JSON.stringify(harderCases.filter(c=>!c.browser).map(c=>({id:c.id,expected:c.expected}))));
}finally{await browser.close()}
