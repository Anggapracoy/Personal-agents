import {createRoot} from 'react-dom/client';
import {SensitiveActionCard} from '../../../app/approvals';
import type {RunningTask} from '../../../lib/types';
const task={id:'email-demo',runId:'email-demo',actionId:'draft-review',status:'needs_approval',title:'Meeting availability',approvalKind:'email_send',approvalRequest:{to:['recipient@example.com'],subject:'Re: Meeting availability',body:'Hi Alex,\n\nThe proposed time works well for me. Thank you for coordinating!\n\nBest,\nTaylor'}} as RunningTask;
createRoot(document.getElementById('root')!).render(<main className="wd" style={{padding:16,minHeight:'100vh',background:'var(--paper)'}}><SensitiveActionCard task={task} denying={false} onApprove={async mode=>{document.body.dataset.approvalMode=mode;return true;}} onDeny={()=>{}}/></main>);
