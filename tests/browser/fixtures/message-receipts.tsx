import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskScreen } from '../../../app/task-screen';
import type { ThreadItem } from '../../../lib/harness/thread';

function Fixture() {
  const [state, setState] = useState<'waiting' | 'sending' | 'sent' | 'answered' | 'failed'>('waiting');
  (window as any).receiptTest = { setState };
  const items: ThreadItem[] = [
    { id: 'question', kind: 'agent', text: 'Which delivery day works?', createdAt: '2026-09-20T12:00:00Z' },
    ...(state !== 'waiting' ? [{ id: 'reply', kind: 'user' as const, text: 'Tuesday please', createdAt: '2026-09-20T12:01:00Z', deliveryState: state === 'sending' ? 'sending' as const : state === 'failed' ? 'failed' as const : undefined }] : []),
    // The server saves the question response after the user message. It renders
    // back at the original question, not as the last conversational message.
    { id: 'answers:question', kind: 'answers', createdAt: '2026-09-20T12:01:01Z', answers: [{ question: 'Delivery', answer: 'Tuesday' }] },
    ...(state === 'answered' ? [{ id: 'agent-reply', kind: 'agent' as const, text: 'Tuesday it is.', createdAt: '2026-09-20T12:02:00Z' }] : []),
  ];
  return <div className="wd"><div className="wd-front-layer"><TaskScreen conversationId="receipt-test" title="Delivery" kind="doc" state="need" statusLabel="Needs you" onBack={() => {}} items={items} inlinePanels={[{ id: 'approval:question', createdAt: '2026-09-20T12:00:01Z', replaces: 'answers:question', summary: '', node: <section className="wd-card"><strong>Which delivery day works?</strong><p>Choose a day or send a message.</p></section> }]} /></div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
