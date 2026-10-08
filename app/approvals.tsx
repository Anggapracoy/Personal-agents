"use client";
import { InlinePanelContent } from "./inline-panel";
import { MailSheet } from "./result-blocks";
import { ChoiceReceipt } from "./choice-options";
import { ChoiceOptions } from "./choice-options";
import { CalendarApprovalIcon } from "./calendar-approval-icon";
import { readableCalendarApproval } from "../lib/calendar-approval-preview";
import { appleActionSource, appleActionValue, usableAppleConnection, connectAndContinueAppleAction } from "./apple-action-connection";
import { SiteReceiptIcon } from "./site-receipt-icon";
import { PaymentCardIcon } from "./payment-card-icon";
import { checkoutDisplayTotal } from "../lib/checkout-display";
import { FinancialApprovalIcon } from "./checkout-icon";
import { AnswersSummary } from "./conversation-status";
import type { AppleConnection } from "../lib/apple/catalog";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentRunSnapshot } from "../lib/harness/types";
import type { AgentQuestion } from "../lib/harness/questions";
import type { RunningTask } from "../lib/types";
import { requestNativeVault, requestNativeSignIn, requestNativeApple, postNativeMessage, responseError, hasNativeBridge, hasNativeAppleConnections, hasNativeVaultSelection, type VaultItemSummary } from "./native-bridge";
import { formatCardExpiry, parseCardExpiry } from "../lib/card-expiry";

/* Every "needs you" moment renders as one card in the thread. Same skeleton: title, one line, actions. */

function Card({ title, sub, children, className }: { title: React.ReactNode; sub?: string; children?: React.ReactNode; className?: string }) {
  return (
    <section className={`wd-card${className ? ` ${className}` : ""}`}>
      <header><strong>{title}</strong>{sub && <small>{sub}</small>}</header>
      {children}
    </section>
  );
}

export function hostOf(value?: string, fallback = "the website") {
  if (!value) return fallback;
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return fallback; }
}

function merchantFaviconUrl(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`;
  } catch { return null; }
}

/** Sign-in handoff. On the phone: opens the site in an isolated in-app browser, then posts cookies to /signin. Desktop: falls back to the remote browser. */
export function SignInCard({ task, skipping, onResumed, onSkip, onOpenBrowser }: { task: RunningTask; skipping: boolean; onResumed: (snapshot: AgentRunSnapshot) => void; onSkip: () => void; onOpenBrowser: () => void }) {
  const host = hostOf(task.approvalRequest?.pageUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const native = typeof window !== "undefined" && hasNativeBridge();
  const start = async () => {
    if (!task.runId || !task.actionId || !task.approvalRequest?.pageUrl || busy) return;
    setBusy(true); setError("");
    try {
      const result = await requestNativeSignIn(task.runId, task.approvalRequest.pageUrl, host);
      if (!result.ok) return; // Closing the sheet leaves this sign-in request available.
      const response = await fetch(`/api/runs/${task.runId}/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actionId: task.actionId, ok: result.ok, finalUrl: result.finalUrl, cookies: result.cookies ?? [] }) });
      if (!response.ok) throw new Error(await responseError(response, "The sign-in could not be handed off."));
      onResumed(await response.json() as AgentRunSnapshot);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The sign-in could not be handed off."); }
    finally { setBusy(false); }
  };
  return (
    <Card title={<span className="wd-signin-heading"><SiteReceiptIcon host={host} /><span>Sign in to {host}</span></span>} sub={task.approvalRequest?.reason || "I need your account here to keep going."}>
      {error && <p className="wd-card-error" role="alert">{error}</p>}
      <div className="wd-card-actions">
        <button type="button" className="wd-btn is-primary" disabled={busy || skipping} onClick={native ? () => void start() : onOpenBrowser}>{busy ? <span className="wd-spinner" /> : null}<span>{native ? `Sign in to ${host}` : "Open the browser"}</span></button>
        <button type="button" className="wd-btn is-text" disabled={busy || skipping} onClick={onSkip}>Not now</button>
      </div>
    </Card>
  );
}

