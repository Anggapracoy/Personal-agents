import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {TaskScreen} from '../../../app/task-screen';
import {prepareMessageSend} from '../../../app/message-send-motion';
import type {ThreadItem} from '../../../lib/harness/thread';
function Fixture(){
 const [live,setLive]=useState(false);
 const [activity,setActivity]=useState({label:'Thinking',icon:'thinking' as 'thinking'|'photo'|'typing'|'map'});
 const [items,setItems]=useState<ThreadItem[]>([{id:'opening',kind:'agent',text:'Ready when you are.',createdAt:'2026-09-16T12:00:00Z'}]);
 const send=()=>{prepareMessageSend(document.querySelector('form'),'Check this.');flushSync(()=>{setLive(true);setItems(old=>[...old,{id:'reply',kind:'user',text:'Check this.',deliveryState:'sending',createdAt:'2026-09-16T12:01:00Z'}]);});setTimeout(()=>{setItems(old=>old.map(item=>({...item,deliveryState:undefined})));setActivity({label:"Thinking",icon:"thinking"});},60);};
 (window as any).headerTest={send,history:()=>setItems(Array.from({length:30},(_,index)=>({id:`history-${index}`,kind:index%2?'user':'agent',text:`Message ${index}: keeping this conversation in place.`,createdAt:'2026-09-16T12:00:00Z'} as ThreadItem))),maps:()=>{setLive(true);setActivity({label:'Checking directions',icon:'map'});},typing:()=>setActivity({label:'Typing',icon:'typing'}),start:()=>setLive(true),stop:()=>setLive(false),photos:()=>{setLive(true);setActivity({label:'Preparing photos',icon:'photo'});}};
 return <div className="wd"><div className="wd-front-layer"><TaskScreen conversationId="header-motion" title="Check delivery" kind="doc" state={live?'live':'watch'} statusLabel={live?activity.label:''} activityIcon={activity.icon} items={items} onBack={()=>{}} footer={<form className="wd-composer" onSubmit={e=>e.preventDefault()}><div className="wd-composer-row"><textarea defaultValue="Check this."/><button type="button" onClick={send}>Send</button></div></form>}/></div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
