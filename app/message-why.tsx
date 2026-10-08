"use client";
import { useId, useState } from "react";

export function MessageWhy({ reasons }: { reasons: string[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="wd-message-why" data-open={open}>
    <button type="button" className="wd-message-why-toggle" aria-label="Why I’m asking" title="Why I’m asking" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18h6m-5 3h4M8.1 13.5a6 6 0 1 1 7.8 0c-1.1.9-1.4 1.8-1.4 3.5h-5c0-1.7-.3-2.6-1.4-3.5Z" /></svg>
    </button>
    <div id={id} className="wd-message-why-reveal" aria-hidden={!open} inert={!open}>
      <div className="wd-message-why-content"><ul>{reasons.map((line, index) => <li key={index}>{line}</li>)}</ul></div>
    </div>
  </div>;
}
