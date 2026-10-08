import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedLinkPreview, loadLinkPreview, isPreviewImageReady, warmPreviewImage } from '../app/link-preview-cache';

test('successful previews remain available during expiry refresh and transient failures', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  const url = 'https://example.com/cached-product';
  const preview = { title: 'Product', domain: 'example.com', image: '/product.jpg', url };
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ preview }); };
  try {
    await loadLinkPreview(url);
    assert.deepEqual(cachedLinkPreview(url), preview);
    await loadLinkPreview(url);
    assert.equal(calls, 1);
    now += 11 * 60_000;
    assert.deepEqual(cachedLinkPreview(url), preview);
    globalThis.fetch = async () => { throw new Error('offline'); };
    const refresh = loadLinkPreview(url);
    assert.deepEqual(cachedLinkPreview(url), preview);
    assert.deepEqual(await refresh, preview);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
});

test('image readiness only accepts successfully loaded images and reuses warm images', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const instances: FakeImage[] = [];
  class FakeImage {
    complete = false; naturalWidth = 0; src = ''; referrerPolicy = ''; loading = '';
    constructor() { instances.push(this); }
    async decode() {}
  }
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
  Object.defineProperty(globalThis, 'Image', { value: FakeImage, configurable: true });
  try {
    warmPreviewImage('/explicit-product.jpg');
    assert.equal(isPreviewImageReady('/explicit-product.jpg'), false);
    instances[0].complete = true;
    assert.equal(isPreviewImageReady('/explicit-product.jpg'), false);
    instances[0].naturalWidth = 300;
    assert.equal(isPreviewImageReady('/explicit-product.jpg'), true);
    warmPreviewImage('/explicit-product.jpg');
    assert.equal(instances.length, 1);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage); else Reflect.deleteProperty(globalThis, 'Image');
  }
});
