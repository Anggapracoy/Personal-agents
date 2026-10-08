import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { exaAnswer } from "../lib/exa";

test("exaAnswer sends the official request shape and sanitizes citations", async () => {
  const previous = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "test-exa-key";
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  try {
    const result = await exaAnswer({
      query: "  current answer  ",
      includeText: true,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({
          requestId: "req-1",
          answer: "Grounded answer",
          citations: [
            { id: "one", url: "https://example.com/source", title: "Source", text: "Evidence" },
            { id: "two", url: "http://insecure.example/source", title: "Blocked" },
          ],
          costDollars: { total: 0.01 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    const request = requests[0];
    assert.equal(request?.url, "https://api.exa.ai/answer");
    assert.equal((request?.init?.headers as Record<string, string>)["x-api-key"], "test-exa-key");
    assert.deepEqual(JSON.parse(String(request?.init?.body)), { query: "current answer", stream: false, text: true });
    assert.equal(result.answer, "Grounded answer");
    assert.equal(result.citations.length, 1);
    assert.equal(result.citations[0]?.url, "https://example.com/source");
    assert.equal(result.citations[0]?.text, "Evidence");
  } finally {
    if (previous === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = previous;
  }
});

test("both agent harnesses expose the shared read-only Exa Answer tool", async () => {
  const [normal, discovery] = await Promise.all([
    readFile(new URL("../lib/harness/tools.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/discovery/tools.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [normal, discovery]) {
    assert.match(source, /exa_answer:\s*tool/);
    assert.match(source, /exaAnswer\(\{/);
    assert.match(source, /Read-only\./);
  }
  assert.match(normal, /toolName:\s*"exa_answer"[\s\S]*?risk:\s*"read"/);
});

test("exaAnswer fails clearly without a configured key", async () => {
  const previous = process.env.EXA_API_KEY;
  delete process.env.EXA_API_KEY;
  try {
    await assert.rejects(() => exaAnswer({ query: "anything" }), /EXA_API_KEY is not configured/);
  } finally {
    if (previous !== undefined) process.env.EXA_API_KEY = previous;
  }
});

test("search returns bounded source text without synthesizing an answer", async () => {
  const { exaSearch } = await import("../lib/exa");
  const previous = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "test-exa-key";
  try {
    const result = await exaSearch({ query: " official sources ", numResults: 2, fetchImpl: async (url, init) => {
      assert.equal(String(url), "https://api.exa.ai/search");
      assert.deepEqual(JSON.parse(String(init?.body)), { query: "official sources", numResults: 2, type: "auto", contents: { text: { maxCharacters: 4_000 } } });
      return Response.json({ results: [{ url: "https://example.com", title: "Source", text: "a".repeat(5_000) }, { url: "https://127.0.0.1/", text: "private" }] });
    } });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].text?.length, 4_000);
    assert.equal(result.results[0].possiblyTruncated, true);
    assert.equal("answer" in result, false);
  } finally { if (previous === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = previous; }
});

test("fetch preserves partial failure and forwards freshness and cancellation", async () => {
  const { exaFetch } = await import("../lib/exa");
  const previous = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "test-exa-key";
  const controller = new AbortController();
  try {
    const result = await exaFetch({ urls: ["https://example.com/good", "https://example.com/missing"], maxAgeHours: 0, signal: controller.signal, fetchImpl: async (url, init) => {
      assert.equal(String(url), "https://api.exa.ai/contents");
      assert.deepEqual(JSON.parse(String(init?.body)), { urls: ["https://example.com/good", "https://example.com/missing"], text: { maxCharacters: 20_000 }, maxAgeHours: 0 });
      controller.abort();
      assert.equal(init?.signal?.aborted, true);
      return Response.json({ results: [{ url: "https://example.com/good", text: "Policy" }], statuses: [{ id: "https://example.com/missing", status: "error", error: { tag: "CRAWL_NOT_FOUND" } }] });
    } });
    assert.deepEqual(result.missingUrls, ["https://example.com/missing"]);
    assert.equal(result.statuses[0].status, "error");
    assert.match(result.statuses[0].error!, /CRAWL_NOT_FOUND/);
  } finally { if (previous === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = previous; }
});

test("fetch rejects private and credentialed URLs before sending a request", async () => {
  const { exaFetch } = await import("../lib/exa");
  for (const url of ["http://example.com", "https://user:secret@example.com", "https://localhost", "https://10.0.0.1", "https://127.1", "https://[::1]", "https://[::ffff:127.0.0.1]", "https://metadata.google.internal"]) {
    await assert.rejects(() => exaFetch({ urls: [url], fetchImpl: async () => { throw new Error("must not fetch"); } }), /public HTTPS URL/);
  }
});

test("web tools report provider and malformed-response failures", async () => {
  const { exaSearch, exaFetch } = await import("../lib/exa");
  const previous = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "test-exa-key";
  try {
    await assert.rejects(() => exaSearch({ query: "test", fetchImpl: async () => Response.json({ message: "quota exceeded" }, { status: 429 }) }), /quota exceeded/);
    await assert.rejects(() => exaFetch({ urls: ["https://example.com"], fetchImpl: async () => Response.json({}) }), /invalid response/);
    const empty = await exaSearch({ query: "test", fetchImpl: async () => Response.json({ results: [] }) });
    assert.deepEqual(empty.results, []);
  } finally { if (previous === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = previous; }
});
