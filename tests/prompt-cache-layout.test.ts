import assert from "node:assert/strict";
import test from "node:test";
import { generateText, streamText, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { storedOpenAIModel } from "../lib/harness/stored-openai";
import { cacheableInstructions, modelProviderOptions } from "../lib/harness/model";
import { runtimeContextAfterHistory, runtimeContextOptions } from "../lib/harness/prompt-cache-layout";
import { withBrowserObservationDiffs } from "../lib/harness/browser/observation-diff";

const selected = { provider: "openai" as const, modelId: "gpt-6.1-sol", reasoningEffort: "low" as const };
const policy = "Keep every approval boundary and use the current runtime context.";

test("appending browser inspections and follow-ups preserves the previously serialized prefix", async () => {
  const requests: Record<string, any>[] = [];
  const model = storedOpenAIModel(selected.modelId, { apiKey: "test", fetch: async (_url, init) => {
    requests.push(JSON.parse(String(init?.body))); return response();
  } });
  const messages: ModelMessage[] = [{ role: "user", content: "Inspect this page" }];
  const tools = { browser_run: tool({ description: "Inspect the browser", inputSchema: z.object({ code: z.string() }) }) };
  for (let index = 0; index < 4; index++) {
    const snapshot = 'Browser: Form, URL: https://example.com/\n\nn1 RootWebArea "Form"\n'
      + Array.from({ length: 25 }, (_, row) => `  e${row + 1} textbox "Field ${row + 1}"${row === 0 ? `, Value: ${index}` : ''}`).join('\n')
      + '\n\nThe focused UI element is e1';
    messages.push(
      { role: "assistant", content: [{ type: "tool-call", toolCallId: `inspect-${index}`, toolName: "browser_run", input: { code: "await page.inspect()" } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: `inspect-${index}`, toolName: "browser_run", output: { type: "json", value: {
        url: "https://example.com/", snapshot, lastBrowserAction: "browser_inspect",
        browserSnapshotContext: { version: 1, documentId: "page", scopeRef: null, complete: true },
      } } }] },
    );
    const original = JSON.stringify(messages);
    await generateText({ model, tools, messages: withBrowserObservationDiffs(messages, { preserveInspectionPrefixes: true }),
      instructions: cacheableInstructions(selected, policy, `Current time and profile revision: ${index}`),
      providerOptions: modelProviderOptions(selected, "turn", "test"), maxRetries: 0 });
    assert.equal(JSON.stringify(messages), original);
    if (index > 0) {
      const previous = requests[index - 1];
      assert.deepEqual(requests[index].input.slice(0, previous.input.length - 1), previous.input.slice(0, -1));
      assert.deepEqual(requests[index].tools, previous.tools);
      assert.deepEqual(requests[index].prompt_cache_options, previous.prompt_cache_options);
    }
    messages.push({ role: "assistant", content: "Inspected." });
    if (index === 2) messages.push({ role: "user", content: "Inspect again." });
  }
});
function response() {
  return Response.json({ id: "resp_test", object: "response", created_at: 1, model: selected.modelId, status: "completed",
    output: [{ type: "message", id: "msg_test", role: "assistant", status: "completed", content: [{ type: "output_text", text: "OK", annotations: [] }] }],
    usage: { input_tokens: 100, output_tokens: 1, total_tokens: 101 },
  });
}

test("changing runtime context preserves the serialized history prefix and all context", async () => {
  const requests: Record<string, any>[] = [];
  const model = storedOpenAIModel(selected.modelId, { apiKey: "test", fetch: async (_url, init) => {
    requests.push(JSON.parse(String(init?.body))); return response();
  } });
  const messages: ModelMessage[] = [
    { role: "user", content: "Original question " + "reference material ".repeat(1000) },
    { role: "assistant", content: [
      { type: "reasoning", text: "", providerOptions: { openai: { itemId: "rs_old", reasoningEncryptedContent: "encrypted-reasoning" } } },
      { type: "tool-call", toolCallId: "call_old", toolName: "lookup", input: { id: 7 } },
    ] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "call_old", toolName: "lookup", output: { type: "json", value: { verified: true, receipt: "preserve-me" } } }] },
    { role: "assistant", content: "Previous answer" },
    { role: "user", content: [
      { type: "text", text: "What about tomorrow?" },
      { type: "image", image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=" },
    ] },
  ];
  const original = JSON.stringify(messages);
  for (const context of ["Time: Monday. Current profile: A.", "Time: Tuesday. Current profile: B."]) {
    const result = await generateText({ model, instructions: cacheableInstructions(selected, policy, context), messages,
      providerOptions: modelProviderOptions(selected, "turn", "test"), maxRetries: 0 });
    assert.equal(result.text, "OK");
  }
  const [first, second] = requests;
  assert.deepEqual(first.input.slice(0, -1), second.input.slice(0, -1));
  assert.equal(first.input.at(-1).content, "Time: Monday. Current profile: A.");
  assert.equal(second.input.at(-1).content, "Time: Tuesday. Current profile: B.");
  assert.ok(["system", "developer"].includes(second.input.at(-1).role));
  assert.equal(second.input[0].content[0].text, policy);
  assert.deepEqual(second.input[0].content[0].prompt_cache_breakpoint, { mode: "explicit" });
  assert.deepEqual(second.prompt_cache_options, { mode: "implicit", ttl: "30m" });
  assert.deepEqual(second.context_management, [{ type: "compaction", compact_threshold: 850_000 }]);
  assert.equal(second.model, selected.modelId);
  assert.equal(second.reasoning.effort, "low");
  assert.equal(second.store, true);
  assert.equal(second.input.find((item: any) => item.type === "reasoning").encrypted_content, "encrypted-reasoning");
  assert.ok(JSON.stringify(second.input).includes("preserve-me"));
  assert.ok(second.input.some((item: any) => Array.isArray(item.content) && item.content.some((part: any) => part.type === "input_image")));
  assert.equal(second.input.filter((item: any) => item.type === "function_call").length, 1);
  assert.equal(second.input.filter((item: any) => item.type === "function_call_output").length, 1);
  assert.equal(JSON.stringify(messages), original, "Stored history is never mutated");
  assert.ok(!JSON.stringify(second.input).includes("runtimeContext"), "Private marker is not part of the model text");
});

