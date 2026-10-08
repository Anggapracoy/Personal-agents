import { z } from 'zod';
export const browserNamedKeyPattern = /^(?:Enter|Space|Tab|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Backspace|Delete|Insert|CapsLock|NumLock|PrintScreen|Pause|ContextMenu|F(?:[1-9]|1\d|2[0-4]))$/;
export function isBrowserKey(value: string) {
  if (/^[A-Za-z0-9]{1,32}$/.test(value) || (Array.from(value).length === 1 && !/\p{C}/u.test(value))) return true;
  const parts=value.split('+'); const base=parts.pop()!;
  return parts.every(p=>['ControlOrMeta','Control','Meta','Alt','Shift'].includes(p)) && (browserNamedKeyPattern.test(base) || (base.length===1 && !/\p{C}/u.test(base)));
}
export const browserKeySchema=z.string().min(1).max(80).refine(isBrowserKey,'Use a printable key, named key, modifier chord, or 1–32 letters/digits');

// Literal page text: never named keys, control characters, or shortcuts.
export const browserPageTextSchema = z.string().min(1).max(512).regex(/^[^\p{C}]+$/u, "Use literal printable text without control characters");
