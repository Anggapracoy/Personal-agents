"use client";
import { useRef, useState } from "react";
import { ProfileAvatar } from "./profile-avatar";

async function preparePhoto(file: File): Promise<Blob> {
  if (file.size > 25 * 1024 * 1024) throw new Error("Choose a photo smaller than 25 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Couldn't open that photo.");
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, 512, 512);
    context.drawImage(image, (image.naturalWidth-side)/2, (image.naturalHeight-side)/2, side, side, 0, 0, 512, 512);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Couldn't open that photo.")), "image/jpeg", .9));
  } finally { URL.revokeObjectURL(url); }
}
export function ProfilePhotoEditor({ image, initial, onChanged, previewMode = false }: { image?: string | null; initial: string; onChanged?: (image: string) => void; previewMode?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true); setError("");
    try {
      const body = await preparePhoto(file);
      let saved: string;
      if (previewMode) saved = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(body); });
      else {
        const response = await fetch("/api/account/photo", { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body });
        const result = await response.json();
        if (!response.ok || typeof result.image !== "string") throw new Error(result.error || "Couldn't save your photo. Try again.");
        saved = result.image;
      }
      onChanged?.(saved);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn't save your photo. Try again."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return <div className="wd-profile-photo-editor">
    <span className="wd-avatar"><ProfileAvatar image={image} initial={initial} /></span>
    <button className="wd-profile-photo-edit" type="button" aria-label="Edit profile photo" aria-busy={busy} disabled={busy} onClick={() => input.current?.click()}>
      <span>{busy ? <span className="wd-spinner" aria-hidden="true" /> : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5M4 15 16 3a2 2 0 0 1 5 5L9 20l-6 1z" /></svg>}</span>
    </button>
    <input ref={input} type="file" accept="image/*" hidden onChange={event => void save(event.target.files?.[0])} />
    {error && <span className="wd-profile-photo-error" role="alert">{error}</span>}
  </div>;
}
