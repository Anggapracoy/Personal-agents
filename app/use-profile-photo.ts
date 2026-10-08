"use client";
import { useCallback, useEffect, useRef, useState } from "react";
export function useProfilePhoto(email: string, initial: string | null, previewMode: boolean) {
  const [photo, setPhoto] = useState({ email, image: initial });
  const version = useRef(0);
  const update = useCallback((image: string) => { version.current++; setPhoto({ email, image }); }, [email]);
  useEffect(() => {
    if (previewMode) return;
    let active = true;
    const refresh = async () => {
      const requestVersion = ++version.current;
      try {
        const response = await fetch("/api/account/photo", { cache: "no-store" });
        const data = await response.json();
        if (active && requestVersion === version.current && response.ok && (data.image === null || typeof data.image === "string")) setPhoto({ email, image: data.image });
      } catch { /* Keep the known photo on temporary network failures. */ }
    };
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [email, previewMode]);
  return { image: photo.email === email ? photo.image : initial, update };
}
