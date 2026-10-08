import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
const parser = unified().use(remarkParse).use(remarkGfm);
/** Home previews and notifications are plain text; preserve literal punctuation, not Markdown delimiters. */
export function messagePreview(text: string): string {
  const tree = parser.parse(text);
  const read = (node: { type: string; value?: string; alt?: string | null; children?: unknown[] }): string => {
    if (node.type === 'html' || node.type === 'definition') return '';
    if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? '';
    if (typeof node.value === 'string') return node.value;
    return (node.children ?? []).map(child => read(child as typeof node)).join(['root', 'list', 'listItem', 'blockquote', 'table', 'tableRow'].includes(node.type) ? ' ' : '');
  };
  return read(tree).replace(/\s+/g, ' ').trim();
}
