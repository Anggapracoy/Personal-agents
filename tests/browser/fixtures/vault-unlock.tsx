import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InlinePanelContent } from '../../../app/inline-panel';
import { AnswersSummary } from '../../../app/conversation-status';
import { VaultCard } from '../../../app/approvals';
import type { RunningTask } from '../../../lib/types';
const task = { id: 'test', runId: 'run', actionId: 'choice', approvalKind: 'vault_payment', approvalRequest: { kind: 'payment_card', siteHost: 'naturamarket.ca', needSecurityCode: true } } as RunningTask;
function Fixture() {
  const [done, setDone] = useState(false);
  return <div className="wd"><div style={{ padding: 16 }}><InlinePanelContent active={!done}>{done ? <><AnswersSummary compact answers={[]} vault={{kind:'payment_card',label:'Personal card',detail:'Mastercard •••• 5908'}}/><p>Task resumed</p></> : <VaultCard task={task} skipping={false} onSaved={() => setDone(true)} onSkip={() => {}} />}</InlinePanelContent></div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
