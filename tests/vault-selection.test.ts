import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRunStore } from "../lib/harness/store";
import { prepareVaultSelection, completeVaultSelection } from "../lib/harness/vault-selection";
import { approvedVaultRecipientToken, reusableSecureRelease, createToolRegistry } from "../lib/harness/tools";
import { ApprovalRequiredError } from "../lib/harness/actions";
import type { BrowserlessCloudBrowserProvider } from "../lib/harness/browser/cloud";
import type { SandboxProvider } from "../lib/harness/sandbox/types";
import type { VaultItemSummary } from "../lib/vault";

async function setup(kind: "login" | "payment_card" = "login", needSecurityCode = false) {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "vault@example.invalid", decisionId: null, title: "Secure fill", request: "Continue", category: "test", metadata: {} });
  await store.updateRun(run.id, { status: "awaiting_approval" });
  const action = await store.createAction({ runId: run.id, stepId: "step", toolName: "vault_request_item", risk: "write_external", preview: "Choose", input: { kind, siteHost: "example.com", pageUrl: "https://example.com/login", needSecurityCode } });
  const item: VaultItemSummary = { id: crypto.randomUUID(), kind, label: "Saved", siteHost: null, usernameHint: null, cardBrand: null, cardLast4: null, updatedAt: "" };
  const state = { url: "https://example.com/login", publicKey: "browser-key" };
  const browser = { snapshot: async () => ({ title: "Login", url: state.url, text: "", elements: [], activeModalCount: 0, formatted: "" }), createDeviceVaultRecipient: async (token: string, expectedOrigin?: string) => {
    if (expectedOrigin && new URL(state.url).origin !== expectedOrigin) throw new Error("The secure website changed");
    return { token, algorithm: "RSA-OAEP-256+A256GCM" as const, publicKey: state.publicKey, pageUrl: state.url };
  } };
  return { store, runId: run.id, actionId: action.id, owner: run.userId, item, browser, state };
}
const envelope = { encryptedKey: "a".repeat(64), sealed: "b".repeat(24) };

for (const kind of ["login", "payment_card"] as const) {
  test(`${kind}: selection waits for unlock; its first fill can reuse the completed release`, async () => {
    const input = await setup(kind, kind === "payment_card");
    const challenge = await prepareVaultSelection(input);
    assert.equal((await input.store.getRun(input.runId))?.status, "awaiting_approval");
    assert.equal((await input.store.getAction(input.actionId, input.runId))?.status, "proposed");
    assert.equal(await input.store.getSecret(input.runId, `device_vault:${input.actionId}`), null);
    // Face ID cancellation sends no release; retry is still the same pending choice.
    assert.deepEqual(await prepareVaultSelection(input), challenge);
    const completed = await completeVaultSelection(input, envelope);
    assert.equal(completed.result?.secureFieldsVerified, undefined);
    assert.equal(await input.store.getSecret(input.runId, `device_vault:${input.actionId}`), JSON.stringify(envelope));
    const request = { itemId: input.item.id, kind, pageUrl: "https://example.com/next", needSecurityCode: kind === "payment_card" };
    assert.equal(reusableSecureRelease([completed], request)?.id, completed.id);
    assert.equal(approvedVaultRecipientToken(completed), challenge.recipientToken);
    assert.equal(reusableSecureRelease([completed], { ...request, pageUrl: "https://other.example/" }), null);
    assert.equal(reusableSecureRelease([completed], { ...request, itemId: "different" }), null);
    assert.equal(reusableSecureRelease([completed], { ...request, now: Date.parse(completed.approvedAt!) + 600_001 })?.id, kind === "payment_card" ? completed.id : undefined);
    assert.equal(reusableSecureRelease([completed], { ...request, pageUrl: "https://example.com:444/" }), null);
  });
  test(`${kind}: request always pauses for a user choice without selecting any saved item`, async () => {
    const input = await setup(kind);
    // Remove the fixture request from this scenario by using a fresh run.
    const run = await input.store.createRun({ userId: input.owner, decisionId: null, title: "Choose", request: "Continue", category: "test", metadata: {} });
    await input.store.updateRun(run.id, { status: "running" });
    const registry = await createToolRegistry({ runId: run.id, userId: input.owner, stepId: "choice", store: input.store, cloudBrowser: { ...input.browser, currentUrl: () => input.state.url } as unknown as BrowserlessCloudBrowserProvider, sandbox: {} as SandboxProvider, sandboxState: { created: false } });
    try {
      await assert.rejects(async () => { await registry.tools.vault_request_item.execute!({ kind, siteHost: "example.com", suggestedLabel: "Saved", reason: "Continue", needSecurityCode: false }, { toolCallId: "choice", messages: [], context: undefined }); }, ApprovalRequiredError);
      const snapshot = await input.store.getSnapshot(run.id);
      assert.equal(snapshot?.status, "awaiting_approval");
      assert.equal(snapshot?.actions[0].status, "proposed");
      assert.equal(snapshot?.actions[0].result, null);
    } finally { await registry.close(); }
  });
}

