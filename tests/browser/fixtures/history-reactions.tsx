import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskRoute, type TaskActions } from '../../../app/task-route';
import type { HistoryEntry } from '../../../lib/types';
const w = window as any;
w.__decisionFeedNativeMessageMenus = location.search.includes('native=1');
w.menuFeedback = [];
w.webkit = { messageHandlers: { decisionFeedNative: { postMessage: (message: unknown) => w.menuFeedback.push(message) } } };
function Fixture() {
  const [entry, setEntry] = useState<HistoryEntry>({ id:'history-offer', decisionId:'offer', category:'money', title:'Subscription renewal', subtitle:'You decided not to act', contextSummary:'Keep your current subscription?', originalContext:'Renewal', time:'Now', group:'TODAY', status:'dismissed', chosenOption:'Leave it', outcome:'', steps:[], responseDisposition:'reaction', choiceAcknowledgment:'👍' });
  const actions = {
    onBack: () => {},
    onEntryReaction: async (_entry: HistoryEntry, id: string, emoji: string | null) => setEntry(current => ({...current, messageReactions:{...current.messageReactions, [id]:emoji ? [{actor:'user',emoji,createdAt:''}] : []}})),
  } as unknown as TaskActions;
  return <div className="wd"><TaskRoute id={entry.id} decisions={[]} tasks={[]} history={[entry]} snapshots={new Map()} previewMode actions={actions} /></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
