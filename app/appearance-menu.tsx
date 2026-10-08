"use client";
import type { WorkspaceAppearance } from "../lib/types";
const options = [{ id: "system", label: "System" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" }] as const;

/** WKWebView presents a native iOS selection menu; browsers use their platform picker. */
export function AppearanceMenu({ value, onChange }: { value: WorkspaceAppearance; onChange: (value: WorkspaceAppearance) => void }) {
  return <label className="wd-appearance-menu wd-you-row">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6l1.4 1.4M5 19l1.4-1.4M17.6 6.4l1.4-1.4" /></svg>
    <span>Appearance</span>
    <span className="wd-appearance-value" aria-hidden="true">{options.find(option => option.id === value)?.label}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 9 6 6 6-6" /></svg></span>
    <select onPointerDown={event => { event.currentTarget.dataset.pointerFocus = "true"; }} onBlur={event => { delete event.currentTarget.dataset.pointerFocus; }} onKeyDown={event => { delete event.currentTarget.dataset.pointerFocus; }} aria-label="Appearance" value={value} onChange={event => onChange(event.target.value as WorkspaceAppearance)}>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
  </label>;
}
