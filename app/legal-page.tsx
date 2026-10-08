import Link from "next/link";
import type { ReactNode } from "react";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="legal-page">
      <nav className="legal-nav">
        <Link className="landing-brand" href="/"><span><img src="/dash-mascot-black.png" alt="" /></span><strong>Dash</strong></Link>
        <Link href="/">Back to Dash</Link>
      </nav>
      <article className="legal-document">
        <header><h1>{title}</h1><p>Last updated {updated}</p></header>
        {children}
      </article>
      <footer className="legal-footer"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></footer>
    </main>
  );
}
