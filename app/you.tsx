"use client";
import { SUPPORT_EMAIL } from "../lib/deployment";
import { ICloudMail } from "./icloud-mail";
import { GoogleReconnectButton } from "./google-reconnect-button";
import { MoreConnectors } from "./more-connectors";
import { SettingsDisclosure } from "./settings-disclosure";
import { NativeGlassButton } from "./native-glass-button";
import { AppleSources, useAppleConnections, type AppleConnectionsState } from "./apple-sources";
import { NotificationSettings } from "./notification-settings";
import { AppearanceMenu } from "./appearance-menu";
import { useSettingsBackSwipe } from "./settings-back-swipe";
import { SettingsIntro } from "./settings-intro";
import { SettingsGlyph } from "./settings-glyph";
import { PaymentCardIcon } from "./payment-card-icon";
import { SourceIcon } from "./source-icon";
import { appleSources } from "../lib/apple/catalog";
import { ProfilePhotoEditor } from "./profile-photo-editor";
import { PeopleMemory } from "./people-memory";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WorkspaceAppearance } from "../lib/types";
import { BackIcon } from "./home";
import { postNativeMessage, requestNativeVault, responseError, type VaultItemSummary } from "./native-bridge";
import { formatCardExpiry, parseCardExpiry } from "../lib/card-expiry";
import { uiPreviewLifeProfile } from "./preview-fixtures";
import { formatSavings, type SavingsSummary } from "./money-saved";
import {
  lifeFactSummary, lifeProfileDraft,
  type DeviceCalendarSnapshot, type GoogleConnection, type LifeProfileDraft, type LifeProfileResponse,
} from "./workspace-model";

type MemorySection = "about" | "watch" | "instructions" | "people" | "saved";
export type YouPanel = "sources" | "connectors" | "preferences" | "memory" | "vault" | "account" | `memory-${MemorySection}`;
const memorySections = [{ id: "about", label: "About you", icon: "account" }, { id: "watch", label: "Watch areas", icon: "memory" }, { id: "instructions", label: "Custom instructions", icon: "instructions" }, { id: "people", label: "People", icon: "people" }, { id: "saved", label: "Saved memories", icon: "saved" }] as const;

const settingsIntros = {
  sources: { icon: "sources", title: "Connect the apps you use.", description: "Let Dash spot things to help with." },
  preferences: { icon: "instructions", title: "Your kind of help.", description: "Let Dash know where you’re based and how you like to chat." },
  memory: { icon: "memory", title: "A little more you.", description: "The details Dash remembers from your chats." },
  vault: { icon: "lock", title: "Keep the essentials close.", description: "Manage the logins and cards you use with Dash." },
  account: { icon: "account", title: "Your account, your say.", description: "Manage your account and the data you share with Dash." },
  "memory-about": { icon: "pin", title: "A sense of home.", description: "Let Dash know where you’re based." },
  "memory-watch": { icon: "instructions", title: "Your kind of help.", description: "Let Dash know where you’re based and how you like to chat." },
  "memory-instructions": { icon: "instructions", title: "Just your style.", description: "Tell Dash how you like your replies." },
  "memory-people": { icon: "people", title: "The people in your life.", description: "Help Dash know who you mean." },
  "memory-saved": { icon: "saved", title: "The little details.", description: "What Dash remembers from your chats." },
} as const;
export type VaultEditor = { kind: "login" | "payment_card"; item: VaultItemSummary | null };
export type YouProps = {
  user: { name: string; email: string; image?: string | null };
  onProfilePhotoChanged?: (image: string) => void;
  panel?: YouPanel;
  lifeProfile?: LifeProfileResponse | null;
  onLifeProfile?: (data: LifeProfileResponse) => void;
  googleConnected: boolean;
  googleConnections?: GoogleConnection[];
  previewMode: boolean;
  deviceCalendar: DeviceCalendarSnapshot;
  vaultItems: VaultItemSummary[];
  vaultLoading: boolean;
  onVaultChanged: () => Promise<void>;
  onVaultDelete: (item: VaultItemSummary) => void;
  appearance: WorkspaceAppearance;
  onAppearance: (appearance: WorkspaceAppearance) => void;

  scanning: string | null;
  onStopScan: () => void;
  onOpenPanel: (panel: YouPanel) => void;
  onBack: (interactive?: boolean) => void;
  active?: boolean;
  vaultEditor?: VaultEditor | null;
  onVaultEditorChange?: (editor: VaultEditor | null, interactive?: boolean) => void;
  onClose?: () => void;
  closeRef?: React.RefObject<HTMLButtonElement>;
  nativeClose?: boolean;
  headerDragProps?: React.HTMLAttributes<HTMLElement>;
  onDeleteData: () => void;
  onDeleteAccount: () => void;
  savings?: SavingsSummary | null;
  onSignOut: () => void;
};

