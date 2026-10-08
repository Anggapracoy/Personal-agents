import { createRoot } from 'react-dom/client';
import Workspace from '../../../app/workspace';
createRoot(document.getElementById('root')!).render(<Workspace user={{email: 'startup@example.com', name: 'Startup'}} googleConnected={false} />);
