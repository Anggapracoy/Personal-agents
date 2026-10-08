import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

test("local accounts are persisted with hashed passwords and verified", async () => {
  const { AccountExistsError, registerAccount, removeAccountForTesting, verifyAccount } = await import("../lib/auth/accounts");
  const email = `test-${randomUUID()}@example.test`;
  try {
    const created = await registerAccount({ name: "Test User", email, password: "correct horse battery staple" });
    assert.equal(created.email, email);
    assert.equal((await verifyAccount(email, "correct horse battery staple"))?.id, created.id);
    assert.equal(await verifyAccount(email, "wrong password"), null);
    await assert.rejects(() => registerAccount({ name: "Other User", email, password: "another password" }), AccountExistsError);
  } finally {
    await removeAccountForTesting(email);
  }
});
