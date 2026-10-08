"use client";
import { isNativeShell } from "./native-bridge";
import { useEffect, useState } from 'react';
export function FirstSuggestionHint({ ownerEmail, eligible, preview = false }: { ownerEmail?: string; eligible: boolean; preview?: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    if (preview) { setVisible(eligible); return; }
    if (!ownerEmail || !eligible) { setVisible(false); return; }
    let cancelled = false, checking = false, finished = false;
    const endpoint = `/api/onboarding/suggestion-hint${isNativeShell() ? '?native=1' : ''}`;
    const check = async () => {
      if (cancelled || checking || finished || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const response = await fetch(endpoint, { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const data = await response.json() as { seen: boolean; eligible?: boolean };
        if (data.seen) { finished = true; return; }
        if (cancelled || data.eligible === false) return;
        const claim = await fetch(endpoint, { method: 'POST' });
        if (!claim.ok || cancelled) return;
        const saved = await claim.json() as { claimed: boolean };
        finished = true;
        if (saved.claimed) setVisible(true);
      } catch { } finally { checking = false; }
    };
    void check();
    const timer = window.setInterval(check, 5000);
    window.addEventListener('focus', check);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', check); };
  }, [ownerEmail, eligible, preview]);
  return visible ? <p className="wd-first-suggestion-hint">Tap a suggestion to get started.</p> : null;
}
