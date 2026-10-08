import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {TaskRoute, type TaskActions} from '../../../app/task-route';
import type {RunningTask} from '../../../lib/types';
const w=window as any;
function Fixture(){
 const [actionId,setActionId]=useState('first');
 w.nextRequest=()=>setActionId('second');
 const task={id:'pending-test',runId:'pending-test',title:'Question',category:'food',status:'needs_approval',actionId,approvalKind:'questions',questionRequest:{questions:[{id:'side',question:'Which side?',answerType:'text',options:[]}]},updatedAt:'2026-09-28T12:00:00Z'} as unknown as RunningTask;
 const actions={onBack(){},onSnapshot(){},onReply:async()=>new Promise<void>((resolve,reject)=>{w.finishSend=(ok:boolean)=>ok?resolve():reject(Error('Offline'));})} as unknown as TaskActions;
 return <div className="wd"><div className="wd-front-layer"><TaskRoute id="pending-test" decisions={[]} tasks={[task]} history={[]} snapshots={new Map()} previewMode={false} messageCache={new Map([['pending-test',[]]])} actions={actions}/></div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
