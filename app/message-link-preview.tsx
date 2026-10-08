'use client';
import { actionableMapsLink } from '../lib/maps-link';
import { useEffect, useState } from 'react';
import type { LinkPreview } from '../lib/link-preview';
import { cachedLinkPreview, loadLinkPreview } from './link-preview-cache';
export function MessageLinkPreview({ url, name, description }: { url: string; name?: string; description?: string }) {
  const [preview, setPreview] = useState<LinkPreview | null>(() => cachedLinkPreview(url) ?? null);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { let live = true; void loadLinkPreview(url).then(value => { if (live) setPreview(value); }); return () => { live = false; }; }, [url]);
  const domain = new URL(url).hostname.replace(/^www\./, '');
  const title = name || preview?.title || domain;
  return <a className="wd-link-preview" href={actionableMapsLink(url)} target="_blank" rel="noopener noreferrer" aria-label={`${title === domain ? domain : `${title} — ${domain}`}`}>
    {preview?.image && !imageFailed && <img src={preview.image} alt="" loading="eager" decoding="sync" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />}
    <span className="wd-link-preview-caption"><span className="wd-link-preview-title">{title}</span>{description && <span className="wd-link-preview-description">{description}</span>}{title !== domain && <span className="wd-link-preview-domain">{preview?.domain || domain}</span>}</span>
  </a>;
}
