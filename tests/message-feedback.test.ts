import test from "node:test";
import assert from "node:assert/strict";
import { receiveMessageFeedback, playMessageFeedback } from "../app/message-feedback";

test("message feedback skips history, polling, hidden delivery and groups new message bursts", () => {
  const sent: unknown[] = [];
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const doc = { visibilityState: "visible" };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __decisionFeedNativeMessageFeedback: true, webkit: { messageHandlers: { decisionFeedNative: { postMessage: (message: unknown) => sent.push(message) } } } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  const now = Date.now();
  const message = (id: string, time: number) => ({ id, kind: "agent" as const, text: "Hello", createdAt: new Date(time).toISOString() });
  try {
    receiveMessageFeedback([message("old", now - 1000)], now);
    assert.equal(sent.length, 0);
    receiveMessageFeedback([message("archived", now + 1)], now, true);
    assert.equal(sent.length, 0, 'Archived arrivals are silent');
    receiveMessageFeedback([message("archived", now + 1)], now, false);
    assert.equal(sent.length, 0, 'Unarchiving does not replay old sounds');
    receiveMessageFeedback([message("new", now + 1)], now);
    assert.equal(sent.length, 1);
    receiveMessageFeedback([message("new", now + 1)], now);
    receiveMessageFeedback([message("burst", now + 2)], now);
    assert.equal(sent.length, 1);
    doc.visibilityState = "hidden";
    playMessageFeedback("send");
    receiveMessageFeedback([message("hidden", now + 3)], now);
    assert.equal(sent.length, 1);
    doc.visibilityState = "visible";
    receiveMessageFeedback([message("hidden", now + 3)], now);
    assert.equal(sent.length, 1);
    playMessageFeedback("send");
    assert.deepEqual(sent.at(-1), { version: 1, action: "messageFeedback", payload: { kind: "send" } });
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else Reflect.deleteProperty(globalThis, "document");
  }
});
