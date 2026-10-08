import {createRoot} from 'react-dom/client';
import {Home} from '../../../app/home';
import type {GoogleConnection} from '../../../app/workspace-model';
const accounts:GoogleConnection[]=[{id:'google-test',email:'lisa@example.com',name:'Lisa',enabled:true,needsReconnect:true,connectedAt:'2026-09-09T00:00:00Z'}];
createRoot(document.getElementById('root')!).render(<div className="wd"><div className="wd-front-layer"><Home initial="L" name="Lisa" items={[]} active googleConnections={accounts} onOpen={()=>{}} onYou={()=>{}}/></div></div>);
