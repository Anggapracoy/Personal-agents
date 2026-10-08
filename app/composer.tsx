"use client";
import { messagePreview } from "../lib/message-preview";
import { attachmentThumbnail } from "./attachment-preview";
import { prepareChatFiles, CHAT_FILE_LIMIT, CHAT_FILE_COUNT } from "./chat-files";
import { DraftAttachments, DraftPhotos } from "./draft-attachments";
import { fileDescription } from "../lib/file-display";
import { composerError } from "./composer-error";
import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { postNativeMessage, type NativeWindow } from "./native-bridge";
import { requestCurrentLocation } from "./current-location";
import { messageWithLocation, sharedLocationAccuracy, type SharedLocation } from "../lib/shared-location";
import { playMessageFeedback } from "./message-feedback";
import { prepareMessageSend, sendMotionSamples, type ComposerSendOrigin } from "./message-send-motion";
import { VoiceInput, idleVoice, type VoiceInputControls } from "./voice-input";

const noDraftFiles: File[] = [];
const fileIds = new WeakMap<File, string>();
function draftFileId(file: File) {
  let id = fileIds.get(file);
  if (!id) { id = crypto.randomUUID(); fileIds.set(file, id); }
  return id;
}

/**
 * The one input in the product. On Home it starts a new thread; on a task it
 * replies in that thread. Pinned to the bottom above the home indicator.
 */
