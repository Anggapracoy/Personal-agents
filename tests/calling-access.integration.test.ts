import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { CallingAccessStore } from "../lib/calling-access";
import { callingEnabled } from "../lib/calling-policy";
const databaseUrl = process.env.SCHEDULE_TEST_DATABASE_URL;
test("calling settings persist, default safely, and reject concurrent stale saves", { skip: !databaseUrl }, async () => {
  const admin = postgres(databaseUrl!, { prepare: false, onnotice: () => {} });
  const schema = `calling_test_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`create schema ${schema}`);
  const sql = postgres(databaseUrl!, { prepare: false, connection: { search_path: schema }, onnotice: () => {} });
  try {
    const store = new CallingAccessStore(sql);
    assert.deepEqual(await store.read(), { mode: "everyone", users: [], revision: 0 });
    await sql.unsafe(await readFile(new URL("../db/migrations/0018_feature_flags.sql", import.meta.url), "utf8"));
    const draft = { mode: "selected" as const, users: [{ email: " ALEX@example.com ", enabled: true }], revision: 0 };
    const saves = await Promise.all([store.save(draft, "admin@example.com"), store.save({ ...draft, mode: "none" }, "admin@example.com")]);
    assert.equal(saves.filter(Boolean).length, 1);
    const saved = (await store.read());
    assert.equal(saved.revision, 1);
    assert.equal(saved.users[0].email, "alex@example.com");
    assert.equal(await store.save(draft, "admin@example.com"), null);
    const disabled = await store.save({ ...saved, mode: "none" }, "admin@example.com");
    assert.equal(disabled!.users.length, 1);
    assert.equal(callingEnabled(disabled!, "alex@example.com"), false);
    const restored = await store.save({ ...disabled!, mode: "selected" }, "admin@example.com");
    assert.equal(callingEnabled(restored!, "alex@example.com"), true);
    const reset = await store.save({ ...restored!, users: [] }, "admin@example.com");
    assert.equal(callingEnabled(reset!, "alex@example.com"), false);
    const [audit] = await sql`select updated_by,updated_at from app_feature_flags where key='voice_calling'`;
    assert.equal(audit.updated_by, "admin@example.com");
    assert.ok(audit.updated_at);
  } finally { await sql.end(); await admin.unsafe(`drop schema ${schema} cascade`); await admin.end(); }
});
