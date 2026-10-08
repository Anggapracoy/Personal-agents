import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import { buildInitialSignupScanRequest } from "../lib/workspace-state";

test("initial signup scan upsert serializes every timestamp through its column encoder", () => {
  const database = drizzle.mock({ schema });
  const query = buildInitialSignupScanRequest(
    database,
    "person@example.com",
    new Date("2026-08-17T19:58:33.285Z"),
  );

  const built = query.toSQL();
  assert.equal(built.params.some((parameter) => parameter instanceof Date), false);
  assert.match(built.sql, /excluded\.initial_scan_requested_at/);
});
