import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QuestionsCard} from '../../../app/approvals';
import {TaskScreen} from '../../../app/task-screen';
import type {RunningTask} from '../../../lib/types';
const w=window as any;
const options=[{id:'a',label:'6:00 PM',description:''},{id:'b',label:'7:00 PM',description:''}];
const task={runId:'choice-test',actionId:'action',questionRequest:{questions:[{id:'time',question:'When should I book dinner?',answerType:new URL(location.href).searchParams.get('multi')==='1'?'multiple_choice':'single_choice',options}]}} as RunningTask;
const proactive=new URL(location.href).searchParams.get('proactive')==='1';
function Fixture(){const[selected,setSelected]=useState<string>();return (<div className="wd"><div className="wd-front-layer"><TaskScreen title="Dinner" conversationId="choices" kind="doc" state="need" statusLabel="" items={[]} onBack={()=>{}} ask={proactive?{headline:'Dinner',sub:'Want me to book dinner?',why:[],options:options.map(option=>({...option,actionType:'research' as const})),dismissLabel:'Not now',selectedOptionId:selected,onChoose:option=>{w.chosen=option.id;setSelected(option.id);},onDismiss:()=>{w.dismissed=true;}}:undefined}>{!proactive&&<QuestionsCard task={task} skipping={false} onAnswered={()=>{w.answered=true;}} onSkip={()=>{w.dismissed=true;}}/>}</TaskScreen></div></div>);}
createRoot(document.getElementById('root')!).render(<Fixture/>);
