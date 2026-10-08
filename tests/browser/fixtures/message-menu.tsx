import { createRoot } from 'react-dom/client';
import { MessageReaction } from '../../../app/message-reaction';
(window as any).menuFeedback = [];
(window as any).webkit = { messageHandlers: { decisionFeedNative: { postMessage: (message: unknown) => (window as any).menuFeedback.push(message) } } };
createRoot(document.getElementById('root')!).render(<div className="wd"><main className="wd-task" style={{ padding: '220px 24px 0' }}><MessageReaction text="Tuesday works for me." onReact={async () => {}} onReply={() => {}}><div className="wd-agent">Tuesday works for me.</div></MessageReaction></main></div>);
