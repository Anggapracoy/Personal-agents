import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageReaction } from '../../../app/message-reaction';
const state = window as any;
state.__decisionFeedNativeMessageMenus = true;
state.menuFeedback = [];
state.webkit = { messageHandlers: { decisionFeedNative: { postMessage: (message: unknown) => state.menuFeedback.push(message) } } };
function Fixture() {
  const [shown, setShown] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  state.hideMessages = () => setShown(false);
  return <div className="wd"><main className="wd-task" style={{ padding: '180px 24px 0' }}>{shown && <>
    <MessageReaction text="First message" onReply={() => { state.replied = 'first'; }} onReact={async emoji => {
      if (state.delayReaction) await new Promise<void>((resolve, reject) => { state.finishReaction = resolve; state.rejectReaction = () => reject(new Error('offline')); });
      if (state.failReaction) throw new Error('offline');
      state.reacted = emoji; setSelected(emoji);
    }} reactions={selected ? [{ actor: 'user', emoji: selected, createdAt: '' }] : []}><div className="wd-agent">First message <a href="https://example.com">Link</a></div></MessageReaction>
    <MessageReaction text="Second message" onReply={() => { state.replied = 'second'; }}><div className="wd-agent">Second message</div></MessageReaction>
  </>}</main></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
