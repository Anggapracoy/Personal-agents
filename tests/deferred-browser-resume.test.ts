import assert from "node:assert/strict";
import test from "node:test";
import { withDeferredBrowserResume } from "../lib/harness/browser/deferred-resume";

test("text-only turns do not resume an old browser; lifecycle methods remain direct", async () => {
  const calls: string[] = [];
  const browser = withDeferredBrowserResume({
    label: "existing session",
    async setWaitingForUser(waiting: boolean, reconnect = false) { calls.push(`wait:${waiting}:${reconnect}`); },
    async snapshot() { calls.push("snapshot"); },
    async destroy() { calls.push("destroy"); },
  });
  assert.equal(browser.label, "existing session");
  assert.deepEqual(calls, []);
  await browser.setWaitingForUser(true);
  await browser.destroy();
  assert.deepEqual(calls, ["wait:true:false", "destroy"]);
});

test("concurrent first browser actions wait for a single resume and preserve this/arguments", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const browser = withDeferredBrowserResume({
    label: "session",
    async setWaitingForUser(waiting: boolean, reconnect = false) { calls.push(`wait:${waiting}:${reconnect}`); await gate; },
    async inspect(ref: string) { calls.push(ref); return `${this.label}:${ref}`; },
  });
  const first = browser.inspect("e1"), second = browser.inspect("e2");
  assert.deepEqual(calls, ["wait:false:true"]);
  release();
  assert.deepEqual(await Promise.all([first, second]), ["session:e1", "session:e2"]);
  await browser.inspect("e3");
  assert.deepEqual(calls, ["wait:false:true", "e1", "e2", "e3"]);
});

test("cancellation during resume stops the browser action", async () => {
  const controller = new AbortController();
  const browser = withDeferredBrowserResume({
    async setWaitingForUser() { controller.abort(); },
    async inspect() { assert.fail("cancelled action ran"); },
  }, controller.signal);
  await assert.rejects(browser.inspect(), { name: "AbortError" });
});

test("a failed resume never permits the action or retries it implicitly", async () => {
  let resumes = 0;
  const browser = withDeferredBrowserResume({
    async setWaitingForUser() { resumes++; throw new Error("resume failed"); },
    async inspect() { assert.fail("action ran after resume failed"); },
  });
  await assert.rejects(browser.inspect(), /resume failed/);
  await assert.rejects(browser.inspect(), /resume failed/);
  assert.equal(resumes, 1);
});

test("cached URL getter remains synchronous and never resumes the browser", () => {
  let resumes = 0;
  const browser = withDeferredBrowserResume({
    url: "https://example.com/checkout",
    async setWaitingForUser() { resumes++; },
    currentUrl() { return this.url; },
  });
  assert.equal(browser.currentUrl(), "https://example.com/checkout");
  assert.deepEqual(JSON.parse(JSON.stringify({pageUrl:browser.currentUrl()})), {pageUrl:"https://example.com/checkout"});
  assert.equal(resumes, 0);
});
