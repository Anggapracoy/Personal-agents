import postgres, { type Sql } from "postgres";
import { callingEnabled, callingPolicySchema, defaultCallingPolicy, type CallingPolicy } from "./calling-policy";

let client: Sql | undefined;
function database() {
  if (!process.env.DATABASE_URL) throw new Error("Calling access settings require a database.");
  return client ??= postgres(process.env.DATABASE_URL, { prepare: false, max: 2, idle_timeout: 20 });
}
export class CallingAccessStore {
  constructor(readonly sql: Sql, readonly key: "voice_calling" | "daily_proactive" | "rich_result_blocks" = "voice_calling") {}
  private defaults(): CallingPolicy { return { ...defaultCallingPolicy, users: [] }; }
  async read(): Promise<CallingPolicy> {
    try {
      const [row] = await this.sql`select value, revision from app_feature_flags where key=${this.key}`;
      return row ? callingPolicySchema.parse({ ...row.value, revision: Number(row.revision) }) : this.defaults();
    } catch (error) {
      // Use installation defaults when feature-policy storage has not been created yet.
      if ((error as { code?: string }).code === "42P01") return this.defaults();
      throw error;
    }
  }
  async save(input: CallingPolicy, updatedBy: string): Promise<CallingPolicy | null> {
    const policy = callingPolicySchema.parse(input);
    return this.sql.begin(async sql => {
      await sql`insert into app_feature_flags(key,value,revision,updated_by) values (${this.key},${sql.json({ mode: this.defaults().mode, users: [] })},0,${updatedBy}) on conflict (key) do nothing`;
      const [saved] = await sql`update app_feature_flags set value=${sql.json({ mode: policy.mode, users: policy.users } as never)},revision=revision+1,updated_by=${updatedBy},updated_at=now() where key=${this.key} and revision=${policy.revision} returning value,revision`;
      return saved ? callingPolicySchema.parse({ ...saved.value, revision: Number(saved.revision) }) : null;
    });
  }
}
export function getCallingAccessStore() { return new CallingAccessStore(database()); }
export function getDailyProactiveAccessStore() { return new CallingAccessStore(database(), "daily_proactive"); }
export async function isCallingAllowed(email: string): Promise<boolean> {
  try { return callingEnabled(await getCallingAccessStore().read(), email); }
  catch { return false; }
}


export function getRichResultBlocksAccessStore() { return new CallingAccessStore(database(), "rich_result_blocks"); }
export async function isRichResultBlocksAllowed(email: string): Promise<boolean> {
  try { return callingEnabled(await getRichResultBlocksAccessStore().read(), email); }
  catch { return false; }
}
