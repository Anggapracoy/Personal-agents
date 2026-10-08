"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isTopSheet } from "./sheet-coverage-stack";
import { hasNativeBridge } from "./native-bridge";
import { useSheetMotion } from "./sheet-motion";

export type ConfirmAction = { label: string; tone?: "primary" | "destructive" | "text"; run: (input: string) => void | Promise<boolean | void> };

/**
 * The one confirmation surface. A title, a sentence, and stacked actions. The
 * optional typed check is for the two irreversible account deletes.
 */
export function ConfirmSheet({ title, body, actions, input, busy, error, onClose, nativePrompt }: {
  title: string; body: string; actions: ConfirmAction[];
  input?: { label: string; placeholder: string; expected: string };
  busy?: boolean; error?: string; onClose: () => void;
  nativePrompt?: string;
}) {
  const [webFallback,setWebFallback]=useState(Boolean(error));
  useLayoutEffect(()=>{if(error)setWebFallback(true);},[error]);
  const native = Boolean(nativePrompt && hasNativeBridge()) && !webFallback;
  const presented=!native || Boolean(error);
  const prompted = useRef(false);
  useEffect(() => {
    if (!native || error || prompted.current) return;
    prompted.current = true;
    if (!window.confirm(nativePrompt!)) { onClose(); return; }
    void Promise.resolve(actions[0].run("")).then(result => { if (result !== false) onClose(); });
  }, [native, nativePrompt, actions, onClose, error]);
  const { sheetRef, scrimRef, close } = useSheetMotion(onClose, { presented });
  const [dismissing, setDismissing] = useState(false);
  const [value, setValue] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const valid = !input || value.trim().toLowerCase() === input.expected.toLowerCase();
  const activity=useRef({busy,running}); activity.current={busy,running};
  useEffect(() => {
    const dialog=sheetRef.current;
    if(!dialog || !presented) return;
    const previous=document.activeElement as HTMLElement | null;
    const initial=dialog.querySelector<HTMLElement>('input');
    (initial ?? dialog).focus({preventScroll:true});
    const onKey = (event: KeyboardEvent) => {
      if(!isTopSheet(dialog)) return;
      if (event.key === "Escape" && !activity.current.busy && !activity.current.running) { event.preventDefault(); setDismissing(true); close(); }
      if(event.key === "Tab") {
        const controls=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(node=>node.getClientRects().length);
        const first=controls[0],last=controls.at(-1);
        if(!first) { event.preventDefault(); dialog.focus({preventScroll:true}); return; }
        if(event.shiftKey && (document.activeElement===first || document.activeElement===dialog)) { event.preventDefault(); last?.focus(); }
        else if(!event.shiftKey && document.activeElement===last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); if(previous?.isConnected) previous.focus({preventScroll:true}); };
  }, [close, sheetRef, presented]);
  const select = async (action: ConfirmAction) => {
    if (running || busy || dismissing) return;
    setRunning(action.label);
    try { if (await action.run(value.trim()) !== false) { setDismissing(true); close(); } }
    finally { setRunning(null); }
  };
  if (native && !error) return null;
  return (
    <div className="wd-sheet-root">
      <button ref={scrimRef} type="button" className="wd-sheet-scrim" aria-label="Close" onClick={() => { if (!busy && !running) { setDismissing(true); close(); } }} />
      <section ref={sheetRef} className="wd-sheet wd-confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="wd-confirm-title" tabIndex={-1}>
        <h2 id="wd-confirm-title">{title}</h2>
        <p>{body}</p>
        {input && (
          <div className="wd-fields">
            <label><span>{input.label}</span><input autoFocus autoCapitalize="none" autoComplete="off" value={value} placeholder={input.placeholder} onChange={(event) => setValue(event.target.value)} /></label>
          </div>
        )}
        {error && <p className="wd-card-error" role="alert">{error}</p>}
        <div className="wd-sheet-actions">
          {actions.map((action) => {
            const primary = action.tone !== "text";
            return (
              <button
                key={action.label}
                type="button"
                className={`wd-btn ${primary ? (action.tone === "destructive" ? "is-secondary is-danger" : "is-primary") : "is-text"}`}
                disabled={busy || Boolean(running) || dismissing || (primary && !valid)}
                onClick={() => void select(action)}
              >
                {(running === action.label || (busy && primary)) ? <span className="wd-spinner" /> : null}
                <span>{action.label}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
