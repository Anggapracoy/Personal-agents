import { useState } from 'react';
import { BrowserSheet } from '../../../app/browser-sheet';
import { createRoot } from 'react-dom/client';
import { SensitiveActionCard } from '../../../app/approvals';
import { AnswersSummary } from '../../../app/conversation-status';
import type { RunningTask } from '../../../lib/types';
const task = { status:'needs_approval', title:'Review checkout', browserUsed:true, id:'checkout', runId:'preview', actionId:'approval', approvalKind:'purchase', approvalRequest:{pageUrl:'https://naturamarket.ca/checkout',purpose:'Place the Natura Market order for one 50g bag of SmartSweets Low Sugar Sour Blast Buddies with next-business-day delivery for CA$16.78 total'},browserFrames:[{id:'frame',actionId:'capture',url:'https://naturamarket.ca/checkout',label:'Checkout',createdAt:''}]} as RunningTask;
const w=window as unknown as {checkoutCalls:string[]};w.checkoutCalls=[];
function Fixture() { const [open,setOpen] = useState(false); return (<main className="wd" style={{position:'relative',padding:20,minHeight:'100vh',overflow:'auto'}}><div style={{maxWidth:390,margin:'auto'}}><SensitiveActionCard task={task} payment={{detail:'Mastercard •••• 5908'}} denying={false} onOpenBrowser={()=>{w.checkoutCalls.push('review');setOpen(true);}} onApprove={async mode=>{w.checkoutCalls.push(mode);return false;}} onDeny={()=>w.checkoutCalls.push('deny')}/><p style={{fontSize:11,color:'var(--ink2)',margin:'28px 0 12px'}}>AFTER APPROVAL</p><AnswersSummary compact purchase={{merchant:'naturamarket.ca'}} answers={[{question:'Purchase',answer:'Approved'}]}/></div>{open && <BrowserSheet runId="preview" task={task} frames={task.browserFrames!} control={false} closeForAttention={false} onControlChange={()=>{}} onDone={async()=>false} onClose={()=>setOpen(false)} />}</main>); }
createRoot(document.getElementById('root')!).render(<Fixture />);
