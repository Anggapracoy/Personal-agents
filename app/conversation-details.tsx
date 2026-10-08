"use client";
import { useContext, useLayoutEffect, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ThreadItem } from '../lib/harness/thread';
import { CHARACTERS } from '../lib/conversation-character';
import { conversationAvatarSchema, type ConversationAvatar } from '../lib/conversation-settings';
import { ConversationDetailsContext } from './conversation-details-context';
import { postNativeMessage } from './native-bridge';
import { TaskIcon } from './task-icon';
import { NativeGlassButton } from './native-glass-button';
import { useConversationDetailsMotion, type DetailsOrigin } from './conversation-details-motion';
import { messageLinks, messageLinkLabels } from '../lib/link-preview';
import { MessageLinkPreview } from './message-link-preview';
import { FileMessage } from './file-message';
import { PhotoMessage } from './photo-message';
import { VideoMessage } from './video-message';

/** Only attachments actually shared in the transcript belong in chat details. */
export function conversationAttachments(items: ThreadItem[]) {
  const seen = new Set<string>();
  const photos: NonNullable<Extract<ThreadItem, { kind: 'agent' }>['photos']> = [];
  const files: NonNullable<Extract<ThreadItem, { kind: 'agent' }>['files']> = [];
  const videos: NonNullable<Extract<ThreadItem, { kind: 'agent' }>['videos']> = [];
  for (const item of [...items].reverse()) {
    if (item.kind !== 'user' && item.kind !== 'agent') continue;
    const append = <T extends { url: string }>(target: T[], entries: T[] = []) => {
      for (const entry of entries) {
        if (seen.has(entry.url)) continue;
        seen.add(entry.url);
        target.push(entry);
      }
    };
    append(photos, item.photos);
    append(files, item.files);
    if (item.kind === 'agent') append(videos, item.videos);
  }
  return { photos, files, videos };
}

async function avatarPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a photo.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Could not prepare this photo.');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.fillStyle = '#fff'; context.fillRect(0, 0, 256, 256);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    const value = canvas.toDataURL('image/jpeg', .8);
    if (value.length > 90000) throw new Error('Try a smaller photo.');
    return value;
  } finally { URL.revokeObjectURL(url); }
}

