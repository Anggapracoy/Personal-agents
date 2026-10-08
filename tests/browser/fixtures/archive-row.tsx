import { createRoot } from 'react-dom/client';
import { Row } from '../../../app/home';
createRoot(document.getElementById('root')!).render(<div className="wd"><main className="wd-home"><div className="wd-conversations"><Row item={{ id: 'test', key: 'test', title: 'Shared photo', line: 'What should I do with it?', kind: 'doc', state: 'need' }} enabled onOpen={() => { document.body.dataset.opened = 'true'; }} onArchive={async () => { document.body.dataset.archived = 'true'; return true; }} /><div data-next-row>Next conversation</div></div></main></div>);
