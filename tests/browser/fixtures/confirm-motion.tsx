import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfirmSheet } from '../../../app/confirm-sheet';
function Fixture() {
  const [open, setOpen] = useState(false);
  const [error,setError]=useState('');
  const nativeFailure=Boolean((window as any).nativeFailureFixture);
  const attempts=useRef(0);
  return <div className="wd"><button onClick={() => setOpen(true)}>Open stop</button>{open && <ConfirmSheet title="Stop this task?" body="Dash will stop working on this task." nativePrompt={nativeFailure ? 'Stop this task?' : undefined} error={error} actions={[{label:'Stop task',tone:'destructive',run:async()=>{if(nativeFailure){if(++attempts.current===1){setError('Could not finish. Try again.');return false;}setError('');return new Promise<boolean>(resolve=>{(window as any).finishRetry=()=>resolve(false);});}document.body.dataset.stopped='true';}},{label:'Keep going',tone:'text',run:()=>{}}]} onClose={()=>setOpen(false)} />}</div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
