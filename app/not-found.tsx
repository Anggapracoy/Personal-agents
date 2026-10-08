import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return <main className="not-found-page">
    <header className="not-found-nav"><Link href="/" className="not-found-brand">Dash</Link><Link className="not-found-home-icon" href="/" aria-label="Back home"><Image src="/dash-mascot-black.png" alt="" width={62} height={62} priority /></Link></header>
    <section className="not-found-content">
      <div className="not-found-code" aria-label="Error 404"><span>4</span><Image src="/dash-mascot-black.png" alt="" width={520} height={520} priority /><span>4</span></div>
      <h1>Wrong turn.</h1><p>This page isn’t part of the plan.</p><Link href="/">Back home</Link>
    </section>
  </main>;
}
