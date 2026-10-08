const appleAppIcons = new Set(["calendar", "reminders", "contacts", "files", "photos", "health", "home", "music", "maps", "weather", "passwords"]);

/** Small, stable service marks for the Sources list. */
export function SourceIcon({ name, row = false }: { name: string; row?: boolean }) {
  if (!row) return <SourceMark name={name} />;
  return <span className="wd-source-icon-slot" aria-hidden="true"><SourceMark name={name} /></span>;
}
function SourceMark({ name }: { name: string }) {
  if (appleAppIcons.has(name)) return <img className="wd-source-icon is-apple-artwork" src={`/apple-app-icons/${name}.png`} width={30} height={30} alt="" aria-hidden="true" />;
  if (name === "google") return <svg className="wd-source-icon is-google-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.2 3-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a6 6 0 0 1-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.6A6 6 0 0 1 12 5.9Z"/></svg>;
  if (name === "icloud") return <svg className="wd-source-icon" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#008bff"/><rect x="5" y="8" width="22" height="16" rx="2" stroke="white" strokeWidth="1.8"/><path d="m6 9 10 8L26 9" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  const color: Record<string, string> = { location: "#4389F7", alarms: "#34343A", motion: "#303437", payment_card: "#6860D8" };
  return <svg className="wd-source-icon" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill={color[name] ?? "#4389F7"} />
    <g stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {name === "payment_card" && <><rect x="5" y="8" width="22" height="16" rx="3"/><path d="M5 13h22M9 19h5"/><rect x="20" y="18" width="3" height="2" rx=".5" fill="#FFDA5F" stroke="none"/></>}
      {name === "location" && <path d="m7 15 19-9-9 20-2-9Z" fill="white"/>}
      {name === "alarms" && <><circle cx="16" cy="17" r="9"/><path d="M16 11v7l4 2M6 5l-3 4M26 5l3 4M9 26l-2 2M23 26l2 2"/></>}
      {name === "motion" && <><circle cx="19" cy="6" r="2" fill="white"/><path d="m13 26 4-9-3-5-5 5M14 12l5-2 3 6h5M17 17l6 9"/></>}
    </g>
  </svg>;
}
