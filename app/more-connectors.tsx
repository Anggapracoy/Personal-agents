"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hasNativeBridge, postNativeMessage } from "./native-bridge";
import type { ConnectorItem } from "../lib/composio/service";

export function MoreConnectors({ previewMode = false, active = true, search: externalSearch, hideSearch = false, hasLocalMatches = false }: { previewMode?: boolean; active?: boolean; search?: string; hideSearch?: boolean; hasLocalMatches?: boolean }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [localSearch, setSearch] = useState("");
  const search = externalSearch ?? localSearch;
  const [items, setItems] = useState<ConnectorItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shortSearch, setShortSearch] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState("");
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const connection = useRef<{ url: string; slug: string; activeAccounts: string[] } | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const retryCursor = useRef<string | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async (next?: string) => {
    retryCursor.current = next;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setLoading(true); setError("");
    try {
      if (previewMode) {
        const query = search.trim().toLowerCase() === "x" ? "twitter" : search.trim().toLowerCase();
        setItems(["Twitter", "Canva", "Slack", "GitHub", "Notion"].filter(name => name.toLowerCase().includes(query)).map(name => {
          const slug = name.toLowerCase();
          const connected = ["twitter", "canva"].includes(slug);
          return { slug, name, logo: `https://logos.composio.dev/api/${slug}`, noAuth: false, connected,
            accounts: connected ? [{ id: `preview-${slug}`, status: "ACTIVE", label: name === "Twitter" ? "Your X account" : "Your Canva account" }] : [] };
        })); setShortSearch(false); setCursor(null); return;
      }
      const params = new URLSearchParams({ search, ...(next ? { cursor: next } : {}) });
      const response = await fetch(`/api/connections/composio?${params}`, { cache: "no-store", signal: abort.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't load apps.");
      if (abort.signal.aborted) return;
      setConfigured(data.configured);
      setShortSearch(data.shortSearch === true);
      setItems(old => next ? [...old, ...data.items.filter((item: ConnectorItem) => !old.some(existing => existing.slug === item.slug))] : data.items);
      setCursor(data.cursor);
      const pending = connection.current;
      if (pending && data.items.some((item: ConnectorItem) => item.slug === pending.slug && item.accounts.some(account => account.status === "ACTIVE" && !pending.activeAccounts.includes(account.id)))) {
        postNativeMessage({ version: 1, action: "closeConnectorBrowser", payload: { url: pending.url } });

        connection.current = null;
        setConnecting(null);
      }
    } catch (caught) { if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : "Couldn't load apps."); }
    finally { if (!abort.signal.aborted) setLoading(false); }
  }, [search, previewMode, connecting]);
  useEffect(() => { controller.current?.abort(); setItems([]); setCursor(null); setError(""); setLoading(true); }, [search]);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => void load(), 200);
    return () => { clearTimeout(timer); controller.current?.abort(); };
  }, [active, load]);
  useEffect(() => {
    if (!active) return;
    const refresh = () => { if (document.visibilityState === "visible" || hasNativeBridge()) void load(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    const interval = connecting ? setInterval(refresh, 5000) : undefined;
    const deadline = connecting ? setTimeout(() => setConnecting(null), 180_000) : undefined;
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); clearInterval(interval); clearTimeout(deadline); };
  }, [active, connecting, load]);
  useEffect(() => {
    const target = sentinel.current;
    if (!active || !target || !cursor || loading || error) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void load(cursor);
    }, { root: target.closest(".wd-screen"), rootMargin: "240px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [active, cursor, loading, error, load]);
  const change = async (item: ConnectorItem, accountId?: string, remove = false) => {
    if (busy) return;
    if (previewMode) { setItems(old => old.map(row => row.slug === item.slug ? { ...row, connected: !remove } : row)); return; }
    setBusy(item.slug); setRemoving(remove); setError("");
    try {
      const response = await fetch("/api/connections/composio", { method: remove ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: item.slug, accountId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't change this connection.");
      if (data.url) { connection.current = { url: data.url, slug: item.slug, activeAccounts: item.accounts.filter(account => account.status === "ACTIVE").map(account => account.id) }; setConnecting(item.slug); window.location.assign(data.url); }
      else { setConnecting(null); await load(); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn't change this connection."); }
    finally { setBusy(""); }
  };
  const orderedItems = [...items.filter(item => item.connected), ...items.filter(item => !item.connected)];
  return <section className="wd-connector-catalog" aria-label="Other apps">
        {!hideSearch && <p className="wd-you-note">Connect other apps you use. You choose what each app shares with Dash.</p>}
        {!hideSearch && <input type="search" className="wd-connector-search" aria-label="Search apps" placeholder="Search apps…" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={search} onChange={event => { controller.current?.abort(); setCursor(null); setError(""); setItems([]); setLoading(true); setSearch(event.target.value); }} />}
        {!configured && <p className="wd-you-note">Other apps aren’t available right now.</p>}
        {error && <div role="alert"><p className="wd-you-error">{error}</p><button type="button" className="wd-btn is-text" onClick={() => void load(retryCursor.current)}>Try again</button></div>}
        {orderedItems.map((item, index) => <div key={item.slug}>
          {(index === 0 || item.connected !== orderedItems[index - 1].connected) && <h2 className="wd-source-group-title">{item.connected ? "Connected" : "Available"}</h2>}
          <div className="wd-connector-row">
          <div className="wd-source-summary">
            <span className="wd-source-icon-slot" aria-hidden="true">{item.logo ? <img className="wd-connector-logo" src={item.logo} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="wd-connector-logo is-placeholder" aria-hidden="true">{item.name[0]}</span>}</span>
            <button type="button" className="wd-connector-toggle" disabled={!item.connected && !item.accounts.length} aria-expanded={Boolean(expanded[item.slug])} aria-controls={`connector-accounts-${item.slug}`} onClick={() => setExpanded(old => ({ ...old, [item.slug]: !old[item.slug] }))}><strong>{item.slug === "twitter" ? "X" : item.name}{item.connected && <small>{item.accounts.length ? `${item.accounts.length} account${item.accounts.length === 1 ? "" : "s"}` : "Connected"}</small>}</strong>{(item.connected || item.accounts.length > 0) && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>}</button>
            {!item.connected && <button type="button" className="wd-btn is-primary wd-source-connect" disabled={Boolean(busy)} onClick={() => void change(item)}>{busy === item.slug ? "Connecting…" : item.noAuth ? "Enable" : item.accounts.length ? "Reconnect" : "Connect"}</button>}
          </div>
          <div id={`connector-accounts-${item.slug}`} className={`wd-connector-accounts${expanded[item.slug] ? " is-open" : ""}`} inert={!expanded[item.slug]}><div>
          {item.accounts.map(account => <div className="wd-connector-account" key={account.id}><span>{account.label}<small>{account.status === "ACTIVE" ? "Connected" : account.status === "INITIATED" ? "Sign-in not finished" : "Reconnect needed"}</small></span><button type="button" className="wd-btn is-text" disabled={Boolean(busy)} aria-label={`Disconnect ${item.slug === "twitter" ? "X" : item.name} ${account.label}`} onClick={() => void change(item, account.id, true)}>Disconnect</button></div>)}
          {item.connected && <button type="button" className="wd-btn is-secondary is-compact wd-connector-add" disabled={Boolean(busy)} onClick={() => void change(item, undefined, item.noAuth)}>{busy === item.slug ? removing ? "Disconnecting…" : "Connecting…" : item.noAuth ? "Disconnect" : "Add account"}</button>}
          </div></div>
        </div></div>)}
        {loading && <p className="wd-you-note" role="status">Loading apps…</p>}
        {!loading && configured && !error && !items.length && !cursor && (!hideSearch || Boolean(search)) && !hasLocalMatches && <p className="wd-connector-empty" role="status">{shortSearch ? "Type at least 3 letters to search." : "We don’t have that app yet."}</p>}
        <div ref={sentinel} className="wd-connector-sentinel" aria-hidden="true" />
  </section>;
}
