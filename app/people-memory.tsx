"use client";

import { SettingsGlyph } from "./settings-glyph";
import { useEffect, useRef, useState } from "react";
import { personFromMemory, personMemorySchema, type PersonMemory } from "../lib/people-memory";
import { responseError } from "./native-bridge";
import type { LifeFact, LifeProfileResponse } from "./workspace-model";

const emptyPerson: PersonMemory = { name: "", role: "", email: "", phone: "" };

export function PeopleMemory({ profile, loading, previewMode, onChange }: {
  profile: LifeProfileResponse | null;
  loading: boolean;
  previewMode: boolean;
  onChange: (profile: LifeProfileResponse) => void;
}) {
  const [editing, setEditing] = useState<{ id?: string; person: PersonMemory } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const addButton = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const editorKey = editing ? editing.id ?? "new" : null;
  useEffect(() => { if (editorKey) form.current?.scrollIntoView({ block: "start" }); }, [editorKey]);
  const people = (profile?.facts ?? []).filter(fact => fact.kind === "person").flatMap(fact => {
    const person = personFromMemory(fact.value);
    return person ? [{ id: fact.id, person }] : [];
  });
  const closeEditor = () => { setEditing(null); addButton.current?.focus(); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || busy) return;
    const parsed = personMemorySchema.safeParse(editing.person);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setBusy(true); setError(""); setStatus("");
    try {
      if (previewMode) {
        const fact: LifeFact = { id: editing.id ?? crypto.randomUUID(), kind: "person", value: parsed.data, source: "settings", confidence: 1, lastConfirmedAt: new Date().toISOString() };
        onChange({ ...(profile ?? { profile: null, requiredVersion: 1 }), facts: [...(profile?.facts ?? []).filter(item => item.id !== fact.id), fact] });
      } else {
        const response = await fetch("/api/mobile/life-profile/people", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editing.id, person: parsed.data }) });
        if (!response.ok) throw new Error(await responseError(response, "This person could not be saved."));
        onChange(await response.json() as LifeProfileResponse);
      }
      setStatus(`${parsed.data.name} saved`); closeEditor();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "This person could not be saved."); }
    finally { setBusy(false); }
  };
  const remove = async (id: string, name: string) => {
    if (busy) return;
    setBusy(true); setError(""); setStatus("");
    try {
      if (!previewMode) {
        const response = await fetch(`/api/mobile/life-profile/facts/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!response.ok) throw new Error(await responseError(response, "This person could not be removed."));
      }
      if (profile) onChange({ ...profile, facts: profile.facts.filter(fact => fact.id !== id) });
      setStatus(`${name} removed`); closeEditor();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "This person could not be removed."); }
    finally { setBusy(false); }
  };
  return <section className="wd-you-group wd-people">
    {!loading && !people.length && !editing ? <div className="wd-people-empty">
      <div className="wd-people-empty-copy"><SettingsGlyph name="people" /><div><strong>The people in your life</strong><p>Add someone so Dash knows who you mean.</p></div></div>
      <button ref={addButton} type="button" disabled={loading || busy || Boolean(editing)} onClick={() => { setEditing({ person: { ...emptyPerson } }); setError(""); setStatus(""); }}><SettingsGlyph name="plus" />Add person</button>
    </div> : <div className="wd-people-heading"><button ref={addButton} type="button" disabled={loading || busy || Boolean(editing)} onClick={() => { setEditing({ person: { ...emptyPerson } }); setError(""); setStatus(""); }}><SettingsGlyph name="plus" />Add person</button></div>}
    {loading && <p className="wd-you-note">Loading…</p>}
    {people.length > 0 && <div className="wd-people-list">{people.map(({ id, person }) => <div className="wd-person" key={id}>
      <SettingsGlyph name="account" /><div className="wd-person-info"><strong>{person.name}</strong>{person.role && <span>{person.role}</span>}</div>
      <button type="button" disabled={busy || Boolean(editing)} aria-label={`Edit ${person.name}`} onClick={() => { setEditing({ id, person }); setError(""); setStatus(""); }}><SettingsGlyph name="instructions" /></button>
    </div>)}</div>}
    {editing && <form ref={form} className="wd-person-form" onSubmit={event => void save(event)}>
      <h3>{editing.id ? "Edit person" : "Add person"}</h3>
      <div className="wd-fields">
        <label><span className="wd-field-label"><SettingsGlyph name="account" />Name</span><input required maxLength={120} autoComplete="off" value={editing.person.name} disabled={busy} onChange={event => setEditing({ ...editing, person: { ...editing.person, name: event.target.value } })} placeholder="Max" /></label>
        <label><span className="wd-field-label"><SettingsGlyph name="people" />Relationship</span><input maxLength={160} autoComplete="off" value={editing.person.role} disabled={busy} onChange={event => setEditing({ ...editing, person: { ...editing.person, role: event.target.value } })} placeholder="Brother, accountant, coworker…" /></label>
        <label><span className="wd-field-label"><SettingsGlyph name="mail" />Email</span><input type="email" maxLength={320} autoComplete="off" autoCapitalize="none" spellCheck={false} value={editing.person.email} disabled={busy} onChange={event => setEditing({ ...editing, person: { ...editing.person, email: event.target.value } })} placeholder="max@example.com" /></label>
        <label><span className="wd-field-label"><SettingsGlyph name="phone" />Phone</span><input type="tel" maxLength={80} autoComplete="off" value={editing.person.phone} disabled={busy} onChange={event => setEditing({ ...editing, person: { ...editing.person, phone: event.target.value } })} placeholder="+1 416 555 0123" /></label>
      </div>
      <div className="wd-sheet-actions">
        <button type="submit" className="wd-btn is-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="wd-btn" disabled={busy} onClick={() => { setError(""); closeEditor(); }}>Cancel</button>
      </div>
      {editing.id && <button className="wd-person-remove" type="button" disabled={busy} onClick={() => void remove(editing.id!, editing.person.name)}><SettingsGlyph name="trash" />Remove</button>}
    </form>}
    {error && <p className="wd-you-error" role="alert">{error}</p>}
    <p className="wd-you-note" role="status">{status}</p>
  </section>;
}
