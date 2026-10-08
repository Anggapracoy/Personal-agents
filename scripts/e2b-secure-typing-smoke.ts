import assert from "node:assert/strict";
import { createCipheriv, createPublicKey, publicEncrypt, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BrowserlessCloudBrowserProvider, type BrowserSnapshot, type DeviceVaultEnvelope } from "../lib/harness/browser/cloud";

function loadEnvFile(file: string) {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));

function elementRef(page: BrowserSnapshot, pattern: RegExp) {
  return page.elements.find((element) => pattern.test(`${element.name} ${element.type}`))?.ref;
}

function seal(secret: Record<string, unknown>, recipientPublicKey: string): DeviceVaultEnvelope {
  const symmetricKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", symmetricKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secret), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const publicKey = createPublicKey({ key: Buffer.from(recipientPublicKey, "base64"), format: "der", type: "pkcs1" });
  const encryptedKey = publicEncrypt({ key: publicKey, oaepHash: "sha256" }, symmetricKey);
  return {
    encryptedKey: encryptedKey.toString("base64"),
    sealed: Buffer.concat([iv, ciphertext, tag]).toString("base64"),
  };
}

async function testOrdinaryTyping(browser: BrowserlessCloudBrowserProvider, userId: string) {
  const page = await browser.open(userId, "https://httpbin.org/forms/post");
  const ref = elementRef(page, /customer|custname|text/i);
  assert.ok(ref, "ordinary test form did not expose its customer-name field");
  const typed = await browser.type(ref, "Decision Feed smoke test");
  assert.equal(typed.elements.find((element) => element.ref === ref)?.value, "Decision Feed smoke test");
  console.log("PASS: ordinary typing still works");
  return { url: typed.url, ref };
}

async function testSecureLogin(browser: BrowserlessCloudBrowserProvider, userId: string) {
  const page = await browser.open(userId, "https://the-internet.herokuapp.com/login");
  const usernameRef = elementRef(page, /username|email/i);
  const passwordRef = elementRef(page, /password/i);
  assert.ok(usernameRef && passwordRef, "login test page did not expose both fields");
  await assert.rejects(() => browser.assertSecureTarget(usernameRef), /Click the exact target/);
  await browser.click(usernameRef);
  await browser.assertSecureTarget(usernameRef);
  const token = randomBytes(16).toString("hex");
  const recipient = await browser.createDeviceVaultRecipient(token);
  const envelope = seal({ kind: "login", username: "tomsmith", password: "SuperSecretPassword!" }, recipient.publicKey);
  const username = await browser.secureFillEnvelope({ token, kind: "login", envelope,
    fields: [{ name: "username", ref: usernameRef }], expectedUrl: page.url, retainForSecureTyping: true });
  assert.equal(username.secureFieldsVerified, true);
  assert.deepEqual(username.secureFieldNames, ["username"]);
  assert.equal(username.url, page.url, "secure typing must not submit login");
  assert.deepEqual(username.elements.find(element => element.ref === passwordRef), page.elements.find(element => element.ref === passwordRef), "untargeted password state must remain unchanged");
  await assert.rejects(() => browser.assertSecureTarget(passwordRef), /Click the exact target/);
  await browser.click(passwordRef);
  const password = await browser.secureFillEnvelope({ token, kind: "login", envelope,
    fields: [{ name: "password", ref: passwordRef }], expectedUrl: page.url });
  assert.deepEqual(password.secureFieldNames, ["password"]);
  assert.doesNotMatch(JSON.stringify(password.elements), /tomsmith|SuperSecretPassword!/);
  const submitRef = elementRef(password, /login|submit/i);
  assert.ok(submitRef, "login test page did not expose its submit control");
  const submitted = await browser.click(submitRef);
  assert.match(`${submitted.url}\n${submitted.text}`, /\/secure|secure area/i);
  console.log("PASS: login types one selected field, rejects wrong focus, waits for explicit submit");
  return { url: submitted.url, fields: ["username", "password"] };
}