export function Composer({ value, onChange, onSend, placeholder, sending, disabled, variant = "home", active = true, nativeChromeActive = active, onFiles, files = noDraftFiles, onRemoveFile, fileCount = files.length, fileBytes = files.reduce((total, file) => total + file.size, 0), error, focusRequest = 0, onStop, replyTo, onCancelReply }: {
  replyTo?: { name: string; text: string }; onCancelReply?: () => void;
  value: string; onChange: (value: string) => void; onSend: (message: string) => boolean | void | Promise<boolean | void>; placeholder: string; focusRequest?: number; onStop?: () => void;
  active?: boolean; nativeChromeActive?: boolean; sending?: boolean; disabled?: boolean; variant?: "home" | "thread"; onFiles?: (files: File[]) => void; files?: File[]; onRemoveFile?: (index: number) => void; fileCount?: number; fileBytes?: number; error?: string | null;
}) {
  const composerId = useId();
  const form = useRef<HTMLFormElement>(null);
  const [native, setNative] = useState(false);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    void Promise.all(files.filter(file => file.type.startsWith("image/")).map(async file => {
      try { return [draftFileId(file), await attachmentThumbnail(file)] as const; }
      catch { return [draftFileId(file), ""] as const; }
    })).then(entries => { if (!cancelled) setThumbnails(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [files]);
  const [nativeSendHold, setNativeSendHold] = useState<string | null>(null);
  const nativeSendFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(nativeSendFrame.current), []);
  const [voice, setVoice] = useState(idleVoice);
  const voiceControls = useRef<VoiceInputControls>(null);
  const voiceBusy = ["requesting", "recording", "transcribing"].includes(voice.state);
  const [location, setLocation] = useState<SharedLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [preparingFiles, setPreparingFiles] = useState(false);
  const preparingFilesRef = useRef(false);
  const attachmentGeneration = useRef(0);
  useEffect(() => () => { attachmentGeneration.current += 1; }, [active]);
  const attachFiles = async (files: File[]) => {
    if (!active || disabled || sending || preparingFilesRef.current || !onFiles || !files.length) return;
    if (files.length + fileCount > CHAT_FILE_COUNT) { setPasteError("Attach up to 6 files per message."); return; }
    const generation = attachmentGeneration.current;
    preparingFilesRef.current = true; setPreparingFiles(true); setPasteError(null);
    try {
      const prepared = await prepareChatFiles(files, CHAT_FILE_LIMIT - fileBytes);
      if (generation === attachmentGeneration.current) onFiles(prepared);
    } catch (error) {
      if (generation === attachmentGeneration.current) setPasteError(error instanceof Error ? error.message : "Couldn’t prepare those files.");
    } finally { preparingFilesRef.current = false; setPreparingFiles(false); }
  };
  const [locationError, setLocationError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const attachmentButton = useRef<HTMLButtonElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdOrigin = useRef({ x: 0, y: 0 });
  const held = useRef(false);
  const cancelHold = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  useEffect(() => () => cancelHold(), []);
  const removeFile = (id: string) => {
    if (disabled || sending) return;
    const index = files.findIndex(file => draftFileId(file) === id);
    if (index < 0) return;
    onRemoveFile?.(index); setPasteError(null);
  };

  useEffect(() => { if (voiceBusy) setMenuOpen(false); }, [voiceBusy]);
  const locationRequest = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    if (!active) { cancelHold(); locationRequest.current?.abort(); setLocating(false); setMenuOpen(false); }
    return () => locationRequest.current?.abort();
  }, [active]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => { if (!form.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuOpen(false); attachmentButton.current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [menuOpen]);
  const shareLocation = async () => {
    if (disabled || sending) return;
    setMenuOpen(false); setLocationError(null); setLocating(true);
    locationRequest.current?.abort();
    const request = new AbortController(); locationRequest.current = request;
    try { const result = await requestCurrentLocation(request.signal); if (!request.signal.aborted) setLocation(result); }
    catch (caught) { if (!request.signal.aborted) setLocationError(caught instanceof Error ? caught.message : "Your location could not be found."); }
    finally { if (locationRequest.current === request) { locationRequest.current = null; setLocating(false); } }
  };
  const removeLocation = () => { locationRequest.current?.abort(); setLocation(null); setLocationError(null); setLocating(false); };
  const send = async (origin?: ComposerSendOrigin) => {
    if (voiceBusy || disabled || sending || preparingFilesRef.current || locating || submitting.current || (!value.trim() && !fileCount && !location)) return;
    submitting.current = true;
    setPasteError(null);
    const draft = value;
    const sentLocation = location;
    const message = messageWithLocation(draft, sentLocation);
    const cancelMotion = prepareMessageSend(form.current, message, origin);
    const restoreDraft = () => {
      cancelAnimationFrame(nativeSendFrame.current); setNativeSendHold(null);
      if (!latest.current.value || latest.current.value === draft) onChange(draft);
      setLocation(current => current ?? sentLocation);
    };
    try {
      const response: { value: ReturnType<typeof onSend> } = { value: undefined };
      // Commit the optimistic turn and its flight before the native input
      // disappears. A bridge round trip must not leave a blank frame between them.
      flushSync(() => { if (native) setNativeSendHold(draft); onChange(""); setLocation(null); response.value = onSend(message); });
      if (native) {
        cancelAnimationFrame(nativeSendFrame.current);
        nativeSendFrame.current = requestAnimationFrame(() => {
          nativeSendFrame.current = requestAnimationFrame(() => {
            flushSync(() => setNativeSendHold(null));
          });
        });
      }
      if (!origin?.feedbackPlayed) playMessageFeedback("send");
      if (await response.value === false) { cancelMotion(); restoreDraft(); }
    }
    catch (error) { cancelMotion(); restoreDraft(); throw error; }
    finally { submitting.current = false; }
  };
  const latest = useRef({ value, onChange, send, shareLocation, removeLocation, attachFiles, removeFile, disabled, sending, onStop, onCancelReply });
  useLayoutEffect(() => { latest.current = { value, onChange, send, shareLocation, removeLocation, attachFiles, removeFile, disabled, sending, onStop, onCancelReply }; });
  useEffect(() => { setNative(Boolean((window as NativeWindow).__decisionFeedNativeComposer) && (!replyTo || Boolean((window as unknown as { __decisionFeedNativeReplyComposer?: boolean }).__decisionFeedNativeReplyComposer))); }, [Boolean(replyTo)]);
  useEffect(() => {
    if (!native || !nativeChromeActive) return;
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; action: string; value?: string; origin?: ComposerSendOrigin }>).detail;
      if (detail?.id !== composerId) return;
      const current = latest.current;
      if (detail.action === "change") current.onChange((detail.value ?? "").slice(0, 4000));
      if (detail.action === "send" && !current.disabled && !current.sending) {
        if (typeof detail.value === "string" && detail.value !== current.value) flushSync(() => current.onChange(detail.value!.slice(0, 4000)));
        void latest.current.send(detail.origin);
      }
      if (detail.action === "removeFile") current.removeFile(detail.value ?? "");
      if (detail.action === "pasteError") setPasteError("Couldn’t paste that file. Attach up to 6 files, 3 MB total.");
      if (detail.action === "pickError") setPasteError("Couldn’t attach those files. Attach up to 6 files, 3 MB total.");
      if ((detail.action === "pasteFiles" || detail.action === "pickedFiles") && !current.disabled && !current.sending) {
        try {
          const files = JSON.parse(detail.value ?? "[]") as { name: string; type: string; dataBase64: string }[];
          current.attachFiles(files.map(file => new File([Uint8Array.from(atob(file.dataBase64), char => char.charCodeAt(0))], file.name, { type: file.type })));
        } catch { setPasteError(detail.action === "pickedFiles" ? "Couldn’t attach that file. Try again." : "Couldn’t paste that file. Try attaching it instead."); }
      }
      if (detail.action === "height") {
        const extra = Number(detail.value);
        if (Number.isFinite(extra)) form.current?.parentElement?.style.setProperty("--composer-extra-height", `${Math.max(0, Math.min(300, extra))}px`);
      }
      if (detail.action === "cancelReply") current.onCancelReply?.();
      if (detail.action === "stop") current.onStop?.();
      if (detail.action === "location") void current.shareLocation();
      if (detail.action === "removeLocation") current.removeLocation();
      if (detail.action === "photos") form.current?.querySelector<HTMLInputElement>('input[data-photos]')?.click();
      if (detail.action === "attach") form.current?.querySelector<HTMLInputElement>('input[type="file"]:not([data-photos])')?.click();
      if (detail.action === "cancelVoice") voiceControls.current?.cancel();
      if (detail.action === "voice") voiceControls.current?.toggle();
    };
    const blur = () => postNativeMessage({ version: 1, action: "composerBlur", payload: { id: composerId } });
    window.addEventListener("pointerdown", blur, { passive: true });
    window.addEventListener("decisionFeed:composerAction", receive);
    return () => { window.removeEventListener("pointerdown", blur); window.removeEventListener("decisionFeed:composerAction", receive); postNativeMessage({ version: 1, action: "composerHide", payload: { id: composerId } }); };
  }, [native, nativeChromeActive, composerId]);
  useEffect(() => {
    if (!native || !nativeChromeActive) return;
    const publish = () => postNativeMessage({ version: 1, action: "composerState", payload: {
      replyName: replyTo?.name ?? "", replyText: replyTo ? messagePreview(replyTo.text) : "",
      id: composerId, variant, value: nativeSendHold ?? value, placeholder, disabled: Boolean(disabled), sending: Boolean(sending || preparingFiles), fileCount, sendFlightSupported: true, sendMotionSamples,
      draftFiles: files.map(file => ({ id: draftFileId(file), name: file.name, mimeType: file.type, thumbnailBase64: thumbnails[draftFileId(file)] ?? "", description: fileDescription(file.name, file.type, file.size) })),
      location: location ? sharedLocationAccuracy(location) : "", locating,
      attachments: Boolean(onFiles), stoppable: Boolean(onStop), error: pasteError || composerError(locationError || error || voice.error || "", locationError ? "Couldn’t share your location. Try again." : error ? "Couldn’t send. Try again." : "Couldn’t use voice input. Try again."),
      voice: voice.state, voiceLevels: voice.levels, voiceElapsed: voice.elapsed,
    } });
    publish();
  }, [native, nativeChromeActive, composerId, variant, value, nativeSendHold, placeholder, disabled, sending, preparingFiles, fileCount, onFiles, onStop, files, thumbnails, error, pasteError, location, locating, locationError, voice, replyTo]);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focusRequest || !active || disabled) return;
    // Runs after composerState so native applies the new text before taking focus.
    if (native) { postNativeMessage({ version: 1, action: "composerFocus", payload: { id: composerId } }); return; }
    const input = area.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }, [focusRequest]); // eslint-disable-line react-hooks/exhaustive-deps
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.querySelector<HTMLElement>(variant === "home" ? ".wd-home-layer" : ".wd-front-layer")); }, [variant]);
  useLayoutEffect(() => {
    const input = area.current;
    if (!input) return;
    const resize = () => {
      input.style.height = "0px";
      const limit = 128;
      input.style.height = `${Math.min(limit, Math.max(40, input.scrollHeight))}px`;
      input.style.overflowY = input.scrollHeight > limit ? "auto" : "hidden";
      if (!native) host?.style.setProperty("--composer-extra-height", `${Math.max(0, input.offsetHeight - 40) + (form.current?.querySelector<HTMLElement>(".wd-draft-photo-region")?.offsetHeight ?? 0) + (form.current?.querySelector<HTMLElement>(".wd-reply-draft-region")?.offsetHeight ?? 0)}px`);
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (input.parentElement) observer.observe(input.parentElement);
    return () => observer.disconnect();
  }, [value, host, native, files, replyTo]);
  useEffect(() => {
    const input = area.current;
    const root = host?.closest<HTMLElement>(".wd");
    const viewport = window.visualViewport;
    if (!input || !root || !viewport) return;
    let height = 0;
    let restoreFrame = 0;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    // WebKit pans the page to reveal a bottom input before the keyboard resizes
    // the visual viewport. Focus without a visible reveal target for that frame.
    const pointerDown = (event: PointerEvent) => {
      if (!isIOS || input.disabled || document.activeElement === input || event.button !== 0) return;
      event.preventDefault();
      height = root.clientHeight;
      input.style.opacity = "0";
      input.focus({ preventScroll: true });
      restoreFrame = requestAnimationFrame(() => {
        input.style.removeProperty("opacity");
      });
    };
    const update = () => {
      if (!height) return;
      const keyboard = Math.max(0, height - viewport.height);
      root.style.height = `${height}px`;
      root.style.top = `${viewport.offsetTop}px`;
      root.style.setProperty("--keyboard-height", `${keyboard}px`);
      root.toggleAttribute("data-keyboard", keyboard > 80);
    };
    const focus = () => { height = root.clientHeight; update(); };
    const blur = () => {
      height = 0;
      root.style.removeProperty("height"); root.style.removeProperty("top");
      root.style.removeProperty("--keyboard-height"); root.removeAttribute("data-keyboard");
    };
    input.addEventListener("pointerdown", pointerDown);
    input.addEventListener("focus", focus); input.addEventListener("blur", blur);
    viewport.addEventListener("resize", update); viewport.addEventListener("scroll", update);
    return () => { cancelAnimationFrame(restoreFrame); input.style.removeProperty("opacity"); input.removeEventListener("pointerdown", pointerDown); input.removeEventListener("focus", focus); input.removeEventListener("blur", blur); viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update); blur(); };
  }, [host]);
  const canSend = !voiceBusy && !disabled && !sending && !preparingFiles && !locating && (value.trim().length > 0 || fileCount > 0 || Boolean(location));
  const content = (
    <form ref={form} aria-hidden={native || undefined} className={`wd-composer is-${variant}${replyTo ? " has-reply" : ""}${native ? " is-native" : ""}`} onSubmit={(event) => { event.preventDefault(); if (canSend) void send(); }}>
      {(pasteError || locationError || error || voice.error) && <p className="wd-composer-error" role="alert">{pasteError || composerError(locationError || error || voice.error, locationError ? "Couldn’t share your location. Try again." : undefined)}</p>}
      {(location || locating) && <div className="wd-location-draft" role="status"><span aria-hidden="true">⌖</span><span><strong>{locating ? "Finding your location…" : "Current location"}</strong><small>{locating ? "A one-time location" : `${sharedLocationAccuracy(location!)} · Attached to this message`}</small></span><button type="button" disabled={sending} aria-label={locating ? "Cancel location sharing" : "Remove location"} onClick={removeLocation}>×</button></div>}
      {menuOpen && <div className={`wd-attachment-menu${files.length ? " has-files" : ""}`} role="menu" aria-label="Attachments">
        {files.length > 0 && <DraftAttachments files={files} onRemove={onRemoveFile ? index => { onRemoveFile(index); setPasteError(null); } : undefined} />}
        {onFiles && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); form.current?.querySelector<HTMLInputElement>('input[data-photos]')?.click(); }}>Photo library</button>}
        {onFiles && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); form.current?.querySelector<HTMLInputElement>('input[type="file"]:not([data-photos])')?.click(); }}>Attach a file</button>}
        <button type="button" role="menuitem" onClick={() => void shareLocation()}>Share location</button>
      </div>}
      <div className="wd-composer-row">
        <span className="wd-composer-attachment-anchor">
        <button ref={attachmentButton} type="button" className="wd-composer-plus"
          aria-description={fileCount ? `${fileCount} files attached. Hold to view attachments.` : undefined}
          onPointerDown={event => {
            held.current = false; cancelHold();
            if (event.button !== 0 || !event.isPrimary || !files.length || voiceBusy) return;
            holdOrigin.current = { x: event.clientX, y: event.clientY };
            hold.current = setTimeout(() => { held.current = true; setMenuOpen(true); hold.current = null; }, 420);
          }}
          onPointerMove={event => { if (Math.hypot(event.clientX - holdOrigin.current.x, event.clientY - holdOrigin.current.y) > 10) cancelHold(); }}
          onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}
          onContextMenu={event => { if (files.length && !voiceBusy) { event.preventDefault(); cancelHold(); held.current = true; setMenuOpen(true); } }} aria-label={voiceBusy ? "Cancel dictation" : "Add attachment"} aria-haspopup={voiceBusy ? undefined : "menu"} aria-expanded={voiceBusy ? undefined : menuOpen} disabled={!voiceBusy && (disabled || sending || locating)} onClick={() => { if (held.current) { held.current = false; return; } if (voiceBusy) voiceControls.current?.cancel(); else setMenuOpen(!menuOpen); }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d={voiceBusy ? "m6 6 12 12M18 6 6 18" : "M12 5v14M5 12h14"} /></svg>{fileCount > 0 && !voiceBusy && <b>{fileCount}</b>}</button>
        {/* Native WebKit capture returns a temporary attachment; never invoke savePhotos here. */}
        {onFiles && <input className="wd-file-input" data-photos aria-hidden="true" tabIndex={-1} type="file" multiple accept="image/*" disabled={disabled || sending} onChange={event => { attachFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />}
        {onFiles && <input className="wd-file-input" aria-hidden="true" tabIndex={-1} type="file" multiple accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx" disabled={disabled || sending} onChange={(event) => { attachFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />}
        </span>

        <div className="wd-composer-field">
      {replyTo && <div className="wd-reply-draft-region"><div className="wd-reply-draft"><span><strong>Replying to {replyTo.name}</strong><span>{messagePreview(replyTo.text)}</span></span><button type="button" aria-label="Cancel reply" onPointerDown={event => event.preventDefault()} onClick={onCancelReply}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div></div>}
          <DraftPhotos files={files} onRemove={onRemoveFile} />

        <textarea
          ref={area}
          rows={1}
          enterKeyHint="send"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={placeholder}
          maxLength={4_000}
          onPaste={event => {
            const files = Array.from(event.clipboardData.files);
            if (!files.length) for (const item of Array.from(event.clipboardData.items)) {
              const file = item.kind === "file" ? item.getAsFile() : null;
              if (file) files.push(file);
            }
            if (!files.length || !onFiles) return;
            event.preventDefault();
            attachFiles(files);
          }}
          onChange={(event) => { onChange(event.target.value); }}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSend) void send(); } }}
        />
        {canSend
          ? <button type="submit" className="wd-composer-send" aria-label="Send" onPointerDown={event => event.preventDefault()}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg></button>
          : <VoiceInput controls={voiceControls} active={active} onStateChange={setVoice} disabled={disabled || sending || locating} onTranscript={(text) => { onChange([value.trim(), text].filter(Boolean).join(" ")); }} />}
        {onStop && !voiceBusy && !value.trim() && !fileCount && !location && <button type="button" className="wd-composer-stop" aria-label="Stop task" disabled={disabled || sending} onPointerDown={event => event.preventDefault()} onClick={onStop}><span aria-hidden="true" /></button>}

        </div>
      </div>
    </form>
  );
  return host ? createPortal(content, host) : null;
}
