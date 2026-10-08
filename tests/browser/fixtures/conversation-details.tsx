import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { TaskScreen } from '../../../app/task-screen';
import { ConversationDetailsContext } from '../../../app/conversation-details-context';
import { applyConversationAction, type ConversationSetting } from '../../../lib/conversation-settings';

const pdf = { id: 'doc', name: 'Itinerary.pdf', mimeType: 'application/pdf', description: 'PDF file · 12 KB', url: '/api/files/itinerary' };
const photo = { id: 'photo', url: '/api/files/photo', description: 'Lisbon by the river' };
function Fixture() {
  const [setting, setSetting] = useState<ConversationSetting>({});
  return <div className="wd"><ConversationDetailsContext.Provider value={{ setting, save: async action => {
    const response = await fetch('/api/save-identity', { method: 'POST' });
    if (!response.ok) return false;
    setSetting(current => applyConversationAction({ chat: current }, { ...action, key: 'chat' }).chat); return true;
  } }}><div className="wd-front-layer"><TaskScreen title={setting.title || 'Trip to Lisbon'} conversationId="chat" kind="plane" state="watch" statusLabel="" onBack={() => {}} items={[
    { id: 'user', kind: 'user', text: 'Here is the itinerary.', files: [pdf], photos: [photo] },
    { id: 'agent', kind: 'agent', text: 'Your updated files.', files: [pdf, { ...pdf, id: 'notes', url: '/api/files/notes', name: 'Travel notes.txt', mimeType: 'text/plain' }], photos: [photo] },
  ]} /></div></ConversationDetailsContext.Provider></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
