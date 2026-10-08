import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskScreen } from '../../../app/task-screen';
import { WaitStatus } from '../../../app/conversation-status';
import { includeWaitSummaries } from '../../../lib/harness/wait-summary';
import type { ThreadItem } from '../../../lib/harness/thread';
import type { AgentAction } from '../../../lib/harness/types';
const pause = { id: 'one', ready: true, reason: 'Waiting for the restaurant to open', wakeAt: '2026-09-28T20:00:00Z', eventKind: null };
const action = { id: 'action', toolName: 'pause', status: 'executed', createdAt: '2026-09-28T12:01:00Z', input: {}, result: { saved: true, ...pause } } as unknown as AgentAction;
function Fixture() {
 const [active, setActive] = useState(!(window as any).restoredWait);
 const [later, setLater] = useState(Boolean((window as any).restoredWait));
 const items = includeWaitSummaries<ThreadItem>([
  { id: 'opening', kind: 'agent', text: 'I’ll check again when they open.', createdAt: '2026-09-28T12:00:00Z' },
  ...(!active ? [{ id: 'result', kind: 'agent' as const, text: 'They’re open. I can call them now.', createdAt: '2026-09-28T20:00:00Z' }] : []),
  ...(later ? [{ id: 'reply', kind: 'user' as const, text: 'Yes, please.', createdAt: '2026-09-28T20:01:00Z' }] : []),
 ], [action], active ? pause : undefined);
 (window as any).waitTest = { end: () => setActive(false), reply: () => setLater(true) };
 return <div className="wd"><div className="wd-front-layer"><TaskScreen conversationId="wait-receipt-test" title="Dinner plans" kind="doc" state="watch" statusLabel="" onBack={() => {}} items={items}
 inlinePanels={active ? [{ id: 'pause:one', replaces: 'wait:one', createdAt: action.createdAt, summary: 'Waiting ended', node: <WaitStatus pause={pause} /> }] : []}
 footer={<form className="wd-composer"><textarea placeholder="Reply…" /></form>} /></div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
