export function SettingsGlyph({ name }: { name: "notifications" | "sources" | "memory" | "vault" | "mail" | "account" | "instructions" | "people" | "saved" | "key" | "lock" | "trash" | "logout" | "refresh" | "pin" | "travel" | "clock" | "plus" | "phone" | "tag" | "check" | "close" }) {
  return <svg className="wd-settings-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "notifications" && <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>}
    {name === "key" && <><circle cx="8" cy="8" r="4"/><path d="m11 11 10 10M16 16l3-3M18 18l3-3"/></>}
    {name === "lock" && <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>}
    {name === "trash" && <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>}
    {name === "logout" && <><path d="M10 4H4v16h6M9 12h12m-4-4 4 4-4 4"/></>}
    {name === "refresh" && <><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/></>}
    {name === "pin" && <><path d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 1 1 14 0Z"/><circle cx="12" cy="9" r="2"/></>}
    {name === "travel" && <><path d="m5 8 2-5h10l2 5M4 8h16v10H4ZM6 18v3M18 18v3M7 12h1M16 12h1"/></>}
    {name === "clock" && <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>}
    {name === "plus" && <path d="M12 5v14M5 12h14"/>}
    {name === "phone" && <path d="m7 3 3 5-3 3c2 3 3 4 6 6l3-3 5 3c-1 5-4 5-8 3C6 17 2 11 3 6l4-3Z"/>}
    {name === "tag" && <path d="M3 3h8l10 10-8 8L3 11ZM7 7h.01"/>}
    {name === "check" && <path d="m5 12 4 4L19 6"/>}
    {name === "close" && <path d="m6 6 12 12M6 18 18 6"/>}
    {name === "instructions" && <><path d="M5 6h14M5 12h14M5 18h9" /><circle cx="9" cy="6" r="2" fill="var(--bg)" /><circle cx="15" cy="12" r="2" fill="var(--bg)" /></>}
    {name === "people" && <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5" /></>}
    {name === "saved" && <path d="M6 3h12v18l-6-4-6 4Z" />}
    {name === "sources" && <><path d="M9.5 14.5 7 17a3.5 3.5 0 0 1-5-5l3.5-3.5a3.5 3.5 0 0 1 5 0" /><path d="m14.5 9.5 2.5-2.5a3.5 3.5 0 0 1 5 5l-3.5 3.5a3.5 3.5 0 0 1-5 0" /><path d="m8.5 15.5 7-7" /></>}
    {name === "memory" && <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.6" /></>}
    {name === "vault" && <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3 9.5h18M7 15h4" /></>}
    {name === "mail" && <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></>}
    {name === "account" && <><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="12" cy="12" r="9.5" /></>}
  </svg>;
}
