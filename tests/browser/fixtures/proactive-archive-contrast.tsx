import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Row, ProactiveRow } from '../../../app/home';
function Fixture() {
  const [busy, setBusy] = useState(false);
  return <div className="wd"><main className="wd-home">
    <div className="wd-conversations"><Row item={{ id: 'chat', title: 'Chat', line: 'Swipe to archive', kind: 'doc', state: 'need' }} enabled={!busy} onOpen={() => {}} onArchive={async () => { setBusy(true); return true; }} /></div>
    <ProactiveRow item={{ id: 'suggestion', title: 'Dinner tonight', line: '', kind: 'doc', state: 'need', proactive: { context: '', body: 'Find a table', option: { id: 'go', label: 'Find a spot' }, alternative: { id: 'stay', label: 'Stay in' } } }} enabled={!busy} onOpen={() => {}} onMenu={() => {}} onChoose={() => new Promise(() => {})} onAlternative={async () => true} />
  </main></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
