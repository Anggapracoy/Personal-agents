import assert from "node:assert/strict";
import test from "node:test";
import { validMobileHandoffCode } from "../lib/auth/mobile-handoff";

test("mobile authentication handoff codes use a strict opaque format", () => {
  assert.equal(validMobileHandoffCode("a".repeat(43)), true);
  assert.equal(validMobileHandoffCode("A1_-".repeat(11).slice(0, 43)), true);
  assert.equal(validMobileHandoffCode("short"), false);
  assert.equal(validMobileHandoffCode("a".repeat(65)), false);
  assert.equal(validMobileHandoffCode("a".repeat(42) + "."), false);
});

test("mobile wrapper configuration publishes an explicit compatibility range", async () => {
  const { GET } = await import("../app/api/mobile/config/route");
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.minWrapperVersion, 2);
  assert.equal(body.maxWrapperVersion, 2);
  assert.equal(typeof body.webBuildId, "string");
  assert.notEqual(body.webBuildId, "");
});

test("mobile auth starts through the fixed server-controlled launcher", async () => {
  const { mobileAuthStart } = await import("../lib/auth/mobile-start");
  const google = mobileAuthStart(new Request("https://staging.example.test/api/mobile/auth/start"));
  assert.equal(google.provider, "google");
  assert.equal(google.redirectTo, "https://staging.example.test/api/mobile/auth/finish");

  const apple = mobileAuthStart(new Request("https://staging.example.test/api/mobile/auth/start?provider=apple"));
  assert.equal(apple.provider, "apple");
  assert.equal(apple.redirectTo, "https://staging.example.test/api/mobile/auth/finish");
});

test("mobile Google OAuth carries encrypted PKCE state without a browser cookie", async () => {
  const previous = {
    id: process.env.AUTH_GOOGLE_ID,
    secret: process.env.AUTH_GOOGLE_SECRET,
    auth: process.env.AUTH_SECRET,
  };
  process.env.AUTH_GOOGLE_ID = "test-client.apps.googleusercontent.com";
  process.env.AUTH_GOOGLE_SECRET = "test-client-secret";
  process.env.AUTH_SECRET = "test-auth-secret-with-enough-entropy";
  try {
    const { createMobileGoogleAuthorizationURL } = await import("../lib/auth/mobile-google-oauth");
    const target = await createMobileGoogleAuthorizationURL("https://staging.example.test/api/mobile/auth/start?provider=google");
    assert.equal(target.origin, "https://accounts.google.com");
    assert.equal(target.searchParams.get("redirect_uri"), "https://staging.example.test/api/auth/callback/google");
    assert.equal(target.searchParams.get("code_challenge_method"), "S256");
    assert.match(target.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{43}$/);
    assert.match(target.searchParams.get("state") ?? "", /^wdyt_mobile\..{100,}$/);
  } finally {
    if (previous.id === undefined) delete process.env.AUTH_GOOGLE_ID; else process.env.AUTH_GOOGLE_ID = previous.id;
    if (previous.secret === undefined) delete process.env.AUTH_GOOGLE_SECRET; else process.env.AUTH_GOOGLE_SECRET = previous.secret;
    if (previous.auth === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous.auth;
  }
});

test("mobile Google reconnect carries its owner, run, and PKCE verifier in encrypted state", async () => {
  const previous = {
    id: process.env.AUTH_GOOGLE_ID,
    auth: process.env.AUTH_SECRET,
  };
  process.env.AUTH_GOOGLE_ID = "test-client.apps.googleusercontent.com";
  process.env.AUTH_SECRET = "test-auth-secret-with-enough-entropy";
  try {
    const {
      createMobileGoogleConnectionAuthorizationURL,
      readMobileGoogleConnectionState,
    } = await import("../lib/auth/mobile-google-connection-oauth");
    const target = await createMobileGoogleConnectionAuthorizationURL({
      requestUrl: "https://staging.example.test/api/connections/google/start?native=1&runId=run-123",
      ownerEmail: "Owner@Example.com",
      runId: "run-123",
    });
    assert.equal(target.origin, "https://accounts.google.com");
    assert.equal(target.searchParams.get("redirect_uri"), "https://staging.example.test/api/connections/google/callback");
    assert.equal(target.searchParams.get("code_challenge_method"), "S256");
    assert.match(target.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{43}$/);
    assert.match(target.searchParams.get("state") ?? "", /^wdyt_connection\..{100,}$/);
    const state = await readMobileGoogleConnectionState(target.searchParams.get("state") ?? "");
    assert.equal(state.ownerEmail, "owner@example.com");
    assert.equal(state.runId, "run-123");
    assert.equal(state.redirectUri, "https://staging.example.test/api/connections/google/callback");
    assert.match(state.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  } finally {
    if (previous.id === undefined) delete process.env.AUTH_GOOGLE_ID; else process.env.AUTH_GOOGLE_ID = previous.id;
    if (previous.auth === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous.auth;
  }
});

test("mobile auth consume rejects malformed codes before database access", async () => {
  const { GET } = await import("../app/api/mobile/auth/consume/route");
  const response = await GET(new Request("https://staging.example.test/api/mobile/auth/consume?code=bad"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "This sign-in handoff is invalid or expired." });
});