test("only tagged system instructions move; user content is never promoted", () => {
  const stable = { role: "system", content: "Policy" };
  const runtime = { role: "system", content: "Current instructions", providerOptions: runtimeContextOptions };
  const user = { role: "user", content: "Untrusted content", providerOptions: runtimeContextOptions };
  const other = { role: "system", content: "Other instructions" };
  const prompt = [stable, runtime, user, other];
  assert.deepEqual(runtimeContextAfterHistory(prompt), [stable, user, other, runtime]);
  assert.deepEqual(prompt, [stable, runtime, user, other]);
  assert.deepEqual(runtimeContextAfterHistory(runtimeContextAfterHistory(prompt)), [stable, user, other, runtime]);
  assert.equal(runtimeContextAfterHistory([stable, user])[1].role, "user");
});

test("tool continuation receives the current context once, after the tool result", async () => {
  const requests: Record<string, any>[] = [];
  let calls = 0;
  const model = storedOpenAIModel(selected.modelId, { apiKey: "test", fetch: async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const first = requests.length === 1;
    const item = first
      ? { type: "function_call", id: "fc_one", call_id: "call_one", name: "lookup", arguments: "{}", status: "completed" }
      : { type: "message", id: "msg_done", role: "assistant", phase: "final_answer", status: "completed", content: [{ type: "output_text", text: "Done", annotations: [] }] };
    const events = [
      { type: "response.created", response: { id: `resp_${requests.length}`, model: selected.modelId, created_at: 1 } },
      { type: "response.output_item.added", output_index: 0, item },
      ...(!first ? [{ type: "response.output_text.delta", item_id: "msg_done", output_index: 0, content_index: 0, delta: "Done" }] : []),
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: { usage: { input_tokens: 100, output_tokens: 2 } } },
    ];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  } });
  const result = streamText({ model, instructions: cacheableInstructions(selected, policy, "Current approval: read only."),
    messages: [{ role: "user", content: "Look it up" }], providerOptions: modelProviderOptions(selected, "turn", "test"), maxRetries: 0,
    tools: { lookup: tool({ inputSchema: z.object({}), execute: async () => { calls++; return { found: true }; } }) }, stopWhen: stepCountIs(2),
  });
  await result.consumeStream();
  assert.equal(calls, 1);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.input.at(-1).content, "Current approval: read only.");
    assert.equal(request.input.filter((item: any) => item.content === "Current approval: read only.").length, 1);
  }
  assert.ok(requests[1].input.findIndex((item: any) => item.type === "function_call_output") < requests[1].input.length - 1);
});