export function TakeoverCard({ task, skipping, onOpenBrowser, onSkip, onContinue }: { task: RunningTask; skipping: boolean; onOpenBrowser: () => void; onSkip: () => void; onContinue: () => Promise<boolean> }) {
  const waiting = task.approvalRequest?.mode === "wait_for_user";
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState("");
  const resume = async () => {
    if (continuing) return;
    setContinuing(true); setError("");
    try { if (!await onContinue()) setError("Couldn’t continue. Please try again."); }
    catch { setError("Couldn’t continue. Please try again."); }
    finally { setContinuing(false); }
  };
  const host = hostOf(task.approvalRequest?.pageUrl);
  return (
    <Card title={`${host} needs you`} sub={task.approvalRequest?.reason || "Finish this step yourself, then tap Done."}>
      <div className="wd-card-actions">
        <button type="button" className="wd-btn is-primary" disabled={skipping || continuing} onClick={waiting ? () => void resume() : onOpenBrowser}>{continuing && <span className="wd-spinner" />}<span>{waiting ? "Continue when done" : "Open the browser"}</span></button>
        <button type="button" className="wd-btn is-text" disabled={skipping || continuing} onClick={onSkip}>Not now</button>
        {error && <p className="wd-card-error" role="alert">{error}</p>}
      </div>
    </Card>
  );
}

export function ReconnectCard({ busy, error, onReconnect, onSkip }: { busy: boolean; error?: string; onReconnect: () => void; onSkip: () => void }) {
  return (
    <Card title="Google needs reconnecting" sub="Your Gmail or Calendar access expired.">
      {error && <p className="wd-card-error" role="alert">{error}</p>}
      <div className="wd-card-actions">
        <button type="button" className="wd-btn is-primary" disabled={busy} onClick={onReconnect}>{busy ? <span className="wd-spinner" /> : null}<span>Reconnect Google</span></button>
        <button type="button" className="wd-btn is-text" disabled={busy} onClick={onSkip}>Not now</button>
      </div>
    </Card>
  );
}

export function ExternalApprovalCard({ task, busy, onApprove, onCancel }: { task: RunningTask; busy: boolean; onApprove: () => void; onCancel: () => void }) {
  const [title, ...rest] = readableCalendarApproval(task.draft ?? "Approve to continue").split("\n");
  const calendar = /^(Create|Update) Calendar event/.test(title);
  return (
    <Card title={calendar ? <span className="wd-calendar-approval-heading"><CalendarApprovalIcon />{title}</span> : title || "Approve to continue"} sub={/^(Create|Update) Calendar event/.test(title) ? undefined : rest.filter(Boolean).join(" ").slice(0, 240) || undefined}>
      {/^(Create|Update) Calendar event/.test(title) && <div className="wd-calendar-approval-details">{rest.filter(Boolean).map((line, index) => <p key={index} className="wd-calendar-approval-row"><CalendarApprovalIcon kind={/^(Starts|Ends):/.test(line) ? "time" : line.startsWith("Location:") ? "location" : /^(Guests|Invitation response):/.test(line) ? "guests" : index === 0 ? "calendar" : "note"} /><span>{line}</span></p>)}</div>}
      <div className="wd-card-actions">
        <button type="button" className="wd-btn is-primary" disabled={busy} onClick={onApprove}>{busy ? <span className="wd-spinner" /> : null}<span>Approve</span></button>
        <button type="button" className="wd-btn is-text" disabled={busy} onClick={onCancel}>Stop</button>
      </div>
    </Card>
  );
}

