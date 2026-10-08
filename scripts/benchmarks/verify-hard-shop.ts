import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { shopProducts, shopExpected, shopHtml } from './hard-shop';
const candidates=[];
for(const laptop of shopProducts.filter(p=>p.kind==='laptop'))for(const lv of laptop.variants)for(const dock of shopProducts.filter(p=>p.kind==='dock'))for(const dv of dock.variants){
 if(!('ram' in lv)||lv.ram!<32||lv.ssd!<1024||laptop.weight!>1.6||!laptop.linux||laptop.port!=='USB4'||lv.stock<2||!dock.linux||!dock.dual4k||dock.watts!<90||dock.port!==laptop.port||dv.stock<2)continue;
 for(const coupon of ['SAVE10','SAVE150'])for(const shipping of [{id:'express',price:2500},{id:'priority',price:4500}]){
  const subtotal=2*(lv.price+dv.price),discount=coupon==='SAVE10'?Math.round(lv.price*2*.1):15000,tax=Math.round((subtotal-discount+shipping.price)*.13);
  candidates.push({laptopSku:lv.sku,dockSku:dv.sku,totalCents:subtotal-discount+shipping.price+tax,coupon,shipping:shipping.id});
 }
}
candidates.sort((a,b)=>a.totalCents-b.totalCents);assert.deepEqual(candidates[0],{laptopSku:shopExpected.laptopSku,dockSku:shopExpected.dockSku,totalCents:shopExpected.totalCents,coupon:shopExpected.coupon,shipping:shopExpected.shipping});
const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();await page.route('**/*',route=>{const body=shopHtml(route.request().url());return body?route.fulfill({body,contentType:'text/html'}):route.abort()});
 for(const [id,sku] of [['swift','swift32'],['dockpro','dockpro']]){await page.goto('https://procurement-benchmark.example/product/'+id);await page.getByLabel('Configuration').selectOption(sku);await page.getByLabel('Quantity').fill('2');await page.getByText('Add to cart',{exact:true}).click();}
 await page.goto('https://procurement-benchmark.example/checkout');
 for(const [label,value] of Object.entries({'Full name':'Alex Benchmark',Email:'dash.benchmark@example.invalid',Street:'100 Queen Street West',City:'Toronto',Province:'Ontario','Postal code':'M5H 2N2',Coupon:'SAVE10'}))await page.getByLabel(label,{exact:true}).fill(value);
 await page.locator('#shipping').selectOption('express');await page.getByRole('button',{name:'Review quote',exact:true}).click();await page.waitForURL('**/review');
 const review=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('review')!));
 for(const key of ['subtotalCents','discountCents','shippingCents','taxCents','totalCents'])assert.equal(review[key],(shopExpected as any)[key]);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('submitted')),null);
 console.log(JSON.stringify({oracle:candidates[0],feasibleCombinations:candidates.length,renderedReviewVerified:true}));
}finally{await browser.close()}