export function ConversationDetails({ title, conversationId, items, origin, loadingLabel, onClose }: { origin: DetailsOrigin; loadingLabel?: string; title: string; conversationId: string; items: ThreadItem[]; onClose: () => void }) {
  const identity = useContext(ConversationDetailsContext);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(title);
  const [avatar, setAvatar] = useState<ConversationAvatar | undefined>(identity?.setting?.avatar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { sheetRef, scrimRef, close } = useConversationDetailsMotion(origin, onClose);
  const { photos, files, videos } = conversationAttachments(items);
  const links = [...new Set([...items].reverse().flatMap(item => item.kind === 'user' || item.kind === 'agent' ? messageLinks(item.text, Infinity).urls : []))];
  const linkLabels = new Map(items.flatMap(item => item.kind === 'user' || item.kind === 'agent' ? [...messageLinkLabels(item.text)] : []));
  useLayoutEffect(() => {
    postNativeMessage({ version: 1, action: 'modalOverlayVisibility', payload: { visible: true, hidesNavigation: true } });
    return () => postNativeMessage({ version: 1, action: 'modalOverlayVisibility', payload: { visible: false, hidesNavigation: false } });
  }, []);
  useEffect(() => {
    const previous = (document.activeElement !== document.body ? document.activeElement : document.querySelector(".wd-taskbar-title")) as HTMLElement | null;
    const dialog = sheetRef.current!; dialog.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)')].filter(node => node.getClientRects().length && node.tabIndex !== -1);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first?.focus(); }
    };
    dialog.addEventListener('keydown', key);
    return () => { dialog.removeEventListener('keydown', key); previous?.focus({ preventScroll: true }); };
  }, [close, sheetRef]);
  const editMotion = useRef<(() => void) | null>(null);
  useEffect(() => () => editMotion.current?.(), []);
  const changeEditing = (next: boolean) => {
    editMotion.current?.();
    const content = sheetRef.current?.querySelector<HTMLElement>('.wd-details-scroll');
    if (!content) { setEditing(next); return; }
    (document.activeElement as HTMLElement | null)?.blur();
    const outgoing = content.cloneNode(true) as HTMLElement;
    outgoing.querySelector<HTMLElement>('.wd-details-identity > .wd-icon')!.style.visibility = 'hidden';
    outgoing.inert = true;
    outgoing.setAttribute('aria-hidden', 'true');
    Object.assign(outgoing.style, { position: 'absolute', top: `${content.offsetTop}px`, left: '0', width: '100%', height: `${content.offsetHeight}px`, pointerEvents: 'none', zIndex: '1' });
    content.parentElement!.append(outgoing);
    outgoing.scrollTop = content.scrollTop;
    flushSync(() => setEditing(next));
    content.scrollTop = 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const distance = reduced ? 0 : next ? 10 : -10;
    const options = { duration: reduced ? 120 : 240, easing: 'cubic-bezier(.2,.75,.2,1)' };
    const leaving = outgoing.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-distance}px)` }], { ...options, fill: 'forwards' });
    const arriving = [...content.querySelectorAll<HTMLElement>(':scope > :not(.wd-details-identity), :scope > .wd-details-identity > :not(.wd-icon)')].map(node => node.animate([{ opacity: 0, transform: `translateX(${distance}px)` }, { opacity: 1, transform: 'translateX(0)' }], options));
    const cleanup = () => { leaving.cancel(); arriving.forEach(animation => animation.cancel()); outgoing.remove(); };
    editMotion.current = cleanup;
    void Promise.all([leaving.finished, ...arriving.map(animation => animation.finished)]).then(() => {
      cleanup();
      if (editMotion.current === cleanup) editMotion.current = null;
    }).catch(() => {});
  };
  const save = async () => {
    if (!identity || busy) return;
    if (avatar && !conversationAvatarSchema.safeParse(avatar).success) { setError('Choose a single emoji or a photo.'); return; }
    setBusy(true); setError('');
    try {
      if (!await identity.save({ action: 'identity', title: name.trim(), avatar: avatar ?? null })) throw new Error('Couldn’t save your changes. Try again.');
      changeEditing(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Couldn’t save your changes.'); }
    finally { setBusy(false); }
  };
  return <div className="wd-sheet-root wd-details-root">
    <button ref={scrimRef} className="wd-sheet-scrim" aria-label="Dismiss chat details" onClick={close} />
    <section ref={sheetRef} className="wd-details-panel" role="dialog" aria-modal="true" aria-label="Chat details" tabIndex={-1}>
      <header className="wd-details-toolbar">
        <NativeGlassButton symbol="chevron.left" aria-label={editing ? 'Cancel editing' : 'Back to chat'} onClick={() => { if (editing) { changeEditing(false); setError(''); } else close(); }} disabled={busy}>‹</NativeGlassButton>
        {editing && <NativeGlassButton symbol="checkmark" text="Done" className="wd-details-edit" disabled={!identity || busy || !name.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Done'}</NativeGlassButton>}
      </header>
      <div className="wd-details-scroll">
        <div className="wd-details-identity">
          <TaskIcon conversationId={conversationId} avatar={editing ? avatar : identity?.setting?.avatar} size={112} />
          {!editing && <NativeGlassButton symbol="pencil" visualSize={38} type="button" className="wd-profile-photo-edit wd-details-avatar-edit" aria-label="Edit" disabled={!identity || busy} onClick={() => { setName(title); setAvatar(identity?.setting?.avatar); setError(''); changeEditing(true); }}><span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5M4 15 16 3a2 2 0 0 1 5 5L9 20l-6 1z" /></svg></span></NativeGlassButton>}
          {editing ? <label className="wd-details-name">Chat name<input aria-label="Chat name" maxLength={120} value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label> : <h1>{title}</h1>}
        </div>
        {editing ? <div className="wd-details-editor">
          <p className="wd-details-caption">Choose an icon</p>
          <div className="wd-character-options">{CHARACTERS.map((character, index) => <button key={character.name} disabled={busy} aria-label={`Use ${character.name}`} aria-pressed={avatar?.type === 'character' && avatar.index === index} onClick={() => setAvatar({ type: 'character', index })}><TaskIcon conversationId={conversationId} avatar={{ type: 'character', index }} size={52} /></button>)}</div>
          <label className="wd-details-emoji">Emoji<input aria-label="Chat emoji" placeholder="Emoji" maxLength={32} value={avatar?.type === 'emoji' ? avatar.value : ''} disabled={busy} onChange={event => setAvatar(event.target.value ? { type: 'emoji', value: event.target.value } : undefined)} /></label>
          <input ref={input} hidden type="file" accept="image/*" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; setBusy(true); setError(''); try { setAvatar({ type: 'photo', value: await avatarPhoto(file) }); } catch { setError('Couldn’t open that photo. Try another image.'); } finally { setBusy(false); } }} />
          <button className="wd-details-option" disabled={busy} onClick={() => input.current?.click()}>Choose photo</button>
        </div> : <section className="wd-details-files" aria-label="Shared files">
          <h2>Files <span>{photos.length + files.length + videos.length || ''}</span></h2>
          {!photos.length && !files.length && !videos.length ? <div className="wd-details-empty"><svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M8 14h8M8 17h5"/></svg><h3>{loadingLabel || "No files yet"}</h3><p>{loadingLabel ? "Files will appear when the conversation loads." : "Photos, videos, and documents shared in this chat will appear here."}</p></div> : <>
            {photos.length > 0 && <PhotoMessage photos={photos} />}
            {videos.length > 0 && <VideoMessage videos={videos} />}
            {files.length > 0 && <FileMessage files={files} />}
          </>}
        </section>}
        {!editing && links.length > 0 && <section className="wd-details-files wd-details-links" aria-label="Shared links">
          <h2>Links <span>{links.length}</span></h2>
          <div className="wd-details-link-list">{links.map(url => <MessageLinkPreview key={url} url={url} name={linkLabels.get(url)} />)}</div>
        </section>}
        {error && <p className="wd-details-error" role="alert">{error}</p>}
      </div>
    </section>
  </div>;
}
