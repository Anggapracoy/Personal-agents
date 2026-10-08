import { createRoot } from 'react-dom/client';
import { TaskScreen } from '../../../app/task-screen';

const files = [
  { id: 'pdf', name: 'Trip itinerary.pdf', description: 'Your complete itinerary', mimeType: 'application/pdf' },
  { id: 'xlsx', name: 'Trip budget.xlsx', description: 'Editable budget spreadsheet', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { id: 'custom', name: 'Project files.custom', description: 'Original project file', mimeType: 'application/octet-stream' },
].map(file => ({ ...file, url: `/api/runs/file-test/artifacts/${file.id}` }));
createRoot(document.getElementById('root')!).render(<div className="wd"><div className="wd-front-layer"><TaskScreen
  conversationId="file-test" title="Your trip" kind="plane" state="watch" statusLabel="" onBack={() => {}}
  onReact={async () => {}} items={[
    { id: 'uploaded', kind: 'user', text: 'Please review this document.\n\nAttached: My report.pdf', localFiles: [new File(['local document bytes'], 'My report.pdf', { type: 'application/pdf' })], createdAt: '2026-09-17T11:59:00Z' },
    { id: 'request', kind: 'user', text: 'Send me the itinerary and files.', createdAt: '2026-09-17T12:00:00Z' },
    { id: 'delivery', kind: 'agent', text: 'Here are your files.', fileCaption: 'Here are your files.', files, createdAt: '2026-09-17T12:00:05Z' },
  ]}
/></div></div>);
