import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const cacheFile = process.env.VERCEL
  ? join(tmpdir(), "decision-discovery", "discovery-cache.json")
  : join(process.cwd(), "data", "discovery-cache.json");
const MAX_ENTRIES = 4_000;
type CacheEntry = { value: unknown; createdAt: number; expiresAt: number };
type CacheFile = Record<string, CacheEntry>;
let cacheQueue: Promise<unknown> = Promise.resolve();

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function storageKey(userId: string, namespace: string, key: string) {
  return `${digest(userId.trim().toLowerCase()).slice(0, 24)}:${namespace}:${digest(key)}`;
}

async function readCache(): Promise<CacheFile> {
  try {
    const parsed = JSON.parse(await readFile(cacheFile, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as CacheFile : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeCache(cache: CacheFile) {
  await mkdir(dirname(cacheFile), { recursive: true });
  const temporary = `${cacheFile}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(cache)}\n`, { mode: 0o600 });
  await rename(temporary, cacheFile);
}

export async function getDiscoveryCache<T>(userId: string, namespace: string, key: string): Promise<T | null> {
  const entry = (await readCache())[storageKey(userId, namespace, key)];
  return entry && entry.expiresAt > Date.now() ? entry.value as T : null;
}

export async function setDiscoveryCache(userId: string, namespace: string, key: string, value: unknown, ttlMs: number) {
  const operation = async () => {
    const now = Date.now();
    const cache = await readCache();
    for (const [entryKey, entry] of Object.entries(cache)) if (!entry || entry.expiresAt <= now) delete cache[entryKey];
    cache[storageKey(userId, namespace, key)] = { value, createdAt: now, expiresAt: now + ttlMs };
    const ordered = Object.entries(cache).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, MAX_ENTRIES);
    await writeCache(Object.fromEntries(ordered));
  };
  const result = cacheQueue.then(operation, operation);
  cacheQueue = result.then(() => undefined, () => undefined);
  await result;
}
