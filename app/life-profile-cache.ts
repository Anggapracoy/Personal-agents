'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uiPreviewLifeProfile } from './preview-fixtures';
import type { LifeProfileResponse } from './workspace-model';

export function useLifeProfileCache(account: string, preview: boolean) {
  const key = `wdyt-life-profile-v1:${preview ? 'preview:' : ''}${account}`;
  const initial = useMemo(() => {
    if (preview) return uiPreviewLifeProfile;
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? 'null') as LifeProfileResponse | null;
      return value && Array.isArray(value.facts) && 'profile' in value ? value : null;
    } catch { return null; }
  }, [key, preview]);
  const [saved, setSaved] = useState({ key, data: initial });
  const generation = useRef(0);
  const cleared = useRef(false);
  const update = useCallback((data: LifeProfileResponse) => {
    if (cleared.current) return;
    generation.current++;
    setSaved({ key, data });
    if (!preview) try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* Memory still works without storage. */ }
  }, [key, preview]);
  const clear = useCallback(() => {
    cleared.current = true; generation.current++; setSaved({ key, data: null });
    try { localStorage.removeItem(key); } catch { /* Optional storage. */ }
  }, [key]);
  useEffect(() => {
    cleared.current = false;
    if (preview) return;
    const controller = new AbortController();
    const version = generation.current;
    void fetch('/api/mobile/life-profile', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const data = await response.json() as LifeProfileResponse;
        if (!controller.signal.aborted && version === generation.current) update(data);
      }).catch(() => { /* Retain the last known summary while offline. */ });
    return () => controller.abort();
  }, [key, preview, update]);
  return { data: saved.key === key ? saved.data : initial, update, clear };
}
