'use client';
import {useState} from 'react';
import {nativeGoogleConnectionAvailable,requestNativeGoogleConnection} from './native-bridge';
export function GoogleReconnectButton({className='wd-btn is-primary is-compact',onConnected}:{className?:string;onConnected?:()=>void}) {
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 return <><a className={className} href="/api/connections/google/start" aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={event=>{
  event.stopPropagation();
  if(busy){event.preventDefault();return;}
  if(!nativeGoogleConnectionAvailable())return;
  event.preventDefault();setBusy(true);setError('');
  void requestNativeGoogleConnection().then(()=>{window.dispatchEvent(new Event('dash:googleConnectionChanged'));onConnected?.();})
   .catch(caught=>setError(caught instanceof Error ? caught.message : 'Google reconnect did not finish.'))
   .finally(()=>setBusy(false));
 }}>{busy ? <><span className="wd-spinner" aria-hidden="true"/>Connecting…</> : 'Reconnect'}</a>{error && <p className="wd-card-error" role="alert">{error}</p>}</>;
}