async function testSecureMultiPageLoginRelease(browser: BrowserlessCloudBrowserProvider, userId: string) {
  const html = `<form id="login"><label>Email<input name="username" autocomplete="username"></label><label>Other email<input name="other"></label><button type="button" onclick="document.getElementById('login').innerHTML='<label>Password<input type=password name=password autocomplete=current-password></label>'">Next</button></form>`;
  const url = `https://httpbin.org/base64/${encodeURIComponent(Buffer.from(html).toString("base64"))}`;
  const page = await browser.open(userId, url);
  const usernameRef = elementRef(page, /^Email(?:\s|$)/i);
  const otherRef = elementRef(page, /Other email/i);
  assert.ok(usernameRef && otherRef, "multi-page login did not expose its fields");
  await browser.click(usernameRef);
  const token = randomBytes(16).toString("hex");
  const recipient = await browser.createDeviceVaultRecipient(token);
  const envelope = seal({ kind: "login", username: "test@example.com", password: "one-release-password" }, recipient.publicKey);
  const username = await browser.secureFillEnvelope({ token, kind: "login", envelope,
    fields: [{ name: "username", ref: usernameRef }], expectedUrl: page.url, retainForSecureTyping: true });
  assert.deepEqual(username.secureFieldNames, ["username"]);
  assert.equal(username.elements.find(element => element.ref === otherRef)?.value ?? "", "");
  assert.equal(username.elements.some(element => element.type === "password"), false, "secure typing must not click Next");
  const nextRef = elementRef(username, /^next button$|next/i);
  assert.ok(nextRef, "multi-page login did not expose its Next button");
  const passwordPage = await browser.click(nextRef);
  const passwordRef = elementRef(passwordPage, /password/i);
  assert.ok(passwordRef, "multi-page login did not expose its password field");
  await browser.click(passwordRef);
  const password = await browser.secureFillEnvelope({ token, kind: "login", envelope,
    fields: [{ name: "password", ref: passwordRef }], expectedUrl: passwordPage.url });
  assert.deepEqual(password.secureFieldNames, ["password"]);
  assert.equal(password.secureFieldsVerified, true);
  await assert.rejects(() => browser.secureFillEnvelope({ token, kind: "login", envelope,
    fields: [{ name: "password", ref: passwordRef }], expectedUrl: passwordPage.url }), /recipient has expired/);
  console.log("PASS: duplicate username untouched, Next is explicit, one unlock spans both pages");
  return { fields: ["username", "password"], deviceUnlocks: 1 };
}

const hostedPaymentPages = [
  "https://payhq-iframe-test-demo.firebaseapp.com/",
  "https://codepen.io/braintree/embed/f7497c9567d6f14fa0200ee1a09f9011/?default-tab=result&embed-version=2&height=523&theme-id=23962",
  "https://www.keytransact.com/checkout-forms",
];

async function testSecureHostedCard(browser: BrowserlessCloudBrowserProvider, userId: string) {
  const failures: string[] = [];
  for (const url of hostedPaymentPages) {
    try {
      console.log(`Checking hosted card fields on ${new URL(url).hostname}`);
      await browser.open(userId, url);
      const page = await browser.wait(4000);
      const cardRef = elementRef(page, /card number|credit card(?:\s|$)|cc-number/i);
      const expiryRef = elementRef(page, /expiration|expiry|expires/i);
      const securityRef = elementRef(page, /cvv|cvc|security code/i);
      assert.ok(cardRef && expiryRef && securityRef, `hosted form must expose explicit card/expiry/CVC refs: ${JSON.stringify(page.elements.map(({ref,name,type,role}) => ({ref,name,type,role})))}`);
      const token = randomBytes(16).toString("hex");
      const recipient = await browser.createDeviceVaultRecipient(token);
      const envelope = seal({ kind: "payment_card", cardNumber: "4111111111111111", expiryMonth: "12", expiryYear: "2030", securityCode: "123" }, recipient.publicKey);
      const fields = [{ name: "cardNumber", ref: cardRef }, { name: "expiry", ref: expiryRef }, { name: "securityCode", ref: securityRef }];
      for (const field of fields) {
        console.log(`Clicking ${field.name} (${field.ref})`);
        await browser.click(field.ref);
        await browser.assertSecureTarget(field.ref);
        console.log(`Typing ${field.name}`);
        const filled = await browser.secureFillEnvelope({ token, kind: "payment_card", envelope, fields: [field],
          expectedUrl: page.url, retainForSecureTyping: field.name !== "securityCode" });
        assert.equal(filled.secureFieldsVerified, true);
        assert.deepEqual(filled.secureFieldNames, [field.name]);
        console.log(`PASS: explicitly selected ${field.name}`);
        if (field.name === "cardNumber") {
          assert.deepEqual(filled.elements.find(element => element.ref === expiryRef), page.elements.find(element => element.ref === expiryRef));
          assert.deepEqual(filled.elements.find(element => element.ref === securityRef), page.elements.find(element => element.ref === securityRef));
        }
        assert.doesNotMatch(filled.formatted, /4111111111111111/);
      }
      console.log("PASS: hosted card fields each require a separate explicit click/type call; no submission");
      return { url, fields: fields.map(field => field.name), deviceUnlocks: 1 };
    } catch (error) {
      const failure = `${url}: ${error instanceof Error ? error.message : String(error)}`;
      console.warn(failure);
      failures.push(failure);
    }
  }
  assert.fail(`No hosted payment smoke-test page passed:\n${failures.join("\n")}`);
}

const userId = `secure-typing-smoke-${Date.now()}@example.test`;
const browser = new BrowserlessCloudBrowserProvider();
try {
  const only = process.argv.find(argument => argument.startsWith("--only="))?.slice(7);
  const ordinary = !only || only === "ordinary" ? await testOrdinaryTyping(browser, userId) : undefined;
  const login = !only || only === "login" ? await testSecureLogin(browser, userId) : undefined;
  const multiPageLogin = !only || only === "multi-page" ? await testSecureMultiPageLoginRelease(browser, userId) : undefined;
  const payment = !only || only === "payment" ? await testSecureHostedCard(browser, userId) : undefined;
  console.log(JSON.stringify({ ok: true, ordinary, login, multiPageLogin, payment }, null, 2));
} finally {
  await browser.destroy();
}
