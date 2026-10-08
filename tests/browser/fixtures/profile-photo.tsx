import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsSheet } from '../../../app/settings-sheet';
function Fixture(){
 const [image,setImage]=useState<string|null>(null);
 return <div className="wd"><SettingsSheet {...({user:{name:'Michael',email:'michael@example.com',image},onProfilePhotoChanged:setImage,googleConnected:false,previewMode:false,deviceCalendar:{status:'unavailable'},vaultItems:[],vaultLoading:false,onVaultChanged:async()=>{},onVaultDelete:()=>{},appearance:'light',onAppearance:()=>{},scanning:null,onStopScan:()=>{},onDeleteData:()=>{},onDeleteAccount:()=>{},onSignOut:()=>{},onClose:()=>{}} as any)}/></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
