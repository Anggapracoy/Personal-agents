"use client";
import { photoSource } from "./attachment-preview";
import { NativeGlassButton } from "./native-glass-button";
import { MessageMarkdown } from "./message-markdown";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { postNativeMessage } from "./native-bridge";
import { savePhotos } from "./save-photos";
import { attachPhotoViewerMotion } from "./photo-viewer-motion";

type Photo = { id: string; url: string; description: string };

export function PhotoMessage({ photos, caption, mine = false }: { photos: Photo[]; caption?: string; mine?: boolean }) {
  const [selected, setSelected] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const motion = useRef<ReturnType<typeof attachPhotoViewerMotion> | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const download = async (urls: string[]) => {
    if (saving) return;
    setSaving(true); setSaveStatus("");
    try { setSaveStatus(await savePhotos(urls)); }
    catch (error) { setSaveStatus(error instanceof Error ? error.message : "Couldn’t save the photo."); }
    finally { setSaving(false); }
  };
  useEffect(() => {
    const keyboardFocus = () => { if (opener.current) delete opener.current.dataset.pointerFocus; };
    document.addEventListener("keydown", keyboardFocus, true);
    return () => { document.removeEventListener("keydown", keyboardFocus, true); };
  }, []);
  const isOpen = selected !== null;
  useLayoutEffect(() => {
    if (!isOpen) return;
    postNativeMessage({ version: 1, action: "modalOverlayVisibility", payload: { visible: true, hidesNavigation: true, appearance: "dark" } });
    return () => postNativeMessage({ version: 1, action: "modalOverlayVisibility", payload: { visible: Boolean(document.querySelector(".wd-details-panel")), hidesNavigation: Boolean(document.querySelector(".wd-details-panel")) } });
  }, [isOpen]);
  useLayoutEffect(() => {
    const viewer = dialog.current;
    if (!isOpen || !viewer) return;
    viewer.showModal();
    window.dispatchEvent(new Event("decisionFeed:sheetLayout"));
    motion.current = attachPhotoViewerMotion(viewer, () => { viewer.close(); setSelected(null); });
    return () => { motion.current?.dispose(); motion.current = null; if (viewer.open) viewer.close(); window.dispatchEvent(new Event("decisionFeed:sheetLayout")); };
  }, [isOpen]);
  const close = () => motion.current?.close();
  const photo = selected === null ? null : photos[selected];
  return <div className={`wd-photo-message${mine ? " is-mine" : ""}`}>
    <div className="wd-photo-attachment">
    <div className={`wd-photo-grid${photos.length === 1 ? " is-single" : ""}`}>
      {photos.map((item, index) => <button type="button" className="wd-photo-thumb" key={item.id} aria-label={`Open photo ${index + 1}: ${item.description}`} onKeyDown={event => { delete event.currentTarget.dataset.pointerFocus; }} onClick={event => { if (failed[item.id]) { setFailed(value => ({ ...value, [item.id]: false })); return; } opener.current = event.currentTarget; event.currentTarget.dataset.pointerFocus = String(event.detail > 0); setSelected(index); }}>
        {failed[item.id] ? <span>Photo unavailable<br /><small>Tap to retry</small></span> : <img src={photoSource(item.url)} alt={item.description} loading="eager" onError={() => setFailed(value => ({ ...value, [item.id]: true }))} />}
      </button>)}
    </div>
    {!mine && <button type="button" className="wd-photo-download" aria-label={photos.length === 1 ? "Save photo" : "Save all photos"} disabled={saving} onClick={() => void download(photos.map(photo => photo.url))}>{saving ? <span className="wd-spinner is-small" /> : <DownloadIcon />}</button>}
    </div>
    {saveStatus && <span className="wd-photo-save-status" role="status">{saveStatus}</span>}
    {caption && <div className="wd-agent"><MessageMarkdown text={caption} /></div>}
    <dialog ref={dialog} className="wd-photo-viewer" aria-label="Photo viewer" onContextMenu={event => { event.stopPropagation(); motion.current?.cancelDrag(); }} onCancel={event => { event.preventDefault(); close(); }} onClose={() => { setSelected(null); opener.current?.focus(); }} onKeyDown={event => {
      if (event.key === "ArrowRight" && selected !== null) setSelected(Math.min(photos.length - 1, selected + 1));
      if (event.key === "ArrowLeft" && selected !== null) setSelected(Math.max(0, selected - 1));
    }}>
      {photo && <>
        <div className="wd-photo-toolbar"><NativeGlassButton symbol="xmark" type="button" onClick={close} aria-label="Close photo"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></NativeGlassButton><span>{selected! + 1} of {photos.length}</span><NativeGlassButton symbol="square.and.arrow.down" type="button" disabled={saving} onClick={() => void download([photo.url])} aria-label="Save this photo"><DownloadIcon /></NativeGlassButton></div>
        {saveStatus && <span className="wd-photo-save-status" role="status">{saveStatus}</span>}
        <div className="wd-photo-full" key={photo.id}><img draggable={false} src={photoSource(photo.url)} alt={photo.description} onError={event => { event.currentTarget.alt = "Photo could not load. Close and tap the photo to retry."; }} /></div>
        <div className="wd-photo-controls"><button type="button" disabled={selected === 0} onClick={() => setSelected(selected! - 1)}>Previous</button><span title={photo.description}>{photo.description}</span><button type="button" disabled={selected === photos.length - 1} onClick={() => setSelected(selected! + 1)}>Next</button></div>
      </>}
    </dialog>
  </div>;
}

function DownloadIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M6 9H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1" /></svg>; }
