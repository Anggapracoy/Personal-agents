import { createHash } from 'node:crypto';
import type { BrowserSnapshot } from './cloud';

/** Approval binds to the page and intended control, not mutable page content. */
export function browserApprovalEvidence(page: BrowserSnapshot, ref: string) {
  if (page.warnings?.length || page.scopeRef) throw new Error('A complete browser observation is required before approval. Inspect the full page.');
  const control = page.elements.find(element => element.ref === ref);
  if (!control) throw new Error('The approved control is missing. Inspect the current page.');
  return createHash('sha256').update(JSON.stringify({ version: 2, url: page.url, documentId: page.documentId,
    control: { ref, name: control.name, role: control.role, tag: control.tag, type: control.type, href: control.href },
  })).digest('hex');
}

/** Click and explicit Enter/Space on the same button express the same approval. */
export function browserApprovalIdentity(tool: string, args: Record<string, unknown>): string | null {
  if (!['browser_click', 'browser_press'].includes(tool) || args.requiresApproval !== true || typeof args.pageEvidence !== 'string' || typeof args.pageUrl !== 'string') return null;
  if (tool === 'browser_press') {
    const submission = args.keySubmission as Record<string, unknown> | undefined;
    if (!['Enter', 'Space'].includes(String(args.key)) || submission?.implicitSubmission !== false || args.elementRole !== 'button') return null;
  }
  return JSON.stringify([args.pageUrl, args.pageEvidence, args.ref, args.elementName, args.elementRole, args.purpose, args.approvalCategory, args.approvalType]);
}

export class BrowserPreDispatchError extends Error {
  readonly inputDispatched = false;
}
