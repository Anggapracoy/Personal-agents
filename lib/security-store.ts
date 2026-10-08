import postgres from 'postgres';

let sql: ReturnType<typeof postgres> | undefined;
export function securityDatabase() {
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') throw new Error('Security storage is not configured.');
    return null;
  }
  return sql ??= postgres(process.env.DATABASE_URL, { prepare: false, max: 3 });
}
