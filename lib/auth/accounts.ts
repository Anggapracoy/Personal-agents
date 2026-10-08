import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const accountFile = join(process.cwd(), "data", "accounts.json");

type StoredAccount = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
};

export type AccountUser = Pick<StoredAccount, "id" | "email" | "name">;

export class AccountExistsError extends Error {
  constructor() { super("An account with this email already exists."); this.name = "AccountExistsError"; }
}

let accountQueue: Promise<unknown> = Promise.resolve();

function normalizeEmail(value: string) { return value.trim().toLowerCase(); }

async function readAccounts(): Promise<StoredAccount[]> {
  try {
    const parsed = JSON.parse(await readFile(accountFile, "utf8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Account store is malformed");
    return parsed as StoredAccount[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeAccounts(accounts: StoredAccount[]) {
  await mkdir(dirname(accountFile), { recursive: true });
  const temporary = `${accountFile}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, accountFile);
}

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = accountQueue.then(operation, operation);
  accountQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function derivePassword(password: string, salt: string) {
  return scrypt(password, salt, 64) as Promise<Buffer>;
}

export async function registerAccount(input: { email: string; name: string; password: string }): Promise<AccountUser> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error("Enter a valid email address.");
  if (name.length < 2 || name.length > 80) throw new Error("Name must be between 2 and 80 characters.");
  if (input.password.length < 8 || input.password.length > 128) throw new Error("Password must be between 8 and 128 characters.");
  return serialized(async () => {
    const accounts = await readAccounts();
    if (accounts.some((account) => account.email === email)) throw new AccountExistsError();
    const passwordSalt = randomBytes(16).toString("hex");
    const passwordHash = (await derivePassword(input.password, passwordSalt)).toString("hex");
    const account: StoredAccount = { id: randomUUID(), email, name, passwordHash, passwordSalt, createdAt: new Date().toISOString() };
    await writeAccounts([...accounts, account]);
    return { id: account.id, email: account.email, name: account.name };
  });
}

export async function verifyAccount(emailInput: string, password: string): Promise<AccountUser | null> {
  const email = normalizeEmail(emailInput);
  const account = (await readAccounts()).find((candidate) => candidate.email === email);
  if (!account || password.length > 128) return null;
  const expected = Buffer.from(account.passwordHash, "hex");
  const actual = await derivePassword(password, account.passwordSalt);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { id: account.id, email: account.email, name: account.name };
}

export async function removeLocalAccount(emailInput: string) {
  const email = normalizeEmail(emailInput);
  return serialized(async () => {
    const accounts = await readAccounts();
    await writeAccounts(accounts.filter((account) => account.email !== email));
  });
}

export const removeAccountForTesting = removeLocalAccount;
