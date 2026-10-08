import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Composer } from '../../../app/composer';
const w = window as any;
w.__decisionFeedNativeComposer = location.search.includes('native=1');
w.bridge = [];
w.webkit = { messageHandlers: { decisionFeedNative: { postMessage: (message: unknown) => w.bridge.push(message) } } };
function Fixture() {
  const [text, setText] = useState('');
  return <div className="wd"><div className="wd-home-layer"><Composer placeholder="Message" value={text} onChange={setText} onStop={location.search.includes("working=1") ? ()=>{w.taskStops=(w.taskStops??0)+1;} : undefined} onSend={() => {}} /><output data-testid="text">{text}</output></div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
