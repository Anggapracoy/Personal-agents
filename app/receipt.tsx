import type { ReactNode } from "react";

export type ReceiptGlyphKind = "answers" | "phone" | "wait" | "email" | "lock";

export function ReceiptGlyph({ kind }: { kind: ReceiptGlyphKind }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "email" ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>
      : kind === "answers" ? <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16 9.5" /></>
      : kind === "phone" ? <path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a15 15 0 0 1-7-7l2-2-2-5Z" />
      : kind === "lock" ? <><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>
      : <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>}
  </svg>;
}

/** The one read-only status row: an icon, a bold line, and muted detail lines. */
export function Receipt({ icon, title, detail, failed = false, label, live = false }: { icon: ReactNode; title: ReactNode; detail?: string | string[] | null; failed?: boolean; label?: string; live?: boolean }) {
  const lines = (Array.isArray(detail) ? detail : [detail]).filter((line): line is string => Boolean(line));
  return <section className={`wd-receipt${failed ? " is-failed" : ""}`} aria-label={label} role={live ? "status" : undefined} aria-live={live ? "polite" : undefined}>
    <span className="wd-receipt-icon" aria-hidden="true">{icon}</span>
    <div className="wd-receipt-copy"><b>{title}</b>{lines.map((line, index) => <span key={index}>{line}</span>)}</div>
  </section>;
}

export function Receipts({ label, children }: { label?: string; children: ReactNode }) {
  return <div className="wd-receipts" role="group" aria-label={label}>{children}</div>;
}
