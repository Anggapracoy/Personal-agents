export function mobileAuthStart(request: Request) {
  const source = new URL(request.url);
  const provider = source.searchParams.get("provider") === "apple" ? "apple" : "google";
  const redirectTo = new URL("/api/mobile/auth/finish", source.origin).toString();
  return { provider, redirectTo } as const;
}
