import { createDecipheriv, createHash, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CHROME_ROOT = process.env.CHROME_USER_DATA_DIR
  ? resolve(process.env.CHROME_USER_DATA_DIR)
  : join(homedir(), "Library", "Application Support", "Google", "Chrome");
const SQLITE = process.env.SQLITE3_PATH || "/usr/bin/sqlite3";
const SECURITY = "/usr/bin/security";

export type LocalChromeProfile = { id: string; name: string };
export type ImportedChromeCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  expires?: number;
};

type ChromeCookieRow = {
  host_key: string;
  name: string;
  value: string;
  encrypted_hex: string;
  path: string;
  expires_utc: string;
  is_secure: number;
  is_httponly: number;
  samesite: number;
};

function inside(root: string, target: string) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !path.includes("/../"));
}

function profileId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^(Default|Profile [0-9]{1,4})$/.test(id)) throw new Error("Invalid Chrome profile");
  return id;
}

export function normalizeImportDomains(values: unknown) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 25) throw new Error("Choose between 1 and 25 domains");
  return [...new Set(values.map((value) => {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    const withoutWildcard = raw.replace(/^\*\./, "");
    const parsed = new URL(withoutWildcard.includes("://") ? withoutWildcard : `https://${withoutWildcard}`);
    const domain = parsed.hostname.replace(/^www\./, "").replace(/\.$/, "");
    if (!domain || domain === "localhost" || domain.length > 253 || !domain.includes(".")) throw new Error(`Invalid import domain: ${raw || "empty value"}`);
    return domain;
  }))];
}

export function localChromeImportAvailable(requestUrl?: string, ownerEmail?: string) {
  if (process.platform !== "darwin") return false;
  if (process.env.CHROME_PROFILE_IMPORT_LOCAL !== "1") return false;
  const operator = process.env.CHROME_PROFILE_IMPORT_OWNER?.trim().toLowerCase();
  if (!operator || operator !== ownerEmail?.trim().toLowerCase() || !requestUrl) return false;
  const hostname = new URL(requestUrl).hostname;
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
}

export async function listLocalChromeProfiles(): Promise<LocalChromeProfile[]> {
  const localState = JSON.parse(await readFile(join(CHROME_ROOT, "Local State"), "utf8")) as { profile?: { info_cache?: Record<string, { name?: string }> } };
  const entries = Object.entries(localState.profile?.info_cache ?? {});
  const profiles: LocalChromeProfile[] = [];
  for (const [rawId, metadata] of entries) {
    let id: string;
    try { id = profileId(rawId); } catch { continue; }
    const directory = join(CHROME_ROOT, id);
    if (!inside(CHROME_ROOT, directory)) continue;
    const cookies = await findCookieDatabase(directory).catch(() => null);
    if (cookies) profiles.push({ id, name: metadata.name?.trim() || (id === "Default" ? "Default" : id) });
  }
  return profiles.sort((left, right) => left.id === "Default" ? -1 : right.id === "Default" ? 1 : left.name.localeCompare(right.name));
}

async function findCookieDatabase(profileDirectory: string) {
  const candidates = [join(profileDirectory, "Network", "Cookies"), join(profileDirectory, "Cookies")];
  for (const candidate of candidates) {
    try {
      const resolved = await realpath(candidate);
      if (!inside(await realpath(CHROME_ROOT), resolved)) continue;
      if ((await stat(resolved)).isFile()) return resolved;
    } catch { /* Try the older Chrome location. */ }
  }
  throw new Error("This Chrome profile has no cookie database");
}

function sqlLiteral(value: string) { return `'${value.replaceAll("'", "''")}'`; }

async function chromeSafeStoragePassword() {
  try {
    const { stdout } = await execFileAsync(SECURITY, ["find-generic-password", "-w", "-s", "Chrome Safe Storage"], { maxBuffer: 64 * 1024 });
    const password = stdout.replace(/[\r\n]+$/, "");
    if (!password) throw new Error("Chrome Safe Storage returned an empty key");
    return password;
  } catch {
    throw new Error("macOS could not unlock Chrome Safe Storage. Approve Keychain access and try again.");
  }
}

