import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { MAX_PHOTO_BYTES, normalizeProfilePhoto } from '../lib/profile-photo';

test('profile uploads become small square JPEGs without original metadata', async () => {
  const source = await sharp({create:{width:800,height:400,channels:3,background:'#2288cc'}}).jpeg().withMetadata({exif:{IFD0:{Artist:'Private name'}}}).toBuffer();
  const result = await normalizeProfilePhoto(source);
  assert.ok(result.startsWith('data:image/jpeg;base64,'));
  const meta = await sharp(Buffer.from(result.split(',')[1], 'base64')).metadata();
  assert.equal(meta.width,256); assert.equal(meta.height,256);
  assert.equal(meta.format,'jpeg'); assert.equal(meta.exif,undefined);
  assert.ok(result.length < 350000);
});
test('rejects markup, corrupt and oversized profile uploads', async () => {
  for (const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>'),Buffer.from('not an image'),Buffer.alloc(MAX_PHOTO_BYTES+1)]) {
    await assert.rejects(()=>normalizeProfilePhoto(bytes));
  }
});
