export function mobileAuthStart(request: Request) {
  const source = new URL(request.url);
  const provider = source.searchParams.get("provider") === "apple" ? "apple" : "google";
  const redirectTo = new URL("/api/mobile/auth/finish", source.origin).toString();
  const target = new URL(redirectTo);
  const challenge = source.searchParams.get('handoffChallenge');
  if (challenge) target.searchParams.set('handoffChallenge', challenge);
  return { provider, redirectTo: target.toString() } as const;
}
