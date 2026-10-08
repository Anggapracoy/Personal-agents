"use client";

import { signIn } from "next-auth/react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function MobileAuthPage() {
  return <Suspense fallback={<MobileAuthStatus message="Opening secure sign-in…" />}><MobileAuthContent /></Suspense>;
}

function MobileAuthContent() {
  const [error, setError] = useState(false);
  const startedProvider = useRef<string | null>(null);
  const searchParams = useSearchParams();
  const provider = searchParams.get("provider") === "apple" ? "apple" : "google";

  const beginSignIn = useCallback(() => {
    setError(false);
    void signIn(provider, { callbackUrl: "/api/mobile/auth/finish" }).catch(() => setError(true));
  }, [provider]);

  useEffect(() => {
    if (startedProvider.current === provider) return;
    startedProvider.current = provider;
    beginSignIn();
  }, [beginSignIn, provider]);

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "var(--dash-bg)", color: "var(--dash-ink)", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ width: "min(100%, 360px)", textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Dash</h1>
        <p style={{ margin: "12px 0 24px", color: "var(--dash-ink2)" }}>
          {error ? `${provider === "apple" ? "Apple" : "Google"} sign-in did not start.` : `Opening secure ${provider === "apple" ? "Apple" : "Google"} sign-in…`}
        </p>
        {error ? (
          <button type="button" onClick={beginSignIn} style={{ border: 0, minHeight: 52, borderRadius: 26, padding: "12px 22px", background: "var(--dash-ink)", color: "var(--dash-bg)", fontSize: 16, fontWeight: 650 }}>
            Try again
          </button>
        ) : (
          <div className="auth-spinner" role="status" aria-label="Loading" style={{ width: 28, height: 28, margin: "0 auto", border: "3px solid var(--dash-hair)", borderTopColor: "var(--dash-ink)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        )}
      </section>
      <style jsx>{`@keyframes spin { to { transform: rotate(360deg); } } @media (prefers-reduced-motion: reduce) { .auth-spinner { animation: none !important; } }`}</style>
    </main>
  );
}

function MobileAuthStatus({ message }: { message: string }) {
  return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "var(--dash-bg)", color: "var(--dash-ink)", fontFamily: "system-ui, sans-serif" }}><section style={{ width: "min(100%, 360px)", textAlign: "center" }}><h1 style={{ margin: 0, fontSize: 24 }}>Dash</h1><p style={{ margin: "12px 0 24px", color: "var(--dash-ink2)" }}>{message}</p></section></main>;
}
