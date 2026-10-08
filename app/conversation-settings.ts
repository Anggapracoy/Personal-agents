'use client';
import equal from 'fast-deep-equal';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyConversationAction, type ConversationMessage, type ConversationMessages, type ConversationAction, type ConversationSettings } from '../lib/conversation-settings';
import { updateConversationListSettings } from './conversation-list-cache';
import { uiPreviewConversationMessages } from './preview-fixtures';
import { responseError } from './native-bridge';

export function useConversationSettings(email: string, previewMode: boolean) {
  const [settings, setSettings] = useState<ConversationSettings>({});
  const [messages, setMessages] = useState<ConversationMessages>({});
  const remoteMessages = useRef<ConversationMessages>({});
  const outgoing = useRef(new Map<string, ConversationMessage>());
  const receiveMessages = (remote: ConversationMessages) => {
    remote = { ...remote };
    for (const [key, saved] of Object.entries(remote)) {
      const previous = remoteMessages.current[key];
      if (previous && Date.parse(previous.createdAt) > Date.parse(saved.createdAt)) remote[key] = previous;
    }
    remoteMessages.current = remote;
    const merged = { ...remote };
    for (const [key, local] of outgoing.current) {
      const saved = remote[key];
      if (saved && ((!local.reaction && saved.kind === 'user' && saved.text === local.text) || Date.parse(saved.createdAt) >= Date.parse(local.createdAt))) outgoing.current.delete(key);
      else merged[key] = { ...local, unreadCount: saved?.unreadCount ?? local.unreadCount,
        incomingAt: Date.parse(saved?.incomingAt ?? '') > Date.parse(local.incomingAt ?? '') ? saved?.incomingAt : local.incomingAt ?? saved?.incomingAt };
    }
    setMessages(previous => equal(previous, merged) ? previous : merged);
  };
  const publishReceived = (key: string, message: ConversationMessage) => {
    const previous = outgoing.current.get(key) ?? remoteMessages.current[key];
    if (previous && Date.parse(previous.createdAt) > Date.parse(message.createdAt)) return;
    outgoing.current.set(key, { ...message, incomingAt: message.kind === 'agent' ? message.createdAt : previous?.incomingAt, unreadCount: previous?.unreadCount ?? 0 });
    receiveMessages(remoteMessages.current);
  };
  const publishOutgoing = (key: string, text: string, reaction = false) => {
    const previous = remoteMessages.current[key];
    const local: ConversationMessage = { kind: 'user', text, ...(reaction ? { reaction: true } : {}), createdAt: new Date().toISOString(), unreadCount: previous?.unreadCount ?? 0,
      incomingAt: previous?.incomingAt ?? (previous?.kind !== 'user' ? previous?.createdAt : undefined) };
    outgoing.current.set(key, local);
    setMessages(current => ({ ...current, [key]: local }));
    return () => {
      if (outgoing.current.get(key) !== local) return;
      outgoing.current.delete(key); receiveMessages(remoteMessages.current);
    };
  };
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = useRef(settings); current.current = settings;
  const pending = useRef(false);
  const queued = useRef<ConversationAction[]>([]);
  const confirmed = useRef<ConversationSettings>({});
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const epoch = useRef(0);
  const previewKey = `wdyt-preview-conversations:${email}`;
  useEffect(() => {
    let disposed = false;
    outgoing.current.clear(); remoteMessages.current = {}; setMessages({});
    if (previewMode) {
      try { const saved = localStorage.getItem(previewKey); if (saved) { confirmed.current = JSON.parse(saved); setSettings(confirmed.current); } } catch { /* Fresh preview. */ }
      receiveMessages(uiPreviewConversationMessages); setReady(true); return;
    }
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || pending.current || document.hidden) return;
      refreshing = true;
      const generation = epoch.current;
      try {
        const response = await fetch('/api/conversations', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(await responseError(response, 'Your saved conversation settings could not be loaded.'));
        const result = await response.json() as { settings: ConversationSettings; messages: ConversationMessages };
        if (!disposed && generation === epoch.current) { confirmed.current = result.settings; current.current = result.settings; setSettings(previous => equal(previous, result.settings) ? previous : result.settings); receiveMessages(result.messages); setReady(true); }
      } catch (caught) { if (!disposed) setError(caught instanceof Error ? caught.message : 'Could not load conversations.'); }
      finally { refreshing = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [previewMode, previewKey]);
  const apply = useCallback((action: ConversationAction): Promise<boolean> => {
    if (!ready) return Promise.resolve(false);
    // Reads must survive another mutation in flight and leaving the chat before
    // the response arrives. Only reads are optimistic; server rules govern edits.
    if (action.action === 'read' && !queued.current.some(item => item.key === action.key && item.action === 'unread') && !current.current[action.key]?.markedUnread &&
        Date.parse(current.current[action.key]?.lastReadAt ?? '') >= Date.parse(action.through)) return Promise.resolve(true);
    queued.current.push(action);
    pending.current = true; epoch.current++; setBusy(true); setError('');
    const publish = () => {
      const next = queued.current.reduce((value, item) => item.action === 'read' ? applyConversationAction(value, item) : value, confirmed.current);
      if (!previewMode) updateConversationListSettings(email, next);
      current.current = next; setSettings(next);
    };
    publish();
    const result = tail.current.then(async () => {
      let succeeded = false;
      try {
        if (previewMode) {
          const saved = applyConversationAction(confirmed.current, action);
          localStorage.setItem(previewKey, JSON.stringify(saved));
          confirmed.current = saved;
        } else {
          const response = await fetch('/api/conversations', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) });
          if (!response.ok) throw new Error(await responseError(response, 'The conversation could not be updated. Try again.'));
          confirmed.current = (await response.json() as { settings: ConversationSettings }).settings;
        }
        succeeded = true;
      } catch (caught) { setError(caught instanceof Error ? caught.message : 'The conversation could not be updated.'); }
      finally {
        queued.current.shift();
        publish();
        pending.current = queued.current.length > 0;
        setBusy(pending.current);
      }
      return succeeded;
    });
    tail.current = result;
    return result;
  }, [ready, previewMode, previewKey, email]);
  const refresh = async () => {
    if (previewMode) return;
    await tail.current;
    const generation = ++epoch.current;
    const response = await fetch('/api/conversations', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('Couldn’t refresh conversations.');
    const result = await response.json() as { settings: ConversationSettings; messages: ConversationMessages };
    if (generation !== epoch.current) return;
    confirmed.current = result.settings; current.current = result.settings;
    setSettings(previous => equal(previous, result.settings) ? previous : result.settings); receiveMessages(result.messages); setReady(true); setError('');
  };
  return { settings, messages, ready, busy, error, apply, refresh, publishOutgoing, publishReceived };
}