test("concurrent selections commit exactly one envelope and cannot overwrite it", async () => {
  const first = await setup("payment_card");
  const second = { ...first, item: { ...first.item, id: crypto.randomUUID() } };
  await prepareVaultSelection(first);
  await prepareVaultSelection(second);
  const otherEnvelope = { ...envelope, sealed: "c".repeat(24) };
  const results = await Promise.allSettled([completeVaultSelection(first, envelope), completeVaultSelection(second, otherEnvelope)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const action = await first.store.getAction(first.actionId, first.runId);
  assert.equal(await first.store.getSecret(first.runId, `device_vault:${first.actionId}`), JSON.stringify(action?.result?.itemId === first.item.id ? envelope : otherEnvelope));
});

test("stale site, browser, owner, or cancelled request cannot release a selection", async () => {
  for (const change of ["site", "browser", "owner", "cancelled"] as const) {
    const input = await setup();
    await prepareVaultSelection(input);
    if (change === "site") input.state.url = "https://other.example/";
    if (change === "browser") input.state.publicKey = "new-browser-key";
    if (change === "owner") input.owner = "other@example.invalid";
    if (change === "cancelled") await input.store.updateRun(input.runId, { status: "cancelled" });
    await assert.rejects(completeVaultSelection(input, envelope));
    assert.equal(await input.store.getSecret(input.runId, `device_vault:${input.actionId}`), null);
    assert.equal((await input.store.getAction(input.actionId, input.runId))?.status, "proposed");
  }
});

test("a card release without CVC cannot claim to cover a security-code field", async () => {
  const input = await setup("payment_card");
  await prepareVaultSelection(input);
  const completed = await completeVaultSelection(input, envelope);
  assert.equal(reusableSecureRelease([completed], { itemId: input.item.id, kind: "payment_card", pageUrl: input.state.url, needSecurityCode: true }), null);
});

test("an existing merchant-labeled card can be selected for a different HTTPS checkout", async () => {
  const input = await setup("payment_card");
  input.item.siteHost = "naturamarket.ca";
  const challenge = await prepareVaultSelection(input);
  assert.equal(new URL(challenge.pageUrl).hostname, "example.com");
  const completed = await completeVaultSelection(input, envelope);
  assert.equal(completed.result?.itemId, input.item.id);
  assert.equal(reusableSecureRelease([completed], { itemId: input.item.id, kind: "payment_card", pageUrl: "https://another.example/checkout" }), null);
});

test("a focus-only CVC failure can reuse its approved release for the rest of the run", async () => {
  const input = await setup("payment_card", true);
  await prepareVaultSelection(input);
  const completed = await completeVaultSelection(input, envelope);
  const failed = { ...completed, toolName: "vault_fill_payment", status: "failed" as const,
    input: { ...completed.input, recipientToken: completed.result?.recipientToken, pageUrl: input.state.url, itemId: input.item.id, needSecurityCode: true },
    result: { error: "The selected secure field lost page focus before typing" } };
  const request = { itemId: input.item.id, kind: "payment_card" as const, pageUrl: input.state.url, needSecurityCode: true,
    now: Date.parse(completed.approvedAt!) + 60 * 60_000 };
  assert.equal(reusableSecureRelease([failed], request)?.id, failed.id);
  assert.equal(reusableSecureRelease([{ ...failed, result: { error: "The website did not retain the securely typed field" } }], request), null);
  assert.equal(reusableSecureRelease([failed], { ...request, pageUrl: "https://other.example/checkout" }), null);
});

test("selection uses one origin-checked recipient call per phase and never scans the page", async () => {
  const input = await setup("payment_card", true);
  const calls: string[] = [];
  const recipient = input.browser.createDeviceVaultRecipient;
  input.browser.snapshot = async () => { assert.fail("unlock must not wait on a full DOM/AX scan"); };
  input.browser.createDeviceVaultRecipient = async (token, origin) => {
    assert.equal(origin, "https://example.com");
    calls.push(token);
    return recipient(token, origin);
  };
  await prepareVaultSelection(input);
  await completeVaultSelection(input, envelope);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]);
});

test('legacy empty-object checkout URL recovers only on the requested HTTPS site', async () => {
  for (const url of ['https://example.com/checkout', 'https://other.example/checkout', 'http://example.com/checkout']) {
    const input = await setup('payment_card');
    const action = (await input.store.getAction(input.actionId, input.runId))!;
    action.input.pageUrl = {};
    input.state.url = url;
    if (url === 'https://example.com/checkout') {
      const challenge = await prepareVaultSelection(input);
      assert.equal(challenge.pageUrl, url);
      await completeVaultSelection(input, envelope);
      assert.equal((await input.store.getAction(input.actionId,input.runId))?.status,'executed');
    } else {
      await assert.rejects(prepareVaultSelection(input), /secure website changed/);
      assert.equal(await input.store.getSecret(input.runId, `device_vault:${input.actionId}`), null);
    }
  }
});
