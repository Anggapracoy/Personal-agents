"use client";
import { useState } from "react";

export function SiteReceiptIcon({ host }: { host: string }) {
  const [failedHost, setFailedHost] = useState<string | null>(null);
  return <span className="wd-signin-site-icon" aria-hidden="true">
    <span>{host[0]?.toUpperCase() || "↗"}</span>
    {host.includes(".") && failedHost !== host && <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`} alt="" referrerPolicy="no-referrer" onError={() => setFailedHost(host)} />}
  </span>;
}
