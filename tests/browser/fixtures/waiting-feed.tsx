import { createRoot } from 'react-dom/client';
import { Row } from '../../../app/home';
import { conversationItems } from '../../../app/conversations';
import type { RunningTask } from '../../../lib/types';
const tasks: RunningTask[] = [null, 'gmail_reply'].map((eventKind, index) => ({ id: `task-${index}`, runId: `run-${index}`, decisionId: `decision-${index}`, category: 'travel', title: index ? 'Waymo in Toronto' : 'Follow up tomorrow', subtitle: 'Stale message', status: 'waiting', chosenOption: '', originalContext: '', updatedAt: '2026-09-26T02:08:00Z', automaticPause: { id: `pause-${index}`, ready: true, reason: 'Waiting for a reply', wakeAt: '2026-09-29T02:08:00Z', eventKind: eventKind as 'gmail_reply' | null } }));
const rows = conversationItems([], tasks, []);
createRoot(document.getElementById('root')!).render(<div className="wd"><div style={{ paddingTop: 64 }}>{rows.map(item => <Row key={item.id} item={item} onOpen={() => {}} />)}</div></div>);
