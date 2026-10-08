import { createHash } from "node:crypto";
import type { BrowserlessCloudBrowserProvider } from "./browser/cloud";
import type { RunStore } from "./types";
import { normalizeSiteHost, type VaultItemSummary } from "../vault";

type Browser = Pick<BrowserlessCloudBrowserProvider, "createDeviceVaultRecipient"> & Partial<Pick<BrowserlessCloudBrowserProvider, "snapshot">>;
type Selection = { store: RunStore; runId: string; actionId: string; owner: string; item: VaultItemSummary; browser: Browser };
type Challenge = { recipientToken: string; recipientPublicKey: string; pageUrl: string; kind: "login" | "payment_card"; needSecurityCode: boolean };
const challengeKey = (actionId: string, itemId: string) => `device_vault_selection:${actionId}:${itemId}`;

async function pendingSelection(input: Selection) {
  const [run, action] = await Promise.all([input.store.getRun(input.runId), input.store.getAction(input.actionId, input.runId)]);
  if (run?.userId !== input.owner || run.status !== "awaiting_approval" || action?.status !== "proposed" || action.toolName !== "vault_request_item") throw new Error("This secure request is no longer pending.");
  if (input.item.kind !== action.input.kind) throw new Error("That saved item does not match this request.");
  const requestedHost = normalizeSiteHost(typeof action.input.siteHost === "string" ? action.input.siteHost : null);
  if (input.item.kind === "login" && requestedHost && input.item.siteHost && normalizeSiteHost(input.item.siteHost) !== requestedHost) throw new Error("That saved item belongs to a different website.");
  let pageUrl = action.input.pageUrl;
  // Older deferred-resume wrappers serialized a Promise from currentUrl as {}.
  // Recover only that known corruption, from a read-only observation of the
  // requested HTTPS site. Never navigate or release to an unverified origin.
  if (pageUrl && typeof pageUrl === "object" && !Array.isArray(pageUrl) && Object.keys(pageUrl).length === 0 && requestedHost && input.browser.snapshot) {
    pageUrl = (await input.browser.snapshot()).url;
  }
  if (typeof pageUrl !== "string") throw new Error("The secure website could not be verified. Request your saved details again on the current page.");
  const url = new URL(pageUrl);
  if (url.protocol !== "https:" || (requestedHost && normalizeSiteHost(url.hostname) !== requestedHost)) throw new Error("The secure website changed. Request your saved details again on the current page.");
  return { action, expectedOrigin: url.origin };
}

function verifiedRecipientPage(pageUrl: string | undefined, expectedOrigin: string) {
  if (!pageUrl || new URL(pageUrl).origin !== expectedOrigin) throw new Error("The secure website changed. Choose your saved item again.");
  return pageUrl;
}

// Preparing a recipient never approves the action or resumes the agent.
export async function prepareVaultSelection(input: Selection): Promise<Challenge> {
  const { action, expectedOrigin } = await pendingSelection(input);
  const recipientToken = createHash("sha256").update(JSON.stringify([input.runId, action.id, input.item.id, expectedOrigin])).digest("hex").slice(0, 32);
  const recipient = await input.browser.createDeviceVaultRecipient(recipientToken, expectedOrigin);
  const pageUrl = verifiedRecipientPage(recipient.pageUrl, expectedOrigin);
  const challenge: Challenge = { recipientToken, recipientPublicKey: recipient.publicKey, pageUrl, kind: input.item.kind, needSecurityCode: input.item.kind === "payment_card" && action.input.needSecurityCode === true };
  await input.store.putSecret(input.runId, challengeKey(action.id, input.item.id), JSON.stringify(challenge));
  return challenge;
}

export async function completeVaultSelection(input: Selection, envelope: { encryptedKey: string; sealed: string }) {
  const { action, expectedOrigin } = await pendingSelection(input);
  const stored = await input.store.getSecret(input.runId, challengeKey(action.id, input.item.id));
  if (!stored) throw new Error("Choose this saved item again to unlock it.");
  const challenge = JSON.parse(stored) as Challenge;
  if (new URL(challenge.pageUrl).origin !== expectedOrigin) throw new Error("The secure website changed. Choose your saved item again.");
  const recipient = await input.browser.createDeviceVaultRecipient(challenge.recipientToken, expectedOrigin);
  verifiedRecipientPage(recipient.pageUrl, expectedOrigin);
  if (recipient.publicKey !== challenge.recipientPublicKey) throw new Error("The secure browser restarted. Choose your saved item again.");
  const completed = await input.store.completeVaultSelection(action.id, input.runId, input.owner, {
    selectedItem: { kind: input.item.kind, label: input.item.label, usernameHint: input.item.usernameHint, cardBrand: input.item.cardBrand, cardLast4: input.item.cardLast4 },
    vaultUpdated: true, deviceUnlocked: true, itemId: input.item.id, kind: input.item.kind, storage: "device_keychain",
    recipientToken: challenge.recipientToken, pageUrl: challenge.pageUrl, needSecurityCode: challenge.needSecurityCode,
  }, JSON.stringify(envelope));
  if (!completed) throw new Error("This secure request is no longer pending.");
  return completed;
}
