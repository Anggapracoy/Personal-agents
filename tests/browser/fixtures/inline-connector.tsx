import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConnectorCard, ConnectorReceipt } from '../../../app/connector-card';
import type { RunningTask } from '../../../lib/types';
const logo='https://logos.composio.dev/api/notion';
const task={runId:'test',actionId:'connect',approvalRequest:{appName:'Notion',appLogo:logo,toolkit:'notion',reason:'Connect your workspace so I can find your trip notes and help plan the weekend.'}} as RunningTask;
function Fixture(){
 const [done,setDone]=useState(false),[skipped,setSkipped]=useState(false);
 return <main className="wd" style={{minHeight:'100vh',padding:'64px 20px 36px',background:'var(--bg)'}}>
 <header style={{textAlign:'center',fontSize:20,fontWeight:600,marginBottom:62}}>Weekend plans</header>
 <p style={{textAlign:'center',color:'var(--ink2)',fontSize:13,marginBottom:24}}>Today 11:30 AM</p>
 <div style={{background:'var(--send)',color:'white',padding:'12px 16px',borderRadius:24,marginLeft:44,marginBottom:24,fontSize:17,lineHeight:1.4}}>Can you use my Notion trip notes?</div>
 {done||skipped?<ConnectorReceipt name="Notion" logo={logo} status={skipped?'Skipped':'Connected'}/>:<ConnectorCard task={task} onConnected={async()=>{(window as any).resumes=((window as any).resumes||0)+1;setDone(true);return true;}} onSkip={()=>setSkipped(true)}/>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
