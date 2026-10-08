import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskScreen } from '../../../app/task-screen';
function Fixture() {
 const [reply,setReply]=useState(false);
 (window as any).incomingTest={receive:()=>setReply(true)};
 return <div className="wd"><TaskScreen conversationId="incoming-test" title="Incoming test" kind="doc" state="live" statusLabel="Thinking" onBack={()=>{}} typing={true} items={[
  {id:'old',kind:'agent',text:'Earlier message',createdAt:'2026-01-01T00:00:00Z'},
  {id:'user',kind:'user',text:'hey',createdAt:'2026-01-01T00:00:01Z'},
  ...(reply?[{id:'reply',kind:'agent' as const,text:"Heyyy yourself. I’m right here, what do you need?",createdAt:new Date().toISOString()}]:[])
 ]}/></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
