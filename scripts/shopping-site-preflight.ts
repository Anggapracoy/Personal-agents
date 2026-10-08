import {mkdirSync,writeFileSync} from 'node:fs';
import {getCloudBrowser,closeCloudBrowser} from '../lib/harness/browser/registry';
const root='artifacts/shopping-comparison/preflight';mkdirSync(root,{recursive:true});
const sites=process.env.SHOPPING_PREFLIGHT_APPAREL==='1' ? [['american-giant','https://www.american-giant.com/'],['ascolour','https://ascolour.com/']] : [['ikea','https://www.ikea.com/us/en/cat/desk-lamps-20502/'],['logitech','https://www.logitech.com/en-us/shop/c/mice'],['llbean','https://www.llbean.com/']];
for(const [id,url] of sites){
 const owner=`shopping-preflight-${id}-${crypto.randomUUID()}@example.invalid`;const browser=getCloudBrowser(owner);
 try {let page=await browser.open(owner,url);page=await browser.wait(2000);writeFileSync(`${root}/${id}.json`,JSON.stringify(page,null,2));writeFileSync(`${root}/${id}.png`,await browser.screenshot());console.log(JSON.stringify({id,url:page.url,title:page.title,controls:page.elements.length,text:page.text.slice(0,300)}));}
 catch(error){console.log(JSON.stringify({id,error:String(error)}));}
 finally{await closeCloudBrowser(owner);}
}
