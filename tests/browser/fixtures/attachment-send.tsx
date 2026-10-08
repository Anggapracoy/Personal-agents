import { createRoot } from 'react-dom/client';
import { TaskRoute, type TaskActions } from '../../../app/task-route';
const w = window as any;
w.sentFiles = [];
const actions = { onBack() {}, onReply: async (_id: string, _text: string, files: File[]) => {
  w.sentFiles = files;
  await new Promise<void>((resolve, reject) => { w.finishSend = (success: boolean) => success ? resolve() : reject(new Error('Offline')); });
} } as unknown as TaskActions;
createRoot(document.getElementById('root')!).render(<div className="wd"><div className="wd-front-layer"><TaskRoute id="attachment-send" decisions={[]} tasks={[]} history={[]} snapshots={new Map()} previewMode={false} messageCache={new Map([["attachment-send", []]])} actions={actions} /></div></div>);
