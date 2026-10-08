import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { You, type YouProps } from '../../../app/you';
Object.assign(window,{__decisionFeedNativeAppleConnections:true,__decisionFeedNativeShell:true,webkit:{messageHandlers:{decisionFeedNative:{postMessage:(message:any)=>{
 (window as any).settingsMessages ??=[];(window as any).settingsMessages.push(message);
 if(message.action==='appleConnections') queueMicrotask(()=>window.dispatchEvent(new CustomEvent('decisionFeed:appleConnectionsResult',{detail:{requestId:message.payload.requestId,ok:true,connections:[{id:'reminders',enabled:true,status:'connected'},{id:'contacts',enabled:true,status:'denied'},{id:'photos',enabled:true,status:'limited'}]}})));
}}}}});
function Fixture() {
 const [email,setEmail]=useState('owner@test.invalid');
 (window as any).settingsFixture={setOwner:setEmail};
 const props:YouProps={user:{name:'Test',email},panel:'sources',googleConnected:true,previewMode:false,deviceCalendar:{status:'denied',events:[]},vaultItems:[],vaultLoading:false,appearance:'light',scanning:null,onVaultChanged:async()=>{},onVaultDelete:()=>{},onAppearance:()=>{},onStopScan:()=>{},onOpenPanel:()=>{},onBack:()=>{},onClose:()=>{},onDeleteData:()=>{},onDeleteAccount:()=>{},onSignOut:()=>{}};
 return <div className="wd"><You {...props}/></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