export function SensitiveActionCard({ task, denying, onApprove, onDeny, onOpenBrowser, payment }: { payment?: { detail: string }; onOpenBrowser?: () => void; task: RunningTask; denying: boolean; onApprove: (mode: "once" | "always", emailEdit?: { subject: string; body: string }) => Promise<boolean>; onDeny: () => void }) {
  const [submitting, setSubmitting] = useState<"once" | "always" | null>(null);
  const [error, setError] = useState("");
  const email = task.approvalKind === "email_send";
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(task.approvalRequest?.subject ?? "");
  const [body, setBody] = useState(task.approvalRequest?.body ?? task.draft ?? "");
  const bodyField = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { const field = bodyField.current; if (field) { field.style.height = "auto"; field.style.height = `${field.scrollHeight}px`; } }, [body, editing]);
  useEffect(() => {
    setEditing(false); setSubject(task.approvalRequest?.subject ?? ""); setBody(task.approvalRequest?.body ?? task.draft ?? "");
  }, [task.actionId]);
  const changed = subject !== (task.approvalRequest?.subject ?? "") || body !== (task.approvalRequest?.body ?? task.draft ?? "");
  const submit = async (mode: "once" | "always") => {
    if (submitting || denying) return;
    if (email && (!subject.trim() || /[\r\n]/.test(subject) || !body.trim())) { setError("Add a subject and message before sending."); return; }
    setSubmitting(mode); setError("");
    if (!email) postNativeMessage({ version: 1, action: "hapticSelection" });
    try { if (!await onApprove(mode, email && changed ? { subject, body } : undefined)) setError("This approval is no longer waiting."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The task could not continue."); }
    finally { setSubmitting(null); }
  };
  const merchant = hostOf(task.approvalRequest?.pageUrl, "the website");
  const faviconUrl = merchantFaviconUrl(task.approvalRequest?.pageUrl);
  const [faviconState, setFaviconState] = useState<{ url: string; state: "loaded" | "failed" }>({ url: "", state: "failed" });
  const faviconLoaded = Boolean(faviconUrl && faviconState.url === faviconUrl && faviconState.state === "loaded");
  const faviconFailed = Boolean(faviconUrl && faviconState.url === faviconUrl && faviconState.state === "failed");
  const frame = task.browserFrames?.findLast(frame => frame.url && hostOf(frame.url) === merchant);
  const approvalType = task.approvalRequest?.approvalType ?? "purchase";
  const amount = checkoutDisplayTotal(task.approvalRequest?.purpose);
  const copy = approvalType === "bill_payment"
    ? { label: "Bill payment approval", heading: `Bill payment · Dash wants to pay a bill at ${merchant}`, note: task.approvalRequest?.purpose || "Verify the bill and payment details on the website before approving.", review: "Review bill", amount: "Payment amount" }
    : approvalType === "transfer"
      ? { label: "Transfer approval", heading: `Transfer · Dash wants to send money at ${merchant}`, note: task.approvalRequest?.purpose || "Verify the recipient and transfer details on the website before approving.", review: "Review transfer", amount: "Transfer amount" }
      : approvalType === "payment"
        ? { label: "Payment approval", heading: `Payment · Dash wants to pay at ${merchant}`, note: task.approvalRequest?.purpose || "Verify the payment details on the website before approving.", review: "Review payment", amount: "Payment amount" }
        : { label: "Purchase approval", heading: `Checkout · Dash wants to place an order at ${merchant}`, note: "Verify the details and terms of your order on the merchant website before approving.", review: "Review order", amount: "Estimated total" };
  if (!email) return <section className="wd-card wd-checkout" aria-label={copy.label} aria-description={task.approvalRequest?.purpose}>
    <div className="wd-checkout-heading"><FinancialApprovalIcon type={approvalType} /><strong>{copy.heading}</strong></div>
    <p className="wd-checkout-note">{copy.note}</p>
    <div className="wd-checkout-preview">
      {frame && task.runId && <img key={frame.id} className="wd-checkout-screenshot" src={`/api/runs/${task.runId}/artifacts/${frame.id}`} alt="Latest checkout view" onError={event => { event.currentTarget.style.display = "none"; }} />}
      {onOpenBrowser && <button type="button" className="wd-checkout-review" onClick={onOpenBrowser}><span className="wd-checkout-merchant" aria-hidden="true">{!faviconLoaded && merchant[0].toUpperCase()}{faviconUrl && !faviconFailed && <img src={faviconUrl} alt="" referrerPolicy="no-referrer" onLoad={() => setFaviconState({ url: faviconUrl, state: "loaded" })} onError={() => setFaviconState({ url: faviconUrl, state: "failed" })} style={{ opacity: faviconLoaded ? 1 : 0 }} />}</span>{copy.review} <span aria-hidden="true">↗</span></button>}
    </div>
    {payment && <div className="wd-checkout-payment"><PaymentCardIcon brand={payment.detail.split("•")[0].trim()} /><div><strong>{payment.detail}</strong><span>Selected payment card</span></div></div>}
    {amount && <div className="wd-checkout-total"><span>{copy.amount}</span><strong>{amount}</strong></div>}
    {error && <p className="wd-card-error" role="alert">{error}</p>}
    <div className="wd-checkout-actions">
      <button type="button" className="wd-btn is-primary" disabled={Boolean(submitting) || denying} onClick={() => void submit("once")}>{submitting === "once" && <span className="wd-spinner" />}Allow</button>
      <button type="button" className="wd-btn is-secondary" disabled={Boolean(submitting) || denying} onClick={onDeny}>Deny</button>
    </div>
  </section>;
  return (
    <Card title="Send this email?" className="is-sensitive">
      <MailSheet
        to={task.approvalRequest?.to?.join(", ") || "Recipient"}
        subject={editing ? <input className="wd-email-subject-input" aria-label="Email subject" value={subject} maxLength={300} disabled={Boolean(submitting) || denying} onChange={event => setSubject(event.target.value)} /> : subject || "Email"}
        body={editing
          ? <div className="wd-block-draft-body"><textarea ref={bodyField} className="wd-email-body" aria-label="Email message" value={body} maxLength={30000} rows={1} disabled={Boolean(submitting) || denying} onChange={event => setBody(event.target.value)} /></div>
          : <p className="wd-block-draft-body" onClick={() => setEditing(true)}>{body}</p>}
      />
      {error && <p className="wd-card-error" role="alert">{error}</p>}
      <div className="wd-card-actions">
        <button type="button" className="wd-btn is-primary" disabled={Boolean(submitting) || denying} onClick={() => void submit("once")}>{submitting === "once" ? <span className="wd-spinner" /> : null}<span>Send</span></button>
        <button type="button" className="wd-btn is-secondary" disabled={Boolean(submitting) || denying} onClick={() => setEditing(!editing)}>{editing ? "Done" : "Edit"}</button>
        <button type="button" className="wd-btn is-text" disabled={Boolean(submitting) || denying} onClick={onDeny}>Don’t send</button>
      </div>
    </Card>
  );
}

export function VaultCard({ task, skipping, onSaved, onSkip }: { task: RunningTask; skipping: boolean; onSaved: (snapshot: AgentRunSnapshot) => void; onSkip: () => void }) {
  const payment = task.approvalKind === "vault_payment";
  const [saving, setSaving] = useState(false);
  const [authenticatedItem, setAuthenticatedItem] = useState<VaultItemSummary | null>(null);
  const [vaultItems, setVaultItems] = useState<VaultItemSummary[]>([]);
  const [loading, setLoading] = useState(!task.approvalRequest?.deviceRelease);
  const [addingNew, setAddingNew] = useState(false);
  const suggestedLabel = task.approvalRequest?.suggestedLabel?.trim() ?? "";
  const siteHost = task.approvalRequest?.siteHost?.trim() ?? "";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [cardholderName, setCardholderName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [billingPostalCode, setBillingPostalCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const hostServiceName = siteHost.replace(/^www\./i, "").split(".")[0]?.replace(/[-_]+/g, " ").trim() ?? "";
  const serviceName = (payment ? suggestedLabel.replace(/^(?:payment\s+)?card\s+for\s+/i, "") : suggestedLabel) || hostServiceName || "this website";
  const label = suggestedLabel || `${payment ? "Payment card" : "Login"} for ${serviceName}`;
  const expiry = parseCardExpiry(cardExpiry);
  const complete = payment ? cardholderName.trim() && cardNumber.replace(/\D/g, "").length >= 12 && expiry !== null : username.trim() && password;
  const normalizedSiteHost = siteHost.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const matching = vaultItems.filter((item) => item.kind === (payment ? "payment_card" : "login") && (payment || !normalizedSiteHost || !item.siteHost || item.siteHost === normalizedSiteHost));

  useEffect(() => {
    if (task.approvalRequest?.deviceRelease) return;
    const controller = new AbortController();
    setLoading(true);
    void fetch("/api/vault", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Your saved details could not be loaded."); setVaultItems((await response.json() as { items: VaultItemSummary[] }).items); })
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Your saved details could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [task.actionId, task.approvalRequest?.deviceRelease]);

  const unlockSelected = async (item: VaultItemSummary) => {
    if (hasNativeVaultSelection()) {
      const result = await requestNativeVault("vaultRelease", { prepareSelection: true, runId: task.runId, actionId: task.actionId, itemId: item.id, kind: item.kind }, () => { if (item.kind === "login") setAuthenticatedItem(item); });
      if (!result.snapshot) throw new Error("The task did not resume after unlocking.");
      onSaved(result.snapshot);
      return;
    }
    const response = await fetch(`/api/runs/${task.runId}/vault`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actionId: task.actionId, itemId: item.id }) });
    if (!response.ok) throw new Error(await responseError(response, "That saved item could not be selected."));
    const challenge = await response.json() as { recipientPublicKey: string; kind: string; needSecurityCode: boolean };
    const result = await requestNativeVault("vaultRelease", { runId: task.runId, actionId: task.actionId, itemId: item.id, ...challenge });
    if (!result.snapshot) throw new Error("The task did not resume after unlocking.");
    onSaved(result.snapshot);
  };

  const chooseSaved = async (item: VaultItemSummary) => {
    if (!task.runId || !task.actionId || saving) return;
    setSaving(true); setAuthenticatedItem(null); setError("");
    try {
      await unlockSelected(item);
    } catch (caught) { setAuthenticatedItem(null); setError(caught instanceof Error ? caught.message : "That saved item could not be selected."); }
    finally { setSaving(false); }
  };

  const actions = (primary: React.ReactNode) => <div className="wd-card-actions">{primary}<button type="button" className="wd-btn is-text" onClick={onSkip} disabled={saving || skipping}>Not now</button></div>;

  // Login unlock can preview its selection during handoff. Payment cards keep
  // the picker until the full release completes, including any CVC entry.
  if (authenticatedItem && saving) return <div aria-busy="true"><AnswersSummary compact answers={[]} vault={{ kind: authenticatedItem.kind, label: authenticatedItem.label, detail: authenticatedItem.kind === "login" ? authenticatedItem.usernameHint || "Unlocked on this iPhone" : [authenticatedItem.cardBrand, authenticatedItem.cardLast4 ? `•••• ${authenticatedItem.cardLast4}` : ""].filter(Boolean).join(" ") || "Unlocked on this iPhone" }} /></div>;

  if (task.approvalRequest?.deviceRelease) return (
    <Card title="Unlock to continue" sub={siteHost ? `Use your saved ${payment ? "card" : "login"} for ${siteHost}.` : task.approvalRequest.reason ?? `Use Face ID to fill this ${payment ? "card" : "login"}.`}>
      <p className="wd-card-note">Your saved details stay encrypted on this iPhone. Dash never sees them.</p>
      {error && <p className="wd-card-error" role="alert">{error}</p>}
      {actions(<button type="button" className="wd-btn is-primary" data-busy-label disabled={saving || skipping} onClick={async () => {
        if (!task.runId || !task.actionId || !task.approvalRequest?.itemId || !task.approvalRequest.recipientPublicKey || saving) return;
        setSaving(true); setError("");
        try {
          const result = await requestNativeVault("vaultRelease", { runId: task.runId, actionId: task.actionId, itemId: task.approvalRequest.itemId, kind: task.approvalRequest.kind, recipientPublicKey: task.approvalRequest.recipientPublicKey, needSecurityCode: task.approvalRequest.needSecurityCode === true });
          if (!result.snapshot) throw new Error("The task did not resume after unlocking.");
          onSaved(result.snapshot);
        } catch (caught) { setError(caught instanceof Error ? caught.message : "The iPhone vault could not be unlocked."); }
        finally { setSaving(false); }
      }}>{saving ? <span className="wd-spinner" /> : null}<span>{saving ? "Waiting for Face ID…" : "Unlock and continue"}</span></button>)}
    </Card>
  );
  if (loading) return <Card title={`Checking your saved ${payment ? "cards" : "logins"}`} sub={siteHost || "Securely stored on this iPhone"} />;
  if (matching.length > 0 && !addingNew) return (
    <InlinePanelContent active={!addingNew}><Card className={payment ? "wd-vault-picker" : undefined} title={payment ? "Choose a card" : matching.length > 1 ? "Which login should I use?" : "Use this saved login?"} sub={siteHost || task.approvalRequest?.reason || undefined}>
      <div className={`wd-choices${payment ? " wd-vault-card-choices" : ""}`}>
        {matching.map((item) => <button key={item.id} type="button" aria-label={payment ? `${item.label}, ${item.cardBrand || "Card"} ending ${item.cardLast4 || "unknown"}` : undefined} disabled={saving || skipping} onClick={() => void chooseSaved(item)}>{payment && <PaymentCardIcon brand={item.cardBrand}/>}<span><strong>{payment ? item.cardBrand || item.label : item.label}</strong><small>{item.kind === "login" ? item.usernameHint || item.siteHost || "Saved login" : `•••• ${item.cardLast4 ?? "••••"}`}</small></span><b aria-hidden="true">›</b></button>)}
        <button type="button" className="is-add" disabled={saving || skipping} onClick={() => setAddingNew(true)}><span><strong>Add another {payment ? "card" : "login"}</strong></span><b aria-hidden="true">+</b></button>
      </div>
      <p className="wd-card-note" role="status">{saving ? "Waiting for Face ID or password…" : payment ? "Unlock securely with Face ID or your password." : "Choose, then unlock with Face ID or your password to continue."}</p>
      {error && <p className="wd-card-error" role="alert">{error}</p>}
      {actions(null)}
    </Card></InlinePanelContent>
  );
  return (
    <InlinePanelContent active={!addingNew}><form className="wd-card" onSubmit={async (event) => {
      event.preventDefault();
      if (!task.runId || !task.actionId || !complete || saving) return;
      setSaving(true); setError("");
      try {
        const payload = payment
          ? { kind: "payment_card", label: "Payment card", cardholderName, cardNumber, expiryMonth: expiry?.month ?? "", expiryYear: expiry?.year ?? "", billingPostalCode }
          : { kind: "login", label, siteHost, username, password };
        const result = await requestNativeVault("vaultSave", payload);
        if (!result.item) throw new Error("The saved item could not be found.");
        const savedItem = result.item;
        setVaultItems((items) => [...items.filter((item) => item.id !== savedItem.id), savedItem]);
        setAddingNew(false);
        setUsername(""); setPassword(""); setCardholderName(""); setCardNumber(""); setCardExpiry(""); setBillingPostalCode("");
        await unlockSelected(result.item);
      } catch (caught) { setError(caught instanceof Error ? caught.message : "Those details could not be saved."); }
      finally { setSaving(false); }
    }}>
      <header><strong>{addingNew ? `Add another ${payment ? "card" : "login"}` : payment ? "Add a card to continue" : `Add your ${serviceName} login`}</strong><small>{!payment && siteHost ? siteHost : task.approvalRequest?.reason ?? `I need ${payment ? "payment details" : "a login"} to keep going.`}</small>{addingNew && <button type="button" className="wd-link" onClick={() => setAddingNew(false)}>Back</button>}</header>
      <div className="wd-fields">
        {payment ? <>
          <label><span>Name on card</span><input autoFocus={typeof window !== "undefined" && !hasNativeBridge()} value={cardholderName} onChange={(event) => setCardholderName(event.target.value)} autoComplete="cc-name" /></label>
          <label><span>Card number</span><input type="password" inputMode="numeric" value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} autoComplete="cc-number" /></label>
          <div className="wd-fields-row">
            <label><span>Expiry</span><input inputMode="numeric" value={cardExpiry} onChange={(event) => setCardExpiry(formatCardExpiry(event.target.value))} autoComplete="cc-exp" placeholder="MM/YY" maxLength={7} /></label>
            <label><span>Postal code</span><input value={billingPostalCode} onChange={(event) => setBillingPostalCode(event.target.value)} /></label>
          </div>
          <p className="wd-card-note">CVC is asked for at purchase time and never saved.</p>
        </> : <>
          <label><span>Username or email</span><input autoFocus={typeof window !== "undefined" && !hasNativeBridge()} value={username} onChange={(event) => setUsername(event.target.value)} autoCapitalize="none" autoComplete="username" /></label>
          <label><span>Password</span><span className="wd-password"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /><button type="button" aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? "Hide" : "Show"}</button></span></label>
          <p className="wd-card-note">Encrypted in your iPhone Keychain. Dash never sees it.</p>
        </>}
      </div>
      {error && <p className="wd-card-error" role="alert">{error}</p>}
      {actions(<button type="submit" className="wd-btn is-primary" disabled={!complete || saving || skipping}>{saving ? <span className="wd-spinner" /> : null}<span>{payment ? "Save card and continue" : "Save and continue"}</span></button>)}
    </form></InlinePanelContent>
  );
}