function SettingsLegal() {
  return <nav className="wd-you-legal" aria-label="Legal"><a href="/privacy" target="_blank" rel="noreferrer">Privacy</a><span aria-hidden="true">·</span><a href="/terms" target="_blank" rel="noreferrer">Terms</a><span aria-hidden="true">·</span><a href={`mailto:${SUPPORT_EMAIL}`}>Contact</a></nav>;
}

function Chevron() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>; }


/** Settings destinations stay inside the shared modal sheet. */
export function You(props: YouProps) {
  const { user, panel, onBack, onOpenPanel } = props;
  const [localVaultEditor, setVaultEditor] = useState<VaultEditor | null>(null);
  const vaultEditor = props.onVaultEditorChange ? props.vaultEditor ?? null : localVaultEditor;
  const screenRef = useRef<HTMLDivElement>(null);
  const vaultScroll = useRef(0);
  const changeVaultEditor = (next: VaultEditor | null, interactive = false) => {
    if (props.onVaultEditorChange) { props.onVaultEditorChange(next, interactive); return; }
    if (next && !vaultEditor) vaultScroll.current = screenRef.current?.scrollTop ?? 0;
    setVaultEditor(next);
  };
  const back = (interactive = false) => { if (panel === "vault" && vaultEditor) changeVaultEditor(null, interactive); else onBack(interactive); };
  useSettingsBackSwipe(screenRef, props.active === false ? undefined : panel, () => back(true));
  useLayoutEffect(() => {
    if (panel === "vault" && screenRef.current) screenRef.current.scrollTop = vaultEditor ? 0 : vaultScroll.current;
  }, [vaultEditor, panel]);
  useEffect(() => { if (panel !== "vault") setVaultEditor(null); }, [panel]);
  const apple = useAppleConnections(props.previewMode);
  const overview = props.lifeProfile ?? (props.previewMode ? uiPreviewLifeProfile : null);
  const [connectorCount, setConnectorCount] = useState(0);
  useEffect(() => {
    if (props.previewMode) return;
    const abort = new AbortController();
    void fetch("/api/connections/composio?count=1", { cache: "no-store", signal: abort.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (typeof data?.connectedCount === "number") setConnectorCount(data.connectedCount); })
      .catch(() => undefined);
    return () => abort.abort();
  }, [panel, props.previewMode]);
  const [mailCount, setMailCount] = useState<number | null>(props.previewMode ? 0 : null);
  useEffect(() => {
    if (props.previewMode || panel) return;
    let cancelled = false;
    setMailCount(null);
    const load = async () => {
      try {
        const response = await fetch('/api/connections/icloud', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json() as { accounts: Array<{ enabled: boolean; needsReconnect: boolean }> };
        if (!cancelled) setMailCount(data.accounts.some(account => account.enabled && !account.needsReconnect) ? 1 : 0);
      } catch { /* Keep the count unknown rather than claiming zero. */ }
    };
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    void load(); window.addEventListener('decisionFeed:mailConnectionChanged', load); window.addEventListener('focus', load); document.addEventListener('visibilitychange', visible);
    return () => { cancelled = true; window.removeEventListener('decisionFeed:mailConnectionChanged', load); window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', visible); };
  }, [props.user.email, props.previewMode, panel]);
  const sourceCount = (mailCount ?? 0) + connectorCount + (props.googleConnections ? props.googleConnections.some(account => account.enabled && !account.needsReconnect) ? 2 : 0 : props.googleConnected ? 2 : 0) + (props.deviceCalendar.status === "authorized" ? 1 : 0) + apple.connections.filter(source => source.enabled && ["connected", "limited"].includes(source.status)).length;
  const memoryCount = overview?.facts.filter(fact => fact.source === "conversation").length;
  const initial = user.name.trim()[0]?.toUpperCase() || user.email[0]?.toUpperCase() || "U";
  const memorySection = panel?.startsWith("memory-") ? panel.slice(7) as MemorySection : undefined;
  const title = memorySection ? memorySections.find(item => item.id === memorySection)!.label : (panel === "connectors" || panel === "sources") ? "Connected apps" : panel === "preferences" ? "Preferences" : panel === "memory" ? "Memories" : panel === "vault" ? (vaultEditor ? vaultEditor.item?.label ?? (vaultEditor.kind === "login" ? "New login" : "New card") : "Logins & cards") : panel === "account" ? "Account" : "Settings";
  return (
    <div ref={screenRef} key={panel ?? "settings"} className={`wd-screen wd-you${!panel ? " wd-settings-main" : ""}${(panel === "sources" || panel === "connectors") ? " wd-sources-page" : ""}`}>
      <header className="wd-taskbar" {...props.headerDragProps}>
        {props.onClose && panel ? <NativeGlassButton symbol="chevron.left" type="button" className="wd-round" aria-label="Back" onClick={() => back()}><BackIcon /></NativeGlassButton> : <span className="wd-round is-ghost" />}
        <div className="wd-taskbar-title"><span><strong>{title}</strong></span></div>
        {props.onClose ? <button ref={props.closeRef} style={props.nativeClose ? { visibility: "hidden" } : undefined} type="button" className="wd-round wd-settings-close" aria-label="Close Settings" onClick={props.onClose}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m7 7 10 10M17 7 7 17" /></svg></button> : <NativeGlassButton symbol="chevron.right" type="button" className="wd-round" aria-label="Back" onClick={() => back()}><span style={{ display: "flex", transform: "rotate(180deg)" }}><BackIcon /></span></NativeGlassButton>}
      </header>
      {panel && !(panel === "vault" && vaultEditor) && <SettingsIntro {...settingsIntros[panel === "connectors" ? "sources" : panel]} />}
      {!panel && (
        <div className="wd-you-head">
          <ProfilePhotoEditor image={user.image} initial={initial} onChanged={props.onProfilePhotoChanged} previewMode={props.previewMode} />
          <button type="button" className="wd-profile-account-link" aria-label="Account" onClick={() => onOpenPanel("account")}><span className="wd-profile-label"><strong>{user.name}</strong><small>{user.email}</small></span><Chevron /></button>
        </div>
      )}
      {(panel === "connectors" || panel === "sources") ? <Sources key={user.email} {...props} apple={apple} />
        : panel === "preferences" || panel === "memory" || memorySection ? <Memory {...props} section={memorySection} />
          : panel === "vault" ? <Vault {...props} editor={vaultEditor} setEditor={changeVaultEditor} />
            : panel === "account" ? <Account {...props} />
              : <>
                {props.savings && <section className="wd-savings" aria-label="Money saved">
                  <strong>{formatSavings(props.savings.amount, props.savings.currency)}</strong>
                  <span>saved with Dash this year</span>
                  <small>{props.savings.tasks === 1 ? "From 1 task" : `From ${props.savings.tasks} tasks`}</small>
                </section>}
                <div className="wd-settings-shortcuts" aria-label="Settings shortcuts">
                  <button type="button" aria-label="Connected apps overview" onClick={() => onOpenPanel("sources")}><SettingsGlyph name="sources" /><strong>{mailCount === null && !props.previewMode ? "–" : sourceCount}</strong><span>Connected apps</span>{props.scanning && <small role="status"><span className="wd-spinner" aria-hidden="true" />Checking…</small>}</button>
                  <button type="button" aria-label="Memories overview" onClick={() => onOpenPanel("memory")}><SettingsGlyph name="memory" /><strong>{memoryCount ?? "–"}</strong><span>Memories</span></button>
                </div>
                <section className="wd-settings-list" aria-label="Settings">
                  <button type="button" className="wd-you-row" onClick={() => onOpenPanel("sources")}><SettingsGlyph name="sources" /><span>Connected apps</span><Chevron /></button>
                  <button type="button" className="wd-you-row" onClick={() => onOpenPanel("memory")}><SettingsGlyph name="memory" /><span>Memories</span><Chevron /></button>
                  <button type="button" className="wd-you-row" onClick={() => onOpenPanel("preferences")}><SettingsGlyph name="instructions" /><span>Preferences</span><Chevron /></button>
                  <button type="button" className="wd-you-row" onClick={() => onOpenPanel("vault")}><SettingsGlyph name="vault" /><span>Logins &amp; cards</span><Chevron /></button>
                  <NotificationSettings />
                  <AppearanceMenu value={props.appearance} onChange={props.onAppearance} />
                </section>
                <button type="button" className="wd-you-signout" onClick={props.onSignOut}><span>Sign out</span><Chevron /></button>
                <SettingsLegal />
              </>}
    </div>
  );
}

function Sources({ googleConnected, googleConnections, previewMode, deviceCalendar, apple, user, scanning, onStopScan, active }: YouProps & { apple: AppleConnectionsState }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const [accounts, setAccounts] = useState<GoogleConnection[]>(googleConnections ?? []);
  const [iCloudAccounts, setICloudAccounts] = useState<Array<{ email: string }>>([]);
  const showGoogle = !query || ["google gmail calendar", ...(query.length >= 3 ? accounts.map(account => account.email.toLowerCase()) : [])].some(value => value.includes(query));
  const showWhatsApp = !query || "whatsapp chat messages".includes(query);
  const localMatches = "icloud mail apple email".includes(query) || iCloudAccounts.some(account => account.email.toLowerCase().includes(query)) || showGoogle || "apple calendar events on this iphone".includes(query) || appleSources.some(source => `apple ${source.name} ${query.length >= 3 ? source.detail : ""}`.toLowerCase().includes(query));
  const [loading, setLoading] = useState(!previewMode);
  const [removing, setRemoving] = useState<GoogleConnection | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [whatsappCode, setWhatsAppCode] = useState<{ code: string; expiresAt: string; instruction: string } | null>(null);
  const [whatsappLoading, setWhatsAppLoading] = useState(false);
  const [whatsappError, setWhatsAppError] = useState("");
  const load = () => setVersion((value) => value + 1);
  useEffect(() => {
    if (previewMode) return;
    let cancelled = false;
    setLoading(true);
    void fetch("/api/connections", { cache: "no-store" })
      .then(async (response) => { if (response.ok && !cancelled) setAccounts((await response.json() as { accounts: GoogleConnection[] }).accounts); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [previewMode, version]);
  const [resuming, setResuming] = useState<string | null>(null);
  const resume = async (account: GoogleConnection) => {
    setResuming(account.id); setError("");
    try {
      const response = await fetch("/api/connections", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: account.id, enabled: true }) });
      if (!response.ok) throw new Error(await responseError(response, "That account could not be resumed."));
      setAccounts(current => current.map(item => item.id === account.id ? { ...item, enabled: true } : item));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "That account could not be resumed."); }
    finally { setResuming(null); }
  };
  const remove = async (account: GoogleConnection) => {
    setError("");
    try {
      const response = await fetch(`/api/connections?id=${encodeURIComponent(account.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "That Google account could not be disconnected."));
      setRemoving(null);
      load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "That Google account could not be disconnected."); }
  };
  const calendarDenied = deviceCalendar.status === "denied";
  const calendarAvailable = previewMode || apple.available || deviceCalendar.status === "authorized";
  const calendarStatus = deviceCalendar.status === "authorized" ? "Reading events on this iPhone" : deviceCalendar.status === "denied" ? "Access denied" : "Not connected";
  return (
    <>
      <input type="search" className="wd-connector-search" aria-label="Search apps" placeholder="Search apps" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={search} onChange={event => setSearch(event.target.value)} />

      {scanning && <div className="wd-source-scan" role="status"><span className="wd-spinner" aria-hidden="true" /><span><strong>Looking for things to help with</strong><small>{scanning}</small></span><button type="button" className="wd-btn is-text is-compact" onClick={onStopScan}>Stop</button></div>}
      {showWhatsApp && <section className="wd-you-group wd-whatsapp-connector">
        <h2>WhatsApp</h2>
        <SettingsDisclosure className="wd-source-detail">
          <summary className="wd-source-summary"><SettingsGlyph name="sources" /><strong>WhatsApp<small>Chat with Anakbuah from your phone</small></strong>{whatsappCode ? <span className="wd-source-state is-connected" aria-label="Ready to link">✓</span> : <span className="wd-source-state">Connect</span>}</summary>
          <div className="wd-source-description">
            <p className="wd-you-note">Generate a one-time code, then send <strong>LINK code</strong> to the Anakbuah WhatsApp number.</p>
            {whatsappCode ? <div className="wd-you-note" role="status"><strong>{whatsappCode.code}</strong><small>Expires {new Date(whatsappCode.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></div> : <button type="button" className="wd-btn is-primary wd-source-connect" disabled={previewMode || whatsappLoading} onClick={async () => {
              setWhatsAppLoading(true); setWhatsAppError("");
              try {
                const response = await fetch("/api/connections/whatsapp/link-code", { method: "POST" });
                const data = await response.json().catch(() => null) as { code?: string; expiresAt?: string; instruction?: string; error?: string } | null;
                if (!response.ok || !data?.code || !data.expiresAt || !data.instruction) throw new Error(data?.error || "WhatsApp link code could not be created.");
                setWhatsAppCode({ code: data.code, expiresAt: data.expiresAt, instruction: data.instruction });
              } catch (caught) { setWhatsAppError(caught instanceof Error ? caught.message : "WhatsApp link code could not be created."); }
              finally { setWhatsAppLoading(false); }
            }}>{whatsappLoading ? "Creating code…" : "Connect WhatsApp"}</button>}
            {whatsappError && <p className="wd-you-error" role="alert">{whatsappError}</p>}
          </div>
        </SettingsDisclosure>
      </section>}
      {showGoogle && <section className="wd-you-group wd-google-connectors">
        <h2>Google</h2>
        {loading && <p className="wd-you-note">Loading accounts…</p>}
        <SettingsDisclosure className="wd-source-detail">
          <summary className="wd-source-summary"><SourceIcon name="google" row /><strong>Google<small>Gmail &amp; Calendar{accounts.length ? ` · ${accounts.length} account${accounts.length === 1 ? "" : "s"}` : ""}</small></strong>
          {accounts.some(account => account.enabled && account.needsReconnect) ? <GoogleReconnectButton className="wd-btn is-primary wd-source-connect" onConnected={load} /> : accounts.some(account => account.enabled) || (previewMode && googleConnected) ? <span className="wd-source-state is-connected" aria-label="Connected">✓</span> : loading ? <span className="wd-source-state">Checking…</span> : <a href="/api/connections/google/start" className="wd-btn is-primary wd-source-connect" onClick={event => event.stopPropagation()}>Connect</a>}
          </summary>
          <div className="wd-source-description">
            {accounts.map(account => <div className="wd-google-account" key={account.id}><span>{account.email}<small>{!account.enabled ? "Paused" : account.needsReconnect ? "Reconnect needed" : "Connected"}</small></span><div className="wd-apple-source-actions">
              {account.enabled && account.needsReconnect && <GoogleReconnectButton onConnected={load} />}
              {!account.enabled && <button type="button" className="wd-btn is-secondary is-compact" disabled={resuming !== null} onClick={() => void resume(account)}>{resuming === account.id ? "Resuming…" : "Resume connection"}</button>}
              <button type="button" className="wd-btn is-text is-compact" onClick={() => { setError(""); setRemoving(account); }}>Disconnect</button>
            </div></div>)}
            {!accounts.length && previewMode && googleConnected && <p className="wd-you-note">{user.email}</p>}
            <a className="wd-btn is-secondary is-compact" href="/api/connections/google/start">{googleConnected || accounts.length ? "Add account" : "Connect Google"}</a>
          </div>
        </SettingsDisclosure>
        {error && !removing && <p className="wd-you-error" role="alert">{error}</p>}
        {removing && (
          <div className="wd-you-confirm">
            <p>Remove {removing.email}? This revokes Dash’s Google access and stops Gmail and Calendar watches. Your history stays until you delete all data.</p>
            {error && <p className="wd-you-error" role="alert">{error}</p>}
            <div className="wd-sheet-foot-row">
              <button type="button" className="wd-btn is-secondary is-danger" onClick={() => void remove(removing)}>Remove account</button>
              <button type="button" className="wd-btn is-text" onClick={() => setRemoving(null)}>Keep</button>
            </div>
          </div>
        )}
      </section>}
      <AppleSources state={apple} search={search}>
        <ICloudMail key={user.email} search={query} previewMode={previewMode} ownerEmail={user.email} onAccountsChange={setICloudAccounts} />
        {(!query || "apple calendar events on this iphone".includes(query)) && <>
        <SettingsDisclosure className="wd-source-detail">
          <summary className="wd-source-summary"><SourceIcon name="calendar" row /><strong>Calendar</strong><button type="button" disabled={!calendarAvailable} className={`wd-source-state wd-source-connect${deviceCalendar.status === "authorized" ? "" : " wd-btn is-primary"}`} aria-label={deviceCalendar.status === "authorized" || calendarDenied ? "Manage Calendar permissions" : "Connect Calendar"} onClick={event => { event.preventDefault(); event.stopPropagation(); postNativeMessage({ version: 1, action: deviceCalendar.status === "authorized" || calendarDenied ? "openSystemSettings" : "requestCalendarAccess" }); }}>{deviceCalendar.status === "authorized" ? "✓" : calendarDenied ? "Open Settings" : apple.available === false && !previewMode ? "On iPhone" : "Connect"}</button></summary>
          <div className="wd-source-description"><p className="wd-you-note">{calendarStatus}. Read events directly from the calendars on this iPhone.</p>
          {deviceCalendar.status === "authorized" || calendarDenied
            ? <button type="button" className="wd-btn is-secondary is-compact" onClick={() => postNativeMessage({ version: 1, action: "openSystemSettings" })}>Manage permissions</button>
            : <button type="button" className="wd-btn is-secondary is-compact" disabled={!calendarAvailable} onClick={() => postNativeMessage({ version: 1, action: "requestCalendarAccess" })}>Connect Calendar</button>}
          </div>
        </SettingsDisclosure>
        </>}
      </AppleSources>
      <MoreConnectors previewMode={previewMode} active={active} search={search} hideSearch hasLocalMatches={localMatches} />

    </>
  );
}

function Memory({ previewMode, lifeProfile, onLifeProfile, panel, section }: YouProps & { section?: MemorySection }) {
  const [profile, setProfile] = useState<LifeProfileResponse | null>(lifeProfile ?? (previewMode ? uiPreviewLifeProfile : null));
  const [draft, setDraft] = useState<LifeProfileDraft>(() => lifeProfileDraft(lifeProfile?.profile ?? (previewMode ? uiPreviewLifeProfile.profile : null)));
  const draftEdited = useRef(false);
  const editDraft = (change: (current: LifeProfileDraft) => LifeProfileDraft) => { draftEdited.current = true; setDraft(change); };
  const [loading, setLoading] = useState(!previewMode && !lifeProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const load = () => setVersion((value) => value + 1);
  useEffect(() => {
    if (previewMode) return;
    let cancelled = false;
    setLoading(!profile);
    void fetch("/api/mobile/life-profile", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "What Dash knows could not be loaded."));
        const payload = await response.json() as LifeProfileResponse;
        if (cancelled) return;
        setProfile(payload); onLifeProfile?.(payload);
        if (!draftEdited.current) setDraft(lifeProfileDraft(payload.profile));
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "What Dash knows could not be loaded."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [previewMode, version]);
  const save = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/mobile/life-profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "settings", homeCity: draft.homeCity.trim() || null, customInstructions: draft.customInstructions.trim() || null }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Your profile could not be saved."));
      const payload = await response.json() as LifeProfileResponse;
      setProfile(payload); onLifeProfile?.(payload);
      draftEdited.current = false; setDraft(lifeProfileDraft(payload.profile));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Your profile could not be saved."); }
    finally { setSaving(false); }
  };
  const forget = async (factId: string) => {
    setError("");
    try {
      const response = await fetch(`/api/mobile/life-profile/facts/${encodeURIComponent(factId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "That memory could not be deleted."));
      load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "That memory could not be deleted."); }
  };
  return (
    <>
      {error && (!section || section === "people") && <p className="wd-you-error" role="alert">{error}</p>}
      {(panel === "preferences" || (section && ["about", "watch", "instructions"].includes(section))) && <section className="wd-you-group wd-memory-editor">
        {(panel === "preferences" || section === "about" || section === "watch") && <>
        <h2>About you</h2>
        <div className="wd-fields">
          <label><span className="wd-field-label"><SettingsGlyph name="pin" />Home city</span><input value={draft.homeCity} onChange={(event) => editDraft((current) => ({ ...current, homeCity: event.target.value }))} placeholder="Toronto" /></label>

        </div>
        </>}
        {(panel === "preferences" || section === "instructions" || section === "watch") && <>
        <div className="wd-fields">
          <label><span className="wd-field-label"><SettingsGlyph name="instructions" />Response style</span><textarea rows={4} maxLength={4000} value={draft.customInstructions} onChange={(event) => editDraft((current) => ({ ...current, customInstructions: event.target.value }))} placeholder="e.g. Keep replies short" /></label>
        </div>

        </>}
        {error && <p className="wd-you-error" role="alert">{error}</p>}
        <div className="wd-sheet-actions">
          <button type="button" className="wd-btn is-primary" disabled={saving || loading || previewMode} onClick={() => void save()}>{saving ? <span className="wd-spinner" /> : null}<span>Save</span></button>
        </div>
      </section>}
      {(panel === "memory" || section === "saved") && <section className="wd-you-group wd-saved-memories"><div className="wd-memory-section-heading"><h2>Saved memories</h2>{!loading && <span>{profile?.facts.filter(fact => fact.source === "conversation" && fact.kind !== "person").length ?? 0}</span>}</div>
        {error && <p className="wd-you-error" role="alert">{error}</p>}
        {loading && <p className="wd-you-note">Loading…</p>}
        {!loading && !profile?.facts.some((fact) => fact.source === "conversation" && fact.kind !== "person") && <p className="wd-you-note">No saved memories yet.</p>}
        <div className="wd-facts">
          {profile?.facts.filter((fact) => fact.source === "conversation" && fact.kind !== "person").map((fact) => (
            <div className="wd-fact" key={fact.id}>
              <SettingsGlyph name="saved" /><span>{lifeFactSummary(fact)}</span>
              <label className="wd-memory-actions">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
                <select onPointerDown={event => { event.currentTarget.dataset.pointerFocus = "true"; }} onBlur={event => { delete event.currentTarget.dataset.pointerFocus; }} onKeyDown={event => { delete event.currentTarget.dataset.pointerFocus; }} aria-label={`Actions for ${lifeFactSummary(fact)}`} value="" onChange={event => { if (event.target.value === "forget") void forget(fact.id); }}>
                  <option value="" disabled>Memory actions</option><option value="forget" disabled={previewMode}>Forget memory</option>
                </select>
              </label>
            </div>
          ))}
        </div>
        <p className="wd-memory-helper">You can ask Dash to remember or forget something in chat.</p>
      </section>}
      {(panel === "memory" || section === "people") && <section className="wd-you-group"><h2>People</h2><PeopleMemory profile={profile} loading={loading} previewMode={previewMode} onChange={payload => { setProfile(payload); onLifeProfile?.(payload); if (!previewMode) load(); }} /></section>}

    </>
  );
}

function Vault({ vaultItems, vaultLoading, previewMode, onVaultChanged, onVaultDelete, editor, setEditor }: YouProps & { editor: VaultEditor | null; setEditor: (editor: VaultEditor | null) => void }) {
  const content = useRef<HTMLDivElement>(null);
  const previousEditor = useRef(editor);
  useLayoutEffect(() => {
    if (previousEditor.current === editor) return;
    previousEditor.current = editor;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animation = content.current?.animate(reduced ? [{ opacity: .6 }, { opacity: 1 }] : [
      { transform: `translateX(${editor ? "100%" : "-25%"})`, opacity: .6 },
      { transform: "translateX(0)", opacity: 1 },
    ], { duration: reduced ? 100 : 280, easing: "cubic-bezier(.2,.75,.2,1)" });
    return () => animation?.cancel();
  }, [editor]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [label, setLabel] = useState(editor?.item?.label ?? "");
  const [siteHost, setSiteHost] = useState(editor?.item?.siteHost ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [cardholderName, setCardholderName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [billingPostalCode, setBillingPostalCode] = useState("");
  const open = (kind: "login" | "payment_card", item: VaultItemSummary | null) => {
    setEditor({ kind, item }); setError("");
    setLabel(item?.label ?? ""); setSiteHost(item?.siteHost ?? "");
    setUsername(""); setPassword(""); setCardholderName(""); setCardNumber(""); setCardExpiry(""); setBillingPostalCode("");
  };
  const expiry = parseCardExpiry(cardExpiry);
  const complete = editor?.kind === "login"
    ? Boolean(label.trim() && username.trim() && password)
    : Boolean(label.trim() && cardholderName.trim() && cardNumber.replace(/\D/g, "").length >= 12 && expiry);
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || !complete || saving) return;
    setSaving(true); setError("");
    try {
      if (previewMode) throw new Error("The preview vault is read-only.");
      const payload = editor.kind === "login"
        ? { kind: "login", label, siteHost, username, password }
        : { kind: "payment_card", label, cardholderName, cardNumber, expiryMonth: expiry?.month ?? "", expiryYear: expiry?.year ?? "", billingPostalCode };
      await requestNativeVault("vaultSave", { ...payload, itemId: editor.item?.id });
      await onVaultChanged();
      setEditor(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "That secure item could not be saved."); }
    finally { setSaving(false); }
  };
  const logins = vaultItems.filter((item) => item.kind === "login");
  const cards = vaultItems.filter((item) => item.kind === "payment_card");
  const list = (items: VaultItemSummary[], kind: "login" | "payment_card") => (
    <>
      {items.map((item) => (
        <div className="wd-you-row" key={item.id}>
          <button type="button" className="wd-you-row-main" onClick={() => open(kind, item)}>{kind === "login" ? <SourceIcon name="passwords" /> : <PaymentCardIcon brand={item.cardBrand} />}<span><strong>{item.label}</strong></span></button>
          <button type="button" className="wd-icon-action" aria-label={`Delete ${item.label}`} onClick={() => onVaultDelete(item)}><SettingsGlyph name="trash" /></button>
        </div>
      ))}
      <button type="button" className="wd-you-row" onClick={() => open(kind, null)}><SettingsGlyph name="plus" /><span><strong>Add {kind === "login" ? "login" : "card"}</strong></span></button>
    </>
  );
  return (
    <div ref={content} className="wd-vault-content">
      {vaultLoading && <p className="wd-you-note">Loading…</p>}
      {editor && (
        <form className="wd-you-group wd-you-editor" onSubmit={save}>
          <SettingsIntro icon={editor.kind === "login" ? "key" : "vault"} title={editor.item ? "Keep it up to date." : editor.kind === "login" ? "A login, ready when needed." : "A card, ready when needed."} description={editor.kind === "login" ? "Enter the sign-in details you want to save." : "Add your card details. CVC is never saved."} />
          <div className="wd-fields">
            <label><span className="wd-field-label"><SettingsGlyph name="tag" />Name</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={editor.kind === "login" ? "School portal" : "Personal Visa"} /></label>
            {editor.kind === "login" && <label><span className="wd-field-label"><SettingsGlyph name="sources" />Website (optional)</span><input value={siteHost} onChange={(event) => setSiteHost(event.target.value)} placeholder="example.com" autoCapitalize="none" /></label>}
            {editor.kind === "login" ? <>
              <label><span className="wd-field-label"><SettingsGlyph name="mail" />Username or email</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoCapitalize="none" autoComplete="username" placeholder={editor.item?.usernameHint ?? "name@example.com"} /></label>
              <label><span className="wd-field-label"><SettingsGlyph name="key" />Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label>
            </> : <>
              <label><span className="wd-field-label"><SettingsGlyph name="account" />Name on card</span><input value={cardholderName} onChange={(event) => setCardholderName(event.target.value)} autoComplete="cc-name" /></label>
              <label><span className="wd-field-label"><SettingsGlyph name="vault" />Card number</span><input inputMode="numeric" value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} autoComplete="cc-number" placeholder={editor.item?.cardLast4 ? `•••• •••• •••• ${editor.item.cardLast4}` : "1234 5678 9012 3456"} /></label>
              <div className="wd-fields-row">
                <label><span className="wd-field-label"><SettingsGlyph name="clock" />Expiry</span><input inputMode="numeric" value={cardExpiry} onChange={(event) => setCardExpiry(formatCardExpiry(event.target.value))} autoComplete="cc-exp" placeholder="MM/YY" maxLength={7} /></label>
                <label><span className="wd-field-label"><SettingsGlyph name="pin" />Postal code</span><input value={billingPostalCode} onChange={(event) => setBillingPostalCode(event.target.value)} autoComplete="postal-code" /></label>
              </div>
              <p className="wd-card-note">Use this card at any checkout. You choose and unlock it each time. CVC is never saved.</p>
            </>}
          </div>
          {error && <p className="wd-you-error" role="alert">{error}</p>}
          <div className="wd-sheet-actions">
            <button type="submit" className="wd-btn is-primary" disabled={!complete || saving}>{saving ? <span className="wd-spinner" /> : null}<span>Save</span></button>
            <button type="button" className="wd-btn is-text" onClick={() => setEditor(null)}>Cancel</button>
          </div>
        </form>
      )}
      {!editor && <section className="wd-you-group"><h2>Logins</h2><div className="wd-you-manage-list">{list(logins, "login")}</div></section>}
      {!editor && <section className="wd-you-group"><h2>Cards</h2><div className="wd-you-manage-list">{list(cards, "payment_card")}</div></section>}
    </div>
  );
}

function Account({ user, onDeleteData, onDeleteAccount, onSignOut, onProfilePhotoChanged, previewMode }: YouProps) {
  return (
    <>
      <section className="wd-you-group wd-account-group">
        <div className="wd-you-row"><ProfilePhotoEditor image={user.image} initial={user.name[0] || "U"} onChanged={onProfilePhotoChanged} previewMode={previewMode} /><span><strong>{user.name}</strong><small>{user.email}</small></span></div>
        <button type="button" className="wd-you-row" onClick={onSignOut}><SettingsGlyph name="logout" /><span><strong>Sign out</strong></span><Chevron /></button>
      </section>
      <section className="wd-you-group wd-account-group">
        <h2>Data</h2>
        <button type="button" className="wd-you-row is-danger" onClick={onDeleteData}><SettingsGlyph name="trash" /><span><strong>Delete data</strong></span><Chevron /></button>
        <button type="button" className="wd-you-row is-danger" onClick={onDeleteAccount}><SettingsGlyph name="account" /><span><strong>Delete account</strong></span><Chevron /></button>
      </section>
      <SettingsLegal />
    </>
  );
}
