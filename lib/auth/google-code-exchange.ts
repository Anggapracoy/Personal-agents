type GoogleToken = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
type GoogleProfile = { sub: string; email: string; name?: string };

export async function exchangeGoogleCode(input: { code: string; verifier: string; redirectUri: string }) {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: input.code, client_id: process.env.AUTH_GOOGLE_ID ?? "", client_secret: process.env.AUTH_GOOGLE_SECRET ?? "", redirect_uri: input.redirectUri, grant_type: "authorization_code", code_verifier: input.verifier }),
    cache: "no-store",
  });
  if (!tokenResponse.ok) throw new Error("token_exchange");
  const token = await tokenResponse.json() as GoogleToken;
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token.access_token}` }, cache: "no-store" });
  if (!profileResponse.ok) throw new Error("profile");
  return { token, profile: await profileResponse.json() as GoogleProfile };
}