type PendingQuestionResponse = { selectedOptionIds: string[]; text: string };

export function QuestionsCard({ task, skipping, onAnswered, onSkip }: { task: RunningTask; skipping: boolean; onAnswered: (snapshot: AgentRunSnapshot) => void; onSkip: () => void }) {
  const questions = task.questionRequest?.questions ?? [];
  const [responses, setResponses] = useState<Record<string, PendingQuestionResponse>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [optimistic,setOptimistic]=useState<Array<{question:string;answer:string;choice:boolean;selectedOptions:Array<{label:string}>}>|null>(null);
  const inFlight = useRef(false);
  const responseFor = (question: AgentQuestion) => responses[question.id] ?? { selectedOptionIds: [], text: "" };
  const isAnswered = (question: AgentQuestion, values: Record<string, PendingQuestionResponse>) => { const r = values[question.id]; return Boolean(r && (question.answerType === "single_choice" || question.answerType === "multiple_choice" ? r.selectedOptionIds.length : r.text.trim().length)); };
  const complete = questions.length > 0 && questions.every(question=>isAnswered(question,responses));
  const submit = async (values: Record<string, PendingQuestionResponse>) => {
      if (!task.runId || !task.actionId || inFlight.current || skipping || !questions.length || !questions.every(question=>isAnswered(question,values))) return;
      inFlight.current=true; setSubmitting(true); setError("");
      if(questions.every(question=>question.answerType === "single_choice" || question.answerType === "multiple_choice")) setOptimistic(questions.map(question=>({question:question.question,answer:"",choice:true,selectedOptions:question.options.flatMap((option,index)=>values[question.id].selectedOptionIds.includes(option.id)?[{label:option.label}]:[])})));
      try {
        const response = await fetch(`/api/runs/${task.runId}/questions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actionId: task.actionId, responses: questions.map(question => ({ questionId: question.id, ...values[question.id] })) }) });
        if (!response.ok) throw new Error(await responseError(response, "Your answers could not be saved."));
        onAnswered(await response.json() as AgentRunSnapshot);
      } catch (caught) { setOptimistic(null); setError(caught instanceof Error ? caught.message : "Your answers could not be saved."); }
      finally { inFlight.current=false; setSubmitting(false); }
  };
  return (
    <InlinePanelContent preserveBubble active={!optimistic}>{optimistic ? <ChoiceReceipt answers={optimistic} pending={submitting}/> : <form className="wd-card wd-inline-card wd-question-card" onSubmit={event=>{event.preventDefault();void submit(responses);}}>
      <header className="wd-inline-header"><strong>{questions.length === 1 ? questions[0]?.question : "A few questions"}</strong>{questions.length === 1 && (questions[0]?.answerType === "single_choice" || questions[0]?.answerType === "multiple_choice") && <small>{questions[0].answerType === "multiple_choice" ? "Choose any that apply" : "Pick one"}</small>}</header>
      {questions.map((question, index) => {
        const current = responseFor(question);
        const choice = question.answerType === "single_choice" || question.answerType === "multiple_choice";
        return (
          <fieldset className="wd-question" key={question.id}>
            <legend className={questions.length === 1 ? "wd-question-legend-hidden" : undefined}>{question.question}{question.answerType === "multiple_choice" && <small> · any that apply</small>}</legend>
            {choice ? (
              <>
                <ChoiceOptions options={question.options} selected={current.selectedOptionIds} multiple={question.answerType === "multiple_choice"} disabled={submitting || skipping} onChoose={id=>{
                  const selectedOptionIds = question.answerType === "multiple_choice" ? (current.selectedOptionIds.includes(id) ? current.selectedOptionIds.filter(value=>value!==id) : [...current.selectedOptionIds,id]) : [id];
                  const next={...responses,[question.id]:{text:"",selectedOptionIds}};setResponses(next);setError("");
                }} />
              </>
            ) : (
              <label className="wd-fields"><input autoFocus={index === 0 && typeof window !== "undefined" && !hasNativeBridge()} autoCapitalize={question.answerType === "secret" ? "none" : undefined} autoComplete={question.answerType === "secret" ? "new-password" : "off"} maxLength={2000} placeholder={question.placeholder || (question.answerType === "secret" ? "Enter securely" : "Type your answer")} type={question.answerType === "secret" ? "password" : "text"} value={current.text} onChange={(event) => { setResponses((items) => ({ ...items, [question.id]: { selectedOptionIds: [], text: event.target.value } })); setError(""); }} />{question.answerType === "secret" && <span className="wd-card-note">Encrypted and hidden from Dash.</span>}</label>
            )}
          </fieldset>
        );
      })}
      {error && <p className="wd-card-error" role="alert">{error}</p>}
      <div className="wd-card-actions">
        <button type="submit" className="wd-btn is-primary" disabled={!complete || submitting || skipping}>{submitting ? <span className="wd-spinner" /> : null}<span>Continue</span></button>
        <button type="button" className="wd-btn is-secondary" onClick={onSkip} disabled={submitting || skipping}>Skip</button>
      </div>
    </form>}</InlinePanelContent>
  );
}


type AppleActionCardProps = { task: RunningTask; onApprove: (retry?: boolean) => Promise<boolean>; onCancel: () => void };
export function AppleActionCard(props: AppleActionCardProps) {
  // A new device action must never render the previous action's connection/error state.
  return <AppleActionConnection key={`${props.task.runId}:${props.task.actionId}:${props.task.nativeAction?.operation}`} {...props} />;
}
function AppleActionConnection({ task, onApprove, onCancel }: AppleActionCardProps) {
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [connection, setConnection] = useState<AppleConnection>();
  const [error, setError] = useState("");
  const [accessError, setAccessError] = useState("");
  const problem = error || accessError;
  const attempted = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const approveRef = useRef(onApprove); approveRef.current = onApprove;
  const action = task.nativeAction;
  const source = appleActionSource(action?.operation ?? "");
  const supported = hasNativeAppleConnections();
  const ready = usableAppleConnection(connection);
  const needsConnection = Boolean(source && connection && !ready);
  const denied = connection?.status === "denied";
  const unavailable = connection?.status === "unavailable";

  useEffect(() => {
    const token = ++generation.current;
    inFlight.current = false; setBusy(false); setConnection(undefined); setError(""); setAccessError(""); setChecking(supported);
    const refresh = async () => {
      if (!supported || !source) { setChecking(false); return; }
      try {
        const result = await requestNativeApple("status");
        if (generation.current !== token) return;
        const current = result.connections?.find(item => item.id === source.id);
        if (!current) throw new Error("Couldn't check this source. Try again.");
        setConnection(current); setAccessError("");
      } catch (caught) { if (generation.current === token) setAccessError(caught instanceof Error ? caught.message : "Couldn't check this source."); }
      finally { if (generation.current === token) setChecking(false); }
    };
    void refresh();
    const visible = () => { if (document.visibilityState === "visible" && !inFlight.current) void refresh(); };
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    return () => { generation.current += 1; window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [supported, source?.id, task.actionId]);

  const run = async (connect: boolean, automatic = false) => {
    if (inFlight.current || !supported || !source) return;
    const token = generation.current;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (!connect && !connection) {
        const checked = (await requestNativeApple("status")).connections?.find(item => item.id === source.id);
        if (generation.current !== token) return;
        if (!checked) throw new Error("Couldn't check this source. Try again.");
        setConnection(checked);
        if (!usableAppleConnection(checked)) return;
      }
      const completed = connect ? await connectAndContinueAppleAction(source.id, {
        connect: async service => (await requestNativeApple("connect", { service })).connections ?? [],
        onConnected: setConnection,
        isCurrent: () => generation.current === token,
        execute: () => approveRef.current(true),
      }) : await approveRef.current(!automatic);
      if (generation.current === token && !completed) setError("This iPhone action is no longer waiting.");
    } catch (caught) {
      if (generation.current !== token) return;
      setError(caught instanceof Error ? caught.message : "Couldn't finish on your iPhone.");
      // Permission denial or cancelling a picker leaves the original action pending.
      try { const result = await requestNativeApple("status"); if (generation.current === token) setConnection(result.connections?.find(item => item.id === source.id)); } catch { /* Keep the recoverable error. */ }
    } finally { if (generation.current === token) { inFlight.current = false; setBusy(false); } }
  };
  useEffect(() => {
    if (!supported || checking || !ready || problem || !task.actionId || attempted.current === task.actionId) return;
    attempted.current = task.actionId;
    void run(false, true);
    // One automatic attempt per connected action. Failed transport retries are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, checking, ready, problem, task.actionId]);
  // The server cannot see the native bridge. Keep the first render quiet until
  // the client has checked capability, then show only a resolved access problem.
  if (checking || (supported && !problem && ready)) return null;
  const [purpose] = (task.draft ?? "Continue on your iPhone").split("\n");
  const title = needsConnection ? `Connect ${source!.name}` : purpose;
  const sub = !supported ? "Open the latest Dash iPhone app to continue."
    : checking ? "Checking access on this iPhone…"
    : denied ? `iOS has blocked ${source?.name} access. Enable it in iPhone Settings, then return here. This request will stay waiting.`
    : unavailable ? `${source?.name} is unavailable on this iPhone. This request has not run.`
    : needsConnection ? `${purpose.replace(/[.!?]$/, "")}. Connect here to continue automatically. Relevant source data is shared with Dash and its AI providers for this request.`
    : action?.readOnly ? "Use the source connected on this iPhone." : "This changes the connected source on your iPhone.";
  return <Card title={title} sub={sub}>
    {needsConnection && source && <p className="wd-you-note">{source.detail}</p>}
    {action && <dl className="wd-apple-action-details">{Object.entries(action.parameters).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, " $1")}</dt><dd>{appleActionValue(key, value)}</dd></div>)}</dl>}
    {problem && <p className="wd-card-error" role="alert">{problem}</p>}
    <div className="wd-card-actions">
      {denied ? <button type="button" className="wd-btn is-primary" disabled={busy} onClick={() => postNativeMessage({ version: 1, action: "openSystemSettings" })}>Open iPhone Settings</button>
        : <button type="button" className="wd-btn is-primary" disabled={!supported || busy || checking || unavailable} onClick={() => void run(needsConnection)}>{busy ? (needsConnection ? "Connecting…" : "Continuing…") : needsConnection ? `Connect ${source?.name}` : "Try again"}</button>}
      <button type="button" className="wd-btn is-text" disabled={busy} onClick={onCancel}>Stop</button>
    </div>
  </Card>;
}
