"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { You, type YouPanel, type YouProps, type VaultEditor } from "./you";
import { useNativeSheetClose } from "./native-sheet-close";
import { useSheetMotion } from "./sheet-motion";

export function SettingsSheet({ onClose, panel: initialPanel, ...props }: Omit<YouProps, "onBack" | "onOpenPanel" | "onClose"> & { onClose: () => void }) {
  const [panels, setPanels] = useState<Array<{ panel?: YouPanel; editor?: VaultEditor }>>(() => initialPanel ? [{}, { panel: initialPanel }] : [{}]);
  const { sheetRef, scrimRef, close, dragHandleProps } = useSheetMotion(onClose, { contentSwipe: true });
  const { closeRef, nativeClose } = useNativeSheetClose(sheetRef, close, "Close Settings");
  const content = useRef<HTMLDivElement>(null);
  const popping = useRef(false);
  const pop = (interactive = false) => {
    if (popping.current || panels.length < 2) return;
    const commit = () => { popping.current = false; setPanels(current => current.slice(0, -1)); };
    const node = content.current?.lastElementChild;
    if (interactive || !node) { commit(); return; }
    popping.current = true;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animation = node.animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : [{ translate: "0 0" }, { translate: "100% 0" }],
      { duration: reduced ? 100 : 220, easing: "cubic-bezier(.2,.75,.2,1)", fill: "forwards" });
    void animation.finished.then(commit).catch(() => { popping.current = false; });
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = sheetRef.current;
    dialog?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab" || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(node => node.getClientRects().length && !node.closest("[inert]"));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog?.addEventListener("keydown", key);
    return () => { dialog?.removeEventListener("keydown", key); previous?.focus({ preventScroll: true }); };
  }, [close, sheetRef]);
  return <div className="wd-sheet-root wd-settings-sheet-root">
    <button ref={scrimRef} className="wd-sheet-scrim" aria-label="Dismiss Settings" onClick={close} />
    <section ref={sheetRef} className="wd-settings-sheet" role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1}>
      <div className="wd-settings-grabber" {...dragHandleProps} />
      <div ref={content} className="wd-settings-content">
        {panels.map((destination, index) => <SettingsPage key={index} active={index === panels.length - 1} animateIn={index > 0}>
          <You {...props} panel={destination.panel} vaultEditor={destination.editor} active={index === panels.length - 1} onClose={close}
            closeRef={index === panels.length - 1 ? closeRef : undefined} nativeClose={index === panels.length - 1 && nativeClose} headerDragProps={dragHandleProps}
            onOpenPanel={next => { if (!popping.current) setPanels(current => [...current, { panel: next }]); }}
            onVaultEditorChange={(editor, interactive) => {
              if (editor) { if (!popping.current) setPanels(current => [...current, { panel: "vault", editor }]); }
              else pop(interactive);
            }} onBack={pop} />
        </SettingsPage>)}
      </div>
    </section>
  </div>;
}

/** Retain the real parent page, including its scroll position, underneath the destination. */
function SettingsPage({ active, animateIn, children }: { active: boolean; animateIn: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!animateIn) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animation = ref.current?.animate(reduced ? [{ opacity: 0 }, { opacity: 1 }] : [{ translate: "100% 0" }, { translate: "0 0" }],
      { duration: reduced ? 100 : 280, easing: "cubic-bezier(.2,.75,.2,1)" });
    return () => animation?.cancel();
  }, [animateIn]);
  return <div ref={ref} className="wd-settings-page" aria-hidden={!active || undefined} inert={!active}>{children}</div>;
}
