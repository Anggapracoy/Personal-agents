import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { TaskScreen } from '../../../app/task-screen';
import { prepareMessageSend } from '../../../app/message-send-motion';
import type { ThreadItem } from '../../../lib/harness/thread';

function Fixture({ restored = false }: { restored?: boolean }) {
  const [items, setItems] = useState<ThreadItem[]>([
    ...((window as any).cachedGenericReceipts ?? []),
    { id: 'opening', kind: 'agent', text: 'I can check that for you.', createdAt: '2026-09-15T12:00:00Z' },
    { id: 'failed-message', kind: 'user', text: 'This earlier message failed.', createdAt: '2026-09-15T12:00:30Z', deliveryState: 'failed' },
    ...(restored ? [{ id: 'server-reply', kind: 'user' as const, text: 'Try a different approach.', createdAt: '2026-09-15T12:02:00Z' }] : []),
  ]);
  const [resolved, setResolved] = useState(restored);
  const [waiting, setWaiting] = useState(!restored);
  const [lateError, setLateError] = useState(false);
  const [native, setNative] = useState(false);
  const send = () => {
    prepareMessageSend(document.querySelector('form'), 'Try a different approach.', native ? { x: 80, y: 750, width: 220, height: 24 } : undefined);
    flushSync(() => setItems(old => [...old, { id: 'reply', kind: 'user', text: 'Try a different approach.', createdAt: '2026-09-15T12:02:00Z', deliveryState: 'sending' }]));
    setTimeout(() => { setResolved(true); setItems(old => old.map(item => item.id === 'reply' ? { ...item, id: 'server-reply', deliveryState: undefined } as ThreadItem : item)); }, 60);
  };
  (window as any).inlineTest = { send, resolve: () => setResolved(true), stop: () => setWaiting(false), native: () => setNative(true), error: () => setLateError(true) };
  return <div className="wd"><div className="wd-front-layer"><TaskScreen
    conversationId="inline-test" title="Check the delivery" kind="doc" state="watch" statusLabel="" items={resolved ? [...items, { id: "answers:1", kind: "answers", compact: true, createdAt: "2026-09-15T12:01:30Z", answers: [{ question: "Login details", answer: "Provided securely" }] }].sort((a, b) => ("createdAt" in a ? a.createdAt ?? "" : "").localeCompare("createdAt" in b ? b.createdAt ?? "" : "")) as ThreadItem[] : items} onBack={() => {}}
    onRetrySend={id => setItems(old => old.map(item => item.id === id ? { ...item, deliveryState: undefined } as ThreadItem : item))}
    inlinePanels={[
      ...(lateError ? [{ id: "late-error", summary: "Earlier attempt failed.", node: <p className="wd-card-error">A new error arrived.</p> }] : []),
      ...(!resolved ? [{ id: 'approval:1', replaces: 'answers:1', createdAt: '2026-09-15T12:01:00Z', summary: '', node: <section className="wd-card"><h3>Confirm your choice</h3><p>Check this before I continue.</p><button className="wd-btn">Confirm</button></section> },
      { id: 'error', createdAt: '2026-09-15T12:01:01Z', summary: 'Attempt couldn’t finish.', node: <div className="wd-inline-stack"><p className="wd-card-error">Couldn’t finish this attempt.</p><button className="wd-btn is-secondary" onClick={() => setResolved(true)}>Try again</button></div> }] : []),
      ...(waiting ? [{ id: 'wait', createdAt: '2026-09-15T12:01:02Z', summary: 'Waiting ended', node: <section className="wd-card"><h3>Waiting</h3><p>I’ll check again when the delivery updates.</p></section> }] : []),
    ]}
    footer={<form className={`wd-composer${native ? ' is-native' : ''}`} onSubmit={e => e.preventDefault()}><textarea defaultValue="Try a different approach." /><button type="button" onClick={send}>Send</button></form>}
  /></div></div>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<Fixture restored={Boolean((window as any).restoreInlineFixture)} />);
(window as any).remountInline = () => root.render(<Fixture key="restored" restored />);
