import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let database: ReturnType<typeof drizzle> | undefined;

export function getDb() {
  if (database) return database;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for persistent mode.");
  database = drizzle(postgres(process.env.DATABASE_URL, { prepare: false }), { schema });
  return database;
}
