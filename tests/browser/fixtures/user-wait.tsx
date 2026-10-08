import { createRoot } from 'react-dom/client';
import { TakeoverCard } from '../../../app/approvals';
import type { RunningTask } from '../../../lib/types';
const task = { title: 'Sign in', approvalRequest: { pageUrl: 'https://accounts.google.com', reason: 'Approve the sign-in prompt on your phone, then continue here.', mode: new URLSearchParams(location.search).has('browser') ? 'browser' : 'wait_for_user' } } as RunningTask;
createRoot(document.getElementById('root')!).render(<div className="wd" style={{padding:16}}><TakeoverCard task={task} skipping={false} onOpenBrowser={() => { document.body.dataset.opened = 'true'; }} onSkip={() => { document.body.dataset.skipped = 'true'; }} onContinue={async () => { document.body.dataset.continued = 'true'; return true; }} /></div>);
