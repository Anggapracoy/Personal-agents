'use client';
import {useEffect,useState} from 'react';
import type {GoogleConnection} from './workspace-model';
import {SourceIcon} from './source-icon';
import {GoogleReconnectButton} from './google-reconnect-button';

export function GoogleConnectionNotice({active,previewMode=false,initialAccounts=[]}:{active:boolean;previewMode?:boolean;initialAccounts?:GoogleConnection[]}) {
  const [accounts,setAccounts]=useState(initialAccounts);
  useEffect(()=>{
    if(previewMode || !active)return;
    const abort=new AbortController();
    const refresh=()=>{
      if(document.hidden)return;
      void fetch('/api/connections',{cache:'no-store',signal:abort.signal})
        .then(async response=>response.ok ? response.json() : null)
        .then(data=>{if(Array.isArray(data?.accounts))setAccounts(data.accounts);})
        .catch(()=>undefined);
    };
    refresh();
    const timer=window.setInterval(refresh,60_000);
    document.addEventListener('visibilitychange',refresh);
    window.addEventListener('focus',refresh);
    window.addEventListener('dash:googleConnectionChanged',refresh);
    return()=>{abort.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('dash:googleConnectionChanged',refresh);};
  },[active,previewMode]);
  const broken=accounts.filter(account=>account.enabled && account.needsReconnect);
  if(!broken.length)return null;
  return <section className="wd-google-reconnect-notice" aria-label="Google connection needs attention">
    <div className="wd-google-reconnect-heading"><SourceIcon name="google"/><strong>Reconnect Google</strong></div>
    <p>Dash can’t check Gmail or Calendar for {broken.map(account=>account.email).join(', ')} until you reconnect.</p>
    <GoogleReconnectButton/>
  </section>;
}
