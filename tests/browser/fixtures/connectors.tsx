import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsSheet } from '../../../app/settings-sheet';
import { AppleSources } from '../../../app/apple-sources';
function Fixture() {
 if(location.search.includes("catalog")) return <div className="wd"><SettingsSheet {...({panel:"sources",user:{name:"Test",email:"test@example.com"},googleConnected:false,previewMode:false,deviceCalendar:{status:"unavailable"},vaultItems:[],vaultLoading:false,onVaultChanged:async()=>{},onVaultDelete:()=>{},appearance:"light",onAppearance:()=>{},scanning:null,onStopScan:()=>{},onDeleteData:()=>{},onDeleteAccount:()=>{},onSignOut:()=>{},onClose:()=>{}} as any)}/></div>;
 const [connections,setConnections]=useState<any[]>([]);
 const [error,setError]=useState('');
 (window as any).__decisionFeedNativeAppleConnections=true;
 (window as any).appleRequests ??= [];
 (window as any).webkit={messageHandlers:{decisionFeedNative:{postMessage:(message:any)=>{
  (window as any).appleRequests.push(message);
  const payload=message.payload;
  window.dispatchEvent(new CustomEvent('decisionFeed:appleConnectionsResult',{detail:{requestId:payload.requestId,ok:true,connections:[{id:payload.service,enabled:payload.kind==='connect',status:'authorized'}]}}));
 }}}};
 return <div className="wd" style={{padding:20}}><h1>Connected apps</h1><AppleSources state={{connections,setConnections,available:true,loading:false,error,setError,refresh:async()=>{}}}/></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
