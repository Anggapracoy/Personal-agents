
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import { verifyAccount } from "./lib/auth/accounts";
import { upsertConnectedGoogleAccount } from "./lib/auth/google-connections";
import { isSessionRevoked, newSessionIdentity, revokeSession, sessionIdentity } from "./lib/auth/session-revocation";

export const googleAuthEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
const appleAuthEnabled = Boolean(process.env.AUTH_APPLE_ID && process.env.AUTH_APPLE_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  cookies: {
    sessionToken: { name: "decision-feed.session-token", options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" } },
    // Apple completes OAuth with a cross-site form POST. In production this
    // cookie must be sent with that POST or Auth.js loses the mobile finish
    // URL and falls back to the web app root instead of returning to iOS.
    callbackUrl: { name: "decision-feed.callback-url", options: { sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", path: "/", secure: process.env.NODE_ENV === "production" } },
    csrfToken: { name: "decision-feed.csrf-token", options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" } },
  },
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (typeof credentials.email !== "string" || typeof credentials.password !== "string") return null;
        return verifyAccount(credentials.email, credentials.password);
      },
    }),
    ...(googleAuthEnabled ? [Google({
      authorization: {
        params: {
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/gmail.modify",
            "https://www.googleapis.com/auth/calendar.events",
          ].join(" "),
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
        },
      },
    })] : []),
    ...(appleAuthEnabled ? [Apple({
      clientId: process.env.AUTH_APPLE_ID!,
      clientSecret: process.env.AUTH_APPLE_SECRET!,
    })] : []),
  ],
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  events: {
    async signOut(message) {
      if ("token" in message && message.token) await revokeSession(message.token);
    },
  },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) Object.assign(token, newSessionIdentity());
      else {
        if (await isSessionRevoked(token)) return null;
        Object.assign(token, sessionIdentity(token));
      }
      if (account?.provider === "google") {
        token.authProvider = "google";
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.accessTokenExpires = (account.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000;
        const googleProfile = profile as { sub?: string; email?: string; name?: string; picture?: string } | undefined;
        if (googleProfile?.picture) token.picture = googleProfile.picture;
        const ownerEmail = typeof token.email === "string" ? token.email : googleProfile?.email;
        if (ownerEmail && googleProfile?.sub && googleProfile.email && account.access_token) {
          try {
            await upsertConnectedGoogleAccount({
              ownerEmail,
              googleSubject: googleProfile.sub,
              email: googleProfile.email,
              name: googleProfile.name,
              accessToken: account.access_token,
              refreshToken: account.refresh_token,
              expiresAt: typeof token.accessTokenExpires === "number" ? token.accessTokenExpires : null,
              scopes: account.scope,

            });
          } catch (error) {
            console.error("[auth] Google source could not be persisted", error);
          }
        }
        return token;
      }
      if (account?.provider === "apple") {
        token.authProvider = "apple";
        delete token.accessToken;
        delete token.refreshToken;
        delete token.accessTokenExpires;
        return token;
      }
      if (token.authProvider !== "google") return token;
      if (typeof token.accessTokenExpires === "number" && Date.now() < token.accessTokenExpires - 60_000) return token;
      if (typeof token.refreshToken === "string") {
        const response = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: process.env.AUTH_GOOGLE_ID ?? "", client_secret: process.env.AUTH_GOOGLE_SECRET ?? "", grant_type: "refresh_token", refresh_token: token.refreshToken }),
        });
        if (response.ok) {
          const refreshed = await response.json() as { access_token: string; expires_in: number; refresh_token?: string };
          token.accessToken = refreshed.access_token;
          token.accessTokenExpires = Date.now() + refreshed.expires_in * 1000;
          token.refreshToken = refreshed.refresh_token ?? token.refreshToken;
        } else token.refreshError = "RefreshAccessTokenError";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.image = token.authProvider === "google" && typeof token.picture === "string" ? token.picture : null;
      return Object.assign(session, { accessToken: token.authProvider === "google" ? token.accessToken : undefined, authProvider: token.authProvider });
    },
  },
});