function decryptCookie(encrypted: Buffer, password: string, host: string) {
  const version = encrypted.subarray(0, 3).toString("ascii");
  if (version === "v20") throw new Error("device_bound");
  if (version !== "v10" && version !== "v11") throw new Error("unknown_encryption");
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  let plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
  const hostDigest = createHash("sha256").update(host).digest();
  if (plain.length >= hostDigest.length && timingSafeEqual(plain.subarray(0, hostDigest.length), hostDigest)) plain = plain.subarray(hostDigest.length);
  return plain.toString("utf8");
}

function chromeExpiry(value: string) {
  const chromeMicros = Number(value);
  if (!Number.isFinite(chromeMicros) || chromeMicros <= 0) return undefined;
  const unixSeconds = Math.floor(chromeMicros / 1_000_000 - 11_644_473_600);
  return unixSeconds > Math.floor(Date.now() / 1000) ? unixSeconds : null;
}

function sameSite(value: number): ImportedChromeCookie["sameSite"] {
  return value === 2 ? "Strict" : value === 1 ? "Lax" : value === 0 ? "None" : undefined;
}

export async function readLocalChromeCookies(rawProfileId: unknown, rawDomains: unknown) {
  const id = profileId(rawProfileId);
  const domains = normalizeImportDomains(rawDomains);
  const profileDirectory = join(CHROME_ROOT, id);
  const chromeRoot = await realpath(CHROME_ROOT);
  const resolvedProfile = await realpath(profileDirectory);
  if (!inside(chromeRoot, resolvedProfile) || basename(resolvedProfile) !== id) throw new Error("Chrome profile escaped its expected directory");
  const sourceDatabase = await findCookieDatabase(resolvedProfile);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "decision-feed-chrome-"));
  const copiedDatabase = join(temporaryDirectory, "Cookies");
  try {
    await copyFile(sourceDatabase, copiedDatabase);
    const domainPredicates = domains.flatMap((domain) => [
      `host_key = ${sqlLiteral(domain)}`,
      `host_key = ${sqlLiteral(`.${domain}`)}`,
      `host_key LIKE ${sqlLiteral(`%.${domain}`)}`,
    ]);
    const query = `SELECT host_key, name, value, hex(encrypted_value) AS encrypted_hex, path, CAST(expires_utc AS TEXT) AS expires_utc, is_secure, is_httponly, samesite FROM cookies WHERE ${domainPredicates.join(" OR ")} ORDER BY host_key, name;`;
    const { stdout } = await execFileAsync(SQLITE, ["-json", copiedDatabase, query], { maxBuffer: 32 * 1024 * 1024 });
    const rows = (stdout.trim() ? JSON.parse(stdout) : []) as ChromeCookieRow[];
    const needsKey = rows.some((row) => !row.value && row.encrypted_hex);
    const password = needsKey ? await chromeSafeStoragePassword() : "";
    const cookies: ImportedChromeCookie[] = [];
    let skipped = 0;
    for (const row of rows) {
      try {
        const expiry = chromeExpiry(row.expires_utc);
        if (expiry === null) continue;
        const value = row.value || decryptCookie(Buffer.from(row.encrypted_hex, "hex"), password, row.host_key);
        if (!value) { skipped += 1; continue; }
        cookies.push({
          name: row.name,
          value,
          domain: row.host_key,
          path: row.path || "/",
          secure: Boolean(row.is_secure),
          httpOnly: Boolean(row.is_httponly),
          ...(sameSite(Number(row.samesite)) ? { sameSite: sameSite(Number(row.samesite)) } : {}),
          ...(expiry ? { expires: expiry } : {}),
        });
      } catch { skipped += 1; }
    }
    return { cookies, domains, discovered: rows.length, skipped };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
