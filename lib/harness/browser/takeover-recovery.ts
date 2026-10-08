import type { AgentAction } from "../types";

export function browserSessionExpired(error: unknown) {
  return error instanceof Error && /Browser session is (?:not running|ending)/.test(error.message);
}

export function pendingTakeover(actions: AgentAction[]) {
  return [...actions].reverse().find(action => action.toolName === "browser_request_takeover" && action.status === "proposed");
}

export function browserUnavailablePage(runId: string, expired: boolean, canReopen: boolean) {
  const action = `/api/runs/${encodeURIComponent(runId)}/browser?control=1`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Browser unavailable</title><link rel="stylesheet" href="/ink-glass.css"><style>
  :root{color-scheme:light dark}*{box-sizing:border-box}body{--ink:light-dark(#171717,#f5f5f5);margin:0;background:light-dark(#fff,#111);color:light-dark(#171717,#f5f5f5);font:17px/1.4 -apple-system,BlinkMacSystemFont,Arial,sans-serif;display:grid;min-height:100svh;place-items:center;padding:28px}main{max-width:340px}h1{font-size:22px;line-height:1.2;letter-spacing:-.4px;margin:0 0 12px}p{color:light-dark(#666,#aaa);margin:0 0 20px}button{font:600 15px -apple-system,BlinkMacSystemFont,Arial,sans-serif;border:0;border-radius:24px;padding:14px 20px;background:light-dark(#171717,#f5f5f5);color:light-dark(#fff,#171717);cursor:pointer;min-height:44px}</style></head><body><main><h1>${expired ? "This browser session expired" : "Browser unavailable"}</h1><p>${expired ? "The website closed before you could finish. A fresh browser can reopen the page, but you may need to enter details again." : "We couldn’t connect to the browser. Close this view and try again."}</p>${expired && canReopen ? `<form method="post" action="${action}"><button class="dash-ink-button" type="submit">Reopen page</button></form>` : "<p>Close this view and return to the conversation to continue.</p>"}</main></body></html>`;
}

export async function reopenTakeover(browser: {
  takeoverUrl(userId: string): Promise<string>;
  open(userId: string, url: string): Promise<unknown>;
}, userId: string, pageUrl: string) {
  try { return await browser.takeoverUrl(userId); }
  catch (error) { if (!browserSessionExpired(error)) throw error; }
  await browser.open(userId, pageUrl);
  return browser.takeoverUrl(userId);
}
