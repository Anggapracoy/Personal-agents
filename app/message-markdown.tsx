'use client';
import { actionableMapsLink } from '../lib/maps-link';
import { useMemo } from 'react';
import type { MessageResult } from '../lib/message-results';
import { previewUrl, messageLinks } from '../lib/link-preview';
import { MessageLinkPreview } from './message-link-preview';
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Render text safely; webpage metadata supplies separate rich link previews. */
export function MessageMarkdown({ text, results = [] }: { text: string; results?: MessageResult[] }) {
  const links = useMemo(() => messageLinks(text), [text]);
  const previews = new Map<string, { name?: string; description?: string }>();
  for (const result of results) if (result.sourceUrl) previews.set(result.sourceUrl, { name: result.name, description: result.description });
  for (const url of links.urls) if (!previews.has(url)) previews.set(url, {});
  return <div className={`wd-message-markdown${links.linkOnly ? " is-link-only" : ""}`}>{!links.linkOnly && <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ children, href }) => results.length && href && previews.has(previewUrl(href) || "") ? <span>{typeof children === "string" && previewUrl(children) ? previews.get(previewUrl(href) || "")?.name || "Website" : children}</span> : <a href={href ? actionableMapsLink(href) : href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ alt }) => <span>{alt}</span>,
  }}>{text}</Markdown>}{previews.size > 0 && <div className="wd-message-links">{Array.from(previews, ([url, details]) => <MessageLinkPreview key={url} url={url} {...details} />)}</div>}{results.filter(result => !result.sourceUrl).map((result, index) => <p key={index}><strong>{result.name}</strong>{result.description && <> — {result.description}</>}</p>)}</div>;
}
