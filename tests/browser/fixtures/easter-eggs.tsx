import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useEasterEggEvent } from '../../../app/easter-eggs';
import { TaskScreen } from '../../../app/task-screen';
import { Composer } from '../../../app/composer';
import { activityLabel } from '../../../lib/harness/tool-activity-labels';
import type { ThreadItem } from '../../../lib/harness/thread';
function Fixture() {
  const [event, setEvent] = useState<unknown>();
  const [text,setText] = useState('');
  const [activity,setActivity] = useState<string>();
  const [items,setItems]=useState<ThreadItem[]>([]);
  useEasterEggEvent(event);
  (window as any).easterEggTest = { fire: (value?: unknown) => setEvent(value ?? { id: crypto.randomUUID(), requestMessageId: 'explicit-test-request', createdAt: new Date().toISOString(), effect: new URL(location.href).searchParams.get('effect') ?? 'confetti' }) };
  return <div className="wd"><div className="wd-front-layer"><TaskScreen title="Dash" conversationId="confetti-test" kind="doc" state={activity ? "live" : "watch"} statusLabel={activity ?? ""} persistentActivity={activity} onBack={()=>{}} items={items} footer={<Composer placeholder="Reply…" variant="thread" value={text} onChange={setText} onSend={async message=>{
    setText('');setItems(old=>[...old,{id:crypto.randomUUID(),kind:'user',text:message},{id:crypto.randomUUID(),kind:'agent',text:'Here you go!'}]);
    const effect = new URL(location.href).searchParams.get('effect') ?? 'confetti';
    setActivity(activityLabel('easteregg', {effect}));
    if (new URL(location.href).searchParams.get('tool') === '1') {
      const response = await fetch('/easteregg-tool', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,effect})});
      setEvent((await response.json()).event);
    } else (window as any).easterEggTest.fire();
    setTimeout(()=>setActivity(undefined), effect === 'flip' ? 1300 : effect === 'snow' ? 6700 : 5300);
  }}/>} /></div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
