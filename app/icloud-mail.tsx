"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { SettingsDisclosure } from './settings-disclosure';
import { SourceIcon } from './source-icon';
import { responseError } from './native-bridge';
import type { ICloudAccount } from '../lib/mail/icloud-store';
export function ICloudMail({ search = '', previewMode = false, ownerEmail, onAccountsChange }: { search?: string; previewMode?: boolean; ownerEmail: string; onAccountsChange?: (accounts: ICloudAccount[]) => void }) {
  const [accounts, setAccounts] = useState<ICloudAccount[]>([]);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [loaded, setLoaded] = useState(previewMode);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const container = useRef<HTMLDivElement>(null), revision = useRef(0), alive = useRef(true);
  const owner = useRef(ownerEmail); owner.current = ownerEmail;
  const refresh = useCallback(async () => {
    if (previewMode) { setLoaded(true); return; }
    const current = ++revision.current;
    const result = await fetch('/api/connections/icloud', { cache: 'no-store' });
    if (!result.ok) throw new Error(await responseError(result, 'Couldn’t check iCloud Mail.'));
    const data = await result.json() as { accounts: ICloudAccount[] };
    if (!alive.current || current !== revision.current || owner.current !== ownerEmail) return;
    setAccounts(data.accounts); setLoaded(true); onAccountsChange?.(data.accounts);
  }, [ownerEmail, previewMode, onAccountsChange]);
  useEffect(() => {
    alive.current = true; setAccounts([]); setOpen(false); setPassword(''); setEmail(''); setBusy(false); setError(''); setLoaded(previewMode); onAccountsChange?.([]);
    void refresh().catch(() => { if (alive.current && owner.current === ownerEmail) { setLoaded(true); setError('Couldn’t check iCloud Mail. Try again.'); } });
    return () => { alive.current = false; revision.current++; };
  }, [refresh, previewMode, onAccountsChange]);
  const changeForm = (change: () => void, expand = false) => {
    const details = container.current?.querySelector('details');
    const start = details?.getBoundingClientRect().height;
    details?.getAnimations().forEach(animation => animation.cancel());
    change();
    requestAnimationFrame(() => {
      if (!details?.isConnected || !alive.current) return;
      if (expand && !details.open) { details.querySelector('summary')?.click(); return; }
      details.style.overflow = '';
      if (!details.open || start === undefined || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const end = details.getBoundingClientRect().height;
      details.style.overflow = 'hidden';
      const animation = details.animate([{height:`${start}px`},{height:`${end}px`}], {duration:220,easing:'cubic-bezier(.22,1,.36,1)'});
      void animation.finished.then(() => { details.style.overflow = ''; }, () => {});
    });
  };
  const showForm = () => changeForm(() => { setError(''); if (!open) setEmail(accounts.find(account => account.needsReconnect || !account.enabled)?.email ?? ''); setOpen(true); }, true);
  if (search && !`icloud mail apple email ${accounts.map(account => account.email).join(' ')}`.toLowerCase().includes(search.toLowerCase())) return null;
  const connect = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || previewMode) return; setBusy(true); setError('');
    try {
      const response = await fetch('/api/connections/icloud', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ownerEmail, email, password }) });
      if (!response.ok) throw new Error(await responseError(response, 'Couldn’t connect iCloud Mail.'));
      if (!alive.current || owner.current !== ownerEmail) return;
      await refresh(); window.dispatchEvent(new Event('decisionFeed:mailConnectionChanged')); if (!alive.current || owner.current !== ownerEmail) return; changeForm(() => { setPassword(''); setOpen(false); });
    } catch (caught) { if (owner.current === ownerEmail) setError(caught instanceof Error ? caught.message : 'Try again.'); }
    finally { if (owner.current === ownerEmail) setBusy(false); }
  };
  const reconnect = accounts.some(account => account.needsReconnect || !account.enabled);
  return <div ref={container} className="wd-icloud-source">
    <SettingsDisclosure className="wd-source-detail">
      <summary className="wd-source-summary"><SourceIcon name="icloud" row /><strong>iCloud Mail<small>{reconnect ? 'Reconnect to check your inbox' : 'Your iCloud inbox'}</small></strong>
        {!loaded ? <span className="wd-source-state" role="status">Checking…</span> : accounts.length && !reconnect ? <span className="wd-source-state is-connected" aria-label="Connected">✓</span> : <button type="button" className="wd-btn is-primary wd-source-connect" disabled={busy} onClick={event => { event.preventDefault(); event.stopPropagation(); showForm(); }}>{open ? 'Continue setup' : reconnect ? 'Reconnect' : 'Connect'}</button>}
      </summary>
      <div className="wd-source-description">
        {accounts.map(account => <div className="wd-google-account" key={account.id}><span>{account.email}<small>{!account.enabled ? 'Paused' : account.needsReconnect ? 'Reconnect needed' : 'Connected'}</small></span>
          <button type="button" className="wd-btn is-text is-compact" disabled={busy} onClick={async () => { setBusy(true); try { const response = await fetch(`/api/connections/icloud?id=${account.id}`, { method: 'DELETE' }); if (!response.ok) throw new Error('Couldn’t disconnect iCloud Mail.'); await refresh(); window.dispatchEvent(new Event('decisionFeed:mailConnectionChanged')); } catch { setError('Couldn’t disconnect iCloud Mail.'); } finally { if (owner.current === ownerEmail) setBusy(false); } }}>Disconnect</button>
        </div>)}
        {!open && !accounts.length && <p className="wd-you-note">Connect your iCloud inbox for helpful suggestions. Dash asks before sending email.</p>}
        {!open && accounts.length > 0 && <button type="button" className="wd-btn is-secondary is-compact" disabled={busy} onClick={showForm}>{reconnect ? 'Reconnect iCloud Mail' : 'Add account'}</button>}
        {open && <form className="wd-icloud-form" onSubmit={connect}>
          <p>In your Apple account, open Sign-In and Security, then App-Specific Passwords. Make one named Dash and paste it below.</p>
          <a href="https://account.apple.com/" target="_blank" rel="noreferrer">Open Apple account settings</a>
          <label>iCloud email<input type="email" disabled={busy} autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>App-specific password<input type="password" disabled={busy} autoComplete="off" required value={password} onChange={event => setPassword(event.target.value)} /></label>
          <small>Use the password made for Dash, not your usual Apple password. You can disconnect anytime.</small>
          <button className="wd-btn is-primary" disabled={busy || previewMode}>{busy ? 'Connecting…' : 'Connect iCloud Mail'}</button>
          <button className="wd-btn is-text" type="button" disabled={busy} onClick={() => changeForm(() => { setPassword(''); setOpen(false); })}>Cancel</button>
        </form>}
      </div>
    </SettingsDisclosure>
    {error && <p role="alert" className="wd-error">{error}</p>}
  </div>;
}
