import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

export type LinkPreview = { url: string; title: string; domain: string; image?: string };
export function previewUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || value.length > 2048) return;
    return url.href;
  } catch { return; }
}
const parser = unified().use(remarkParse).use(remarkGfm);
/** Use Markdown's link grammar, including references; never fetch code or images. */
export function messageLinks(text: string, limit = 3): { urls: string[]; linkOnly: boolean } {
  const tree = parser.parse(text);
  const definitions = new Map<string, string>();
  for (const node of tree.children) if (node.type === 'definition') definitions.set(node.identifier, node.url);
  const urls: string[] = [];
  const visit = (node: typeof tree.children[number] | typeof tree) => {
    const href = node.type === 'link' ? node.url : node.type === 'linkReference' ? definitions.get(node.identifier) : undefined;
    const url = href && previewUrl(href);
    if (url && !urls.includes(url) && urls.length < limit) urls.push(url);
    if ('children' in node) node.children.forEach(child => visit(child as typeof tree.children[number]));
  };
  visit(tree);
  const content = tree.children.filter(node => node.type !== 'definition');
  const paragraph = content.length === 1 && content[0].type === 'paragraph' ? content[0] : undefined;
  const linkOnly = urls.length === 1 && paragraph?.children.length === 1 && ['link', 'linkReference'].includes(paragraph.children[0].type);
  return { urls, linkOnly: Boolean(linkOnly) };
}

/** Labels shared in the message remain useful when preview metadata is unavailable. */
export function messageLinkLabels(text: string): Map<string, string> {
  const tree = parser.parse(text);
  const definitions = new Map<string, string>();
  for (const node of tree.children) if (node.type === 'definition') definitions.set(node.identifier, node.url);
  const labels = new Map<string, string>();
  type LinkNode = { type: string; value?: string; url?: string; identifier?: string; children?: LinkNode[] };
  const labelText = (node: LinkNode): string => node.type === 'text' || node.type === 'inlineCode' ? node.value ?? '' : node.children?.map(labelText).join('') ?? '';
  const visit = (node: LinkNode) => {
    const href = node.type === 'link' ? node.url : node.type === 'linkReference' ? definitions.get(node.identifier ?? '') : undefined;
    const url = href && previewUrl(href);
    const label = labelText(node).trim();
    if (url && label && label !== href) labels.set(url, label);
    node.children?.forEach(visit);
  };
  visit(tree);
  return labels;
}
