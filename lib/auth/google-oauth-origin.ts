// Every installation uses its own origin; no cross-deployment callback rewrite.
export function googleOAuthOrigin(requestUrl: string): string {
  return new URL(requestUrl).origin;
}
