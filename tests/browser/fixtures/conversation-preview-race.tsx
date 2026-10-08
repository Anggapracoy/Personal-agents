import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useConversationSettings} from '../../../app/conversation-settings';
function Fixture(){
 const state=useConversationSettings('preview-race@example.com',false);
 const [home,setHome]=useState(false);
 return <><button onClick={()=>void state.refresh()}>Refresh</button><button onClick={()=>{state.publishReceived('run:test',{kind:'agent',text:'Your table is booked.',createdAt:'2026-10-05T14:00:02Z'});}}>Receive reply</button><button onClick={()=>setHome(true)}>Back</button><div role="status">{state.ready?'Ready':'Loading'}</div>{home&&<p>{state.messages['run:test']?.text}</p>}</>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
