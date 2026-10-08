import { createRoot } from 'react-dom/client';
import { SensitiveActionCard } from '../../../app/approvals';
import type { RunningTask } from '../../../lib/types';

const options = [
  { type: 'purchase', title: 'Order', host: 'naturamarket.ca', purpose: 'Place the Natura Market order for one bag of candy for CA$16.78 total', card: 'Mastercard •••• 5908' },
  { type: 'bill_payment', title: 'Bill', host: 'torontohydro.com', purpose: 'Pay the Toronto Hydro electricity bill for CA$83.20 total', card: 'Mastercard •••• 5908' },
  { type: 'transfer', title: 'Transfer', host: 'bank.example', purpose: 'Transfer CA$250.00 total to Alex from chequing', card: '' },
  { type: 'payment', title: 'Payment', host: 'service.example', purpose: 'Pay CA$24.00 total to the service', card: 'Mastercard •••• 5908' },
] as const;

function Fixture() {
  return <main className="wd" style={{ padding: 24, minHeight: '100vh' }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 390px))', gap: 24, justifyContent: 'center' }}>
      {options.map(option => {
        const task = { status: 'needs_approval', title: option.title, id: option.type, runId: 'preview', actionId: option.type, approvalKind: 'purchase', approvalRequest: { pageUrl: `https://${option.host}/pay`, purpose: option.purpose, approvalType: option.type } } as RunningTask;
        return <div key={option.type}><p style={{ fontSize: 13, color: 'var(--ink2)', margin: '0 0 12px 4px' }}>{option.title}</p><SensitiveActionCard task={task} payment={option.card ? { detail: option.card } : undefined} denying={false} onOpenBrowser={() => {}} onApprove={async () => false} onDeny={() => {}} /></div>;
      })}
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
