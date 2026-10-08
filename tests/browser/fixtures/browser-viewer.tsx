import { createRoot } from 'react-dom/client';
import { CloudBrowserPanel } from '../../../app/browser-viewer';
const root = createRoot(document.getElementById('root')!);
function render(closeForAttention = false) {
  root.render(<div className="wd"><div className="wd-sheet-root wd-browser-legacy"><CloudBrowserPanel task={{runId: 'viewer-test', title: 'Buy candy', subtitle: '', status: (window as any).viewerStatus ?? 'running', browserUsed: true, estimate: 'Live', browserFrames: [{ id: 'first', label: 'Opened the product page', url: 'https://naturamarket.ca/product' }, { id: 'last', label: 'Checking the available delivery options and continuing to checkout', url: 'https://naturamarket.ca/cart' }], steps: Array.from({length: 15}, () => ({label:'Checking the available delivery options and continuing to checkout',detail:'',status:'done' as const}))}} liveAvailable={Boolean((window as any).liveBrowserFixture)} controlRequested={Boolean((window as any).viewerControlRequested)} closeForAttention={closeForAttention} onControlModeChange={()=>{}} onResumeTask={async()=>{ document.body.dataset.resumeCalls = String(Number(document.body.dataset.resumeCalls ?? 0) + 1); return true; }} onClose={()=>document.body.dataset.closed='true'} /></div></div>);
}
(window as any).triggerBrowserAttention = () => render(true);
(window as any).setViewerStatus = (status: string) => { (window as any).viewerStatus = status; render(); };
render();
