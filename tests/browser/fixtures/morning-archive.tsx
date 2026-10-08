import { createRoot } from 'react-dom/client';
import Workspace from '../../../app/workspace';
import { uiPreviewDecisions, uiPreviewTasks, uiPreviewHistory } from '../../../app/preview-fixtures';
const source=new URLSearchParams(location.search).get('source');
const sourceType=source==='email'||source==='calendar'||source==='recurring'?source:'proactive';
uiPreviewTasks.splice(0); uiPreviewHistory.splice(0);
uiPreviewDecisions.splice(0, uiPreviewDecisions.length, {
 id: 'morning-archive-test', discoveryFingerprint: source ? undefined : 'morning:pottery', sourceType, category: 'social', urgency: 'low', title: 'Try pottery', subtitle: 'There’s a pottery workshop nearby. Want me to check the weekend times?', originalContext: 'A personal morning idea', sourceLabel: 'For you', createdAt: new Date().toISOString(),
 options: [{id:'primary',label:'Check times',actionType:'research',isPrimary:true},{id:'alternative',label:'Wait for now',actionType:'no_action'}], dismissLabel:'Not now',
});
createRoot(document.getElementById('root')!).render(<Workspace user={{name:'Michael',email:'morning-test@example.com'}} googleConnected={false} previewMode />);
