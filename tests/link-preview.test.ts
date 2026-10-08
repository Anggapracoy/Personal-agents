import test from 'node:test';
import assert from 'node:assert/strict';
import { messageLinks, previewUrl } from '../lib/link-preview';
import { isPublicAddress, publicAddress, parseLinkPreview } from '../lib/link-preview-fetch';

test('message previews follow Markdown links and references, deduplicate, and ignore code and images', () => {
  assert.deepEqual(messageLinks('https://example.com/thing'), { urls: ['https://example.com/thing'], linkOnly: true });
  assert.deepEqual(messageLinks('[Read this](https://example.com/thing)'), { urls: ['https://example.com/thing'], linkOnly: true });
  assert.deepEqual(messageLinks('[Read this][source]\n\n[source]: https://example.com/thing'), { urls: ['https://example.com/thing'], linkOnly: true });
  assert.deepEqual(messageLinks('Try https://example.com/thing. And [again](https://example.com/thing). `https://code.test` ![image](https://image.test/a.png)'), { urls: ['https://example.com/thing'], linkOnly: false });
  assert.deepEqual(messageLinks('```\nhttps://code.test\n```'), { urls: [], linkOnly: false });
  assert.equal(messageLinks('https://a.test https://b.test https://c.test https://d.test').urls.length, 3);
  assert.equal(messageLinks('https://a.test https://b.test https://c.test https://d.test', Infinity).urls.length, 4);
});
test('only public HTTP URLs and public resolved addresses are fetched', async () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://me:secret@example.com']) assert.equal(previewUrl(url), undefined);
  for (const ip of ['127.0.0.1', '0.0.0.0', '10.1.2.3', '172.16.0.1', '192.168.1.2', '169.254.169.254', '100.64.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1']) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
  await assert.rejects(publicAddress(new URL('http://2130706433')));
  await assert.rejects(publicAddress(new URL('http://[::ffff:127.0.0.1]')));
  await assert.rejects(publicAddress(new URL('https://example.com:8443')));
  const mixed = async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }];
  await assert.rejects(publicAddress(new URL('https://example.com'), mixed as never));
});
test('metadata uses OG then Twitter then title, decodes entities, and resolves image redirects', () => {
  const preview = parseLinkPreview('<html><head><title>Fallback</title><meta content="Fish &amp; Chips" property="og:title"><meta property="og:image" content="/image.png"><meta property="og:url" content="https://evil.test"></head><body><meta property="og:title" content="Wrong"></body></html>', 'https://short.test/a', 'https://www.example.com/story');
  assert.deepEqual(preview, { url: 'https://short.test/a', title: 'Fish & Chips', domain: 'example.com', image: 'https://www.example.com/image.png' });
  assert.equal(parseLinkPreview('<meta name="twitter:title" content="Tweet"><title>Page</title>', 'https://example.com').title, 'Tweet');
  assert.equal(parseLinkPreview('<title>Page &amp; title</title>', 'https://example.com').title, 'Page & title');
  assert.equal(parseLinkPreview('<meta property="og:image" content="javascript:alert(1)">', 'https://example.com').image, undefined);
  assert.equal(parseLinkPreview('<script>"<meta property=og:title content=Wrong>"</script>', 'https://example.com').title, 'example.com');
});

test('product gallery fallback works across domains and retains high-resolution image maps',()=>{
 const html='<body><img src="https://cdn.example.com/ad.jpg"><div class="product-gallery"><img id="landingImage" src="https://cdn.example.com/main.jpg" data-old-hires="https://cdn.example.com/high.jpg"></div></body>';
 for(const host of ['shop.example.com','brand.example.org','www.amazon.ca']) assert.equal(parseLinkPreview(html,`https://${host}/item`).image,'https://cdn.example.com/high.jpg');
 const dynamic='<img class="product-image" src="/thumb.jpg" data-a-dynamic-image=\'{"https://cdn.example.com/small.jpg":[50,50],"https://cdn.example.com/large.jpg":[500,500]}\'>';
 assert.equal(parseLinkPreview(dynamic,'https://shop.test/product').image,'https://cdn.example.com/large.jpg');
 assert.equal(parseLinkPreview('<meta property="og:image" content="/social.jpg">'+html,'https://shop.test/product').image,'https://shop.test/social.jpg');
});

test('product metadata handles JSON-LD graphs, arrays, and ImageObjects without executing scripts',()=>{
 const schema={'@graph':[{'@type':'BreadcrumbList'}, {'@type':'Product',name:'Daily Lotion',image:[{'@type':'ImageObject',contentUrl:'/lotion.jpg'}]}]};
 assert.equal(parseLinkPreview(`<script type="application/ld+json">${JSON.stringify(schema)}</script>`,'https://brand.test/lotion').image,'https://brand.test/lotion.jpg');
 const graph=[{'@type':'Product',name:'Other Shampoo',image:'/wrong.jpg'},{'@type':['Thing','Product'],name:'Daily Lotion',image:'/right.jpg'}];
 assert.equal(parseLinkPreview(`<title>Daily Lotion</title><script type="application/ld+json">${JSON.stringify(graph)}</script>`,'https://brand.test/lotion').image,'https://brand.test/right.jpg');
 assert.equal(parseLinkPreview('<script>window.product={image:"/wrong.jpg"}</script><script type="application/ld+json">invalid</script>','https://brand.test/lotion').image,undefined);
});

test('lazy galleries skip placeholders and use responsive sources including quoted breakpoint maps',()=>{
 const lazy=`<product-gallery><img alt="image 1" src="data:image/gif;base64,AAAA" v-srcset="{'0': '/packshot.jpg?w=900', '769': '/packshot.jpg?w=1024'}"><img alt="lifestyle" data-src="/lifestyle.jpg"></product-gallery>`;
 assert.equal(parseLinkPreview(lazy,'https://brand.test/product').image,'https://brand.test/packshot.jpg?w=900');
 assert.equal(parseLinkPreview('<div class="product-gallery"><img src="/placeholder.gif" data-lazy-srcset="/small.jpg 300w, /large.jpg 900w"></div>','https://brand.test/product').image,'https://brand.test/large.jpg');
 assert.equal(parseLinkPreview('<div class="product-media"><picture><source srcset="/large.webp 900w"><img src="/fallback.jpg"></picture></div>','https://brand.test/product').image,'https://brand.test/large.webp');
 assert.equal(parseLinkPreview('<title>Hydrating Daily Lotion</title><img alt="Hydrating Daily Lotion" data-original="/lotion.jpg">','https://brand.test/product').image,'https://brand.test/lotion.jpg');
});

test('gallery fallback excludes unrelated, hidden, tiny, and unsafe images',()=>{
 for(const html of [
  '<img src="/ad.jpg"><img alt="logo" src="/logo.jpg">',
  '<template><img class="product-image" src="/wrong.jpg"></template>',
  '<nav><img class="product-image" src="/wrong.jpg"></nav>',
  '<div hidden><img class="product-image" src="/wrong.jpg"></div>',
  '<div class="related-products"><img class="product-image" src="/wrong.jpg"></div>',
  '<img class="product-image" width="1" height="1" src="/pixel.jpg">',
  '<img class="product-image" src="javascript:alert(1)" data-src="data:image/png;base64,AAAA">',
  '<img class="product-image" src="https://user:secret@evil.test/img.jpg">',
 ]) assert.equal(parseLinkPreview(html,'https://brand.test/product').image,undefined,html);
});
