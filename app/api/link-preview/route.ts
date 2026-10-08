import { NextResponse } from 'next/server';
import { currentUserEmail } from '../../../lib/auth/session';
import { previewUrl } from '../../../lib/link-preview';
import { fetchPreviewResource, getLinkPreview } from '../../../lib/link-preview-fetch';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  if (!await currentUserEmail()) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const image = params.has('image');
  const url = previewUrl(params.get(image ? 'image' : 'url') ?? '');
  if (!url) return NextResponse.json({ preview: null }, { status: 400 });
  if (image) {
    try {
      const result = await fetchPreviewResource(url, true);
      return new Response(new Uint8Array(result.body), { headers: { 'content-type': result.type, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
    } catch { return new Response(null, { status: 404 }); }
  }
  const preview = await getLinkPreview(url);
  return NextResponse.json({ preview: preview && { ...preview, image: preview.image ? `/api/link-preview?image=${encodeURIComponent(preview.image)}` : undefined } }, { headers: { 'cache-control': 'private, max-age=600' } });
}
