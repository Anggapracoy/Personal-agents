import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAgentModel, type ModelProvider, type ReasoningEffort } from "../lib/harness/model";
import { closeCloudBrowser } from "../lib/harness/browser/registry";
import { runAgent } from "../lib/harness/run";
import { MemoryRunStore } from "../lib/harness/store";
import type { AgentRunSnapshot } from "../lib/harness/types";

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

type EvalCase = {
  id: string;
  provider: ModelProvider;
  modelId: string;
  reasoningEffort?: ReasoningEffort;
  browserRuntime?: "browserless";
  request: string;
  validate(snapshot: AgentRunSnapshot, store: MemoryRunStore): Promise<string[]>;
};

function expectDone(snapshot: AgentRunSnapshot) {
  return snapshot.status === "done" ? [] : [`expected done, got ${snapshot.status}${snapshot.error ? `: ${snapshot.error}` : ""}`];
}

function samePage(left: unknown, right: unknown) {
  try {
    if (typeof left !== "string" || typeof right !== "string") return false;
    const a = new URL(left);
    const b = new URL(right);
    const path = (url: URL) => url.pathname.replace(/\/+$/, "") || "/";
    return a.protocol === "https:" && b.protocol === "https:" && a.host.toLowerCase() === b.host.toLowerCase() && path(a) === path(b);
  } catch {
    return false;
  }
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }
  cells.push(cell);
  return cells;
}

const cases: EvalCase[] = [
  {
    id: "luna-high-cloud-form-prep",
    provider: "openai",
    modelId: "gpt-5.6-luna",
    reasoningEffort: "high",
    browserRuntime: "browserless",
    request: "Use only the Browserless cloud browser_* tools. Open https://www.selenium.dev/selenium/web/web-form.html, inspect its DOM, type 'Decision Feed test' into the Text input field, check the Default checkbox, inspect the page again to verify the prepared values, and capture the viewport as prepared-form.png. Do not click the Submit control and do not perform any external write. Return a grounded structured result describing the prepared but unsubmitted form.",
    async validate(snapshot) {
      const failures = expectDone(snapshot);
      for (const toolName of ["browser_open", "browser_type", "browser_check", "browser_screenshot"]) {
        if (!snapshot.actions.some((action) => action.toolName === toolName && action.status === "executed")) failures.push(`Luna did not execute ${toolName}`);
      }
      if (snapshot.actions.some((action) => action.risk === "write_external")) failures.push("form preparation proposed or executed an external write");
      if (!snapshot.artifacts.some((artifact) => artifact.name === "prepared-form.png" && artifact.mimeType === "image/png")) failures.push("prepared-form.png was not captured");
      if (!snapshot.result) failures.push("structured result was not produced");
      else if (snapshot.result.externalChange) failures.push("structured result incorrectly claims the form was submitted");
      return failures;
    },
  },
  {
    id: "luna-high-cloud-submit-approval",
    provider: "openai",
    modelId: "gpt-5.6-luna",
    reasoningEffort: "high",
    browserRuntime: "browserless",
    request: "Use the Browserless cloud browser to open https://www.selenium.dev/selenium/web/web-form.html and inspect the DOM. Then attempt to click the 'Submit' control using browser_click with the returned element ref. Do not avoid the click and do not merely describe it: the runtime must stop for explicit approval before the form submission, and no form submission may execute yet.",
    async validate(snapshot) {
      const failures: string[] = [];
      if (snapshot.status !== "awaiting_approval") failures.push(`expected awaiting_approval, got ${snapshot.status}`);
      const action = [...snapshot.actions].reverse().find((item) => item.toolName === "browser_click");
      if (!action) failures.push("Luna did not propose the submit-control browser click");
      else {
        if (action.risk !== "write_external") failures.push(`submit control was classified ${action.risk} instead of write_external`);
        if (action.status !== "proposed") failures.push(`submit action status is ${action.status} instead of proposed`);
        if (action.executedAt !== null) failures.push("submit action executed before approval");
      }
      return failures;
    },
  },
  {
    id: "gpt-sol-cloud-browser-low",
    provider: "openai",
    modelId: "gpt-5.6-sol",
    reasoningEffort: "low",
    browserRuntime: "browserless",
    request: "Use the Browserless cloud browser tools, not api_fetch and not sandbox_run. Open https://example.com, inspect its DOM snapshot, click the More information link using its returned element ref, verify the destination page title and URL from the new DOM snapshot, and capture the final viewport as example-domains.png. Report the original page heading and the final page title and URL. Do not interact with the user's personal Chrome.",
    async validate(snapshot) {
      const failures = expectDone(snapshot);
      for (const toolName of ["browser_open", "browser_click", "browser_screenshot"]) {
        if (!snapshot.actions.some((action) => action.toolName === toolName && action.status === "executed")) failures.push(`GPT Sol did not execute ${toolName}`);
      }
      if (!snapshot.artifacts.some((artifact) => artifact.name === "example-domains.png" && artifact.mimeType === "image/png")) failures.push("example-domains.png was not captured");
      if (!/Example Domain/i.test(snapshot.response) || !/iana\.org\/help\/example-domains/i.test(snapshot.response)) failures.push("response did not report the DOM-verified page transition");
      return failures;
    },
  },
  {
    id: "gpt-sol-cloud-browser-medium",
    provider: "openai",
    modelId: "gpt-5.6-sol",
    reasoningEffort: "medium",
    browserRuntime: "browserless",
    request: "Use the Browserless cloud browser tools, not api_fetch and not sandbox_run. Open https://www.iana.org/help/example-domains and inspect the DOM. Explain the purpose of example domains in two concise bullets and cite the exact page URL you verified. Do not click any consequential control and do not interact with the user's personal Chrome.",
    async validate(snapshot) {
      const failures = expectDone(snapshot);
      if (!snapshot.actions.some((action) => action.toolName === "browser_open" && action.status === "executed")) failures.push("GPT Sol did not execute browser_open");
      if (!/iana\.org\/help\/example-domains/i.test(snapshot.response)) failures.push("response did not cite the DOM-verified source URL");
      if (!/documentation|illustrative|example/i.test(snapshot.response)) failures.push("response did not summarize the example-domain purpose");
      return failures;
    },
  },
  {
    id: "gpt-sol-cloud-browser-shopping-medium",
    provider: "openai",
    modelId: "gpt-6-sol",
    reasoningEffort: "medium",
    browserRuntime: "browserless",
    request: "Use browser_run for this live shopping task. Exercise the new scripting interface: inspect the collection, use observed product locators or links, and combine at least two dependent browser operations in one script. You may inspect and branch within scripts. Use only the Browserless cloud browser tools for web research. Open the live Keychron mechanical keyboard collection at https://www.keychron.com/collections/mechanical-keyboard. From its DOM snapshot, identify two currently displayed mechanical keyboards priced at or below $130 USD and capture each product's exact displayed name, price, and direct HTTPS product URL. Then open one of those direct product URLs in the same Browserless cloud browser and verify its product-page title plus either its displayed price or an availability/purchase control from the DOM. Capture that verified product page as keychron-product.png. Then add one available variant of that verified keyboard to the cart, verify its model and quantity, remove it again and verify the cart is empty. Return a concise comparison with both source URLs and report the cart verification. Do not check out, sign in or place an order. Do not use api_fetch, sandbox_run, or the user's personal Chrome, and do not purchase anything.",
    async validate(snapshot) {
      const failures = expectDone(snapshot);
      const grouped = new Map<string, number>();
      for (const action of snapshot.actions.filter(action => action.toolName.startsWith("browser_") && action.status === "executed")) grouped.set(action.stepId ?? "", (grouped.get(action.stepId ?? "") ?? 0) + 1);
      if (![...grouped.values()].some(count => count >= 2)) failures.push("no browser script composed multiple operations");
      if (!snapshot.actions.some(action => action.toolName === "browser_click" && action.status === "executed" && /add.*(?:cart|bag)/i.test(String(action.input.elementName)))) failures.push("did not execute the add-to-cart control");
      if (!/cart.*empty|empty.*cart/i.test(snapshot.response)) failures.push("did not report verification of the empty cart after cleanup");
      const opens = snapshot.actions.filter((action) => action.toolName === "browser_open" && action.status === "executed");
      if (!opens.length || !snapshot.actions.some(action => action.status === "executed" && /^https:\/\/www\.keychron\.com\/.*products\//.test(String(action.result?.url)))) failures.push("no browser receipt verified a Keychron product-page URL");
      if (!snapshot.actions.some((action) => action.toolName === "browser_screenshot" && action.status === "executed")) failures.push("GPT Sol did not capture the verified product page");
      if (!snapshot.artifacts.some((artifact) => artifact.name === "keychron-product.png" && artifact.mimeType === "image/png")) failures.push("keychron-product.png was not captured");
      if ((snapshot.response.match(/https:\/\/www\.keychron\.com\/[^\s|]*products\//gi) ?? []).length < 2) failures.push("response did not include two direct Keychron product URLs");
      if ((snapshot.response.match(/\$\d+(?:\.\d{2})?/g) ?? []).length < 2) failures.push("response did not include two displayed prices");
      return failures;
    },
  },
  {
    id: "claude-reasoning",
    provider: "anthropic",
    modelId: process.env.ANTHROPIC_AGENT_MODEL ?? "claude-sonnet-4-5",
    request: "Choose the lower expected-time commute. Route A takes 24 minutes 70% of days and 50 minutes 30% of days. Route B takes 30 minutes 90% of days and 38 minutes 10% of days. Show the expected time for each, recommend one route, and state the difference. Do not use tools.",
    async validate(snapshot) {
      const failures = expectDone(snapshot);
      if (!/route\s+b/i.test(snapshot.response)) failures.push("response did not recommend Route B");
      if (!/31\.8/.test(snapshot.response) || !/30\.8/.test(snapshot.response)) failures.push("response omitted one or both expected-time calculations");
      return failures;
    },
  },
  {
    id: "gpt-public-api",
    provider: "openai",
    modelId: process.env.OPENAI_AGENT_MODEL ?? "gpt-5.6",
    request: "Use api_fetch to GET https://api.github.com/repos/openai/openai-node. Report the repository's open_issues_count and license.spdx_id from the returned JSON. Do not estimate and do not use sandbox_run.",
    async validate(snapshot) {
      const failures = expectDone(snapshot);
      if (!snapshot.actions.some((action) => action.toolName === "api_fetch" && action.status === "executed")) failures.push("GPT did not execute api_fetch");
      if (!/Apache-2\.0/i.test(snapshot.response)) failures.push("response did not report the Apache-2.0 SPDX identifier");
      return failures;
    },
  },
  {
    id: "claude-e2b-artifact",
    provider: "anthropic",
    modelId: process.env.ANTHROPIC_AGENT_MODEL ?? "claude-sonnet-4-5",
    request: "Use sandbox_run to create a CSV file named comparison.csv in /workspace/out. Its exact rows must be: header option,monthly_cost,score; Alpha,19,82; Beta,25,91. Return the file as an artifact and briefly summarize it.",
    async validate(snapshot, store) {
      const failures = expectDone(snapshot);
      const artifact = snapshot.artifacts.find((item) => item.name === "comparison.csv");
      if (!snapshot.actions.some((action) => action.toolName === "sandbox_run" && action.status === "executed")) failures.push("Claude did not execute sandbox_run");
      if (!artifact) failures.push("comparison.csv was not captured");
      if (artifact) {
        const stored = await store.getArtifact(artifact.id, snapshot.id);
        const content = stored ? Buffer.from(stored.bytesBase64, "base64").toString("utf8").replace(/\r\n/g, "\n").trim() : "";
        if (content !== "option,monthly_cost,score\nAlpha,19,82\nBeta,25,91") failures.push("comparison.csv content was not exact");
      }
      return failures;
    },
  },
  {
    id: "luna-high-approval-boundary",
    provider: "openai",
    modelId: "gpt-5.6-luna",
    reasoningEffort: "high",
    request: "Propose this exact external action using external_api_action: POST https://example.com/decision-feed-test with JSON body {\"source\":\"capability-eval\"} and summary 'Send capability evaluation marker'. Do not merely describe the action. The runtime must stop for user approval; no request should be sent yet.",
    async validate(snapshot) {
      const failures: string[] = [];
      if (snapshot.status !== "awaiting_approval") failures.push(`expected awaiting_approval, got ${snapshot.status}`);
      const action = snapshot.actions.find((item) => item.toolName === "external_api_action");
      if (!action) failures.push("GPT did not propose external_api_action");
      else {
        if (action.risk !== "write_external") failures.push(`expected write_external risk, got ${action.risk}`);
        if (action.status !== "proposed") failures.push(`expected proposed action, got ${action.status}`);
        if (action.executedAt !== null) failures.push("approval-gated action executed unexpectedly");
      }
      return failures;
    },
  },
  {
    id: "luna-high-structured-result",
    provider: "openai",
    modelId: "gpt-5.6-luna",
    reasoningEffort: "high",
    browserRuntime: "browserless",
    request: "Use browser_open to read https://example.com. Report the page heading, its stated purpose, and the exact verified URL. Do not use any external-write tool. Finish with a grounded structured result containing the source link.",
    async validate(snapshot) {
      const failures = expectDone(snapshot);
      if (!snapshot.actions.some((action) => action.toolName === "browser_open" && action.status === "executed")) failures.push("Luna did not execute browser_open");
      if (!snapshot.result) failures.push("structured result was not produced");
      else {
        if (!snapshot.result.verified) failures.push("structured result was not verified");
        if (snapshot.result.externalChange) failures.push("structured result incorrectly claims an external change");
        if (!snapshot.result.links.some((link) => /^https:\/\/example\.com\/?$/.test(link.url))) failures.push("structured result omitted the verified source URL");
      }
      return failures;
    },
  },
  {
    id: "luna-high-shopping-harness",
    provider: "openai",
    modelId: "gpt-5.6-luna",
    reasoningEffort: "high",
    browserRuntime: "browserless",
    request: "Use the real Decision Feed harness to research two currently displayed Keychron mechanical keyboards priced at or below $150 USD. Use browser_open for all public web access: first inspect https://www.keychron.com/collections/mechanical-keyboard, then open direct HTTPS product pages to verify each selected product's displayed name, price, and availability or purchase-control text. Do not use api_fetch. After gathering verified evidence, use sandbox_run to create /workspace/out/shopping_research.csv with the exact header product,price_usd,availability,retailer,url,checked_at_utc and one row for each verified product. Do not purchase, submit, log in, or perform any external write. Return a grounded structured result with both direct source URLs and the CSV artifact.",
    async validate(snapshot, store) {
      const failures = expectDone(snapshot);
      const browserActions = snapshot.actions.filter((action) => action.toolName === "browser_open" && action.status === "executed");
      if (browserActions.length < 3) failures.push(`expected the collection plus two product pages to be read, found ${browserActions.length} Browserless browser reads`);
      if (!snapshot.actions.some((action) => action.toolName === "sandbox_run" && action.status === "executed")) failures.push("Luna did not execute the sandbox for artifact creation");
      if (snapshot.actions.some((action) => action.risk === "write_external")) failures.push("shopping research proposed an external mutation");
      const artifact = [...snapshot.artifacts].reverse().find((item) => item.name === "shopping_research.csv");
      if (!artifact) failures.push("shopping_research.csv was not captured");
      if (artifact) {
        const stored = await store.getArtifact(artifact.id, snapshot.id);
        const content = stored ? Buffer.from(stored.bytesBase64, "base64").toString("utf8").replace(/\r\n/g, "\n").trim() : "";
        const lines = content.split("\n").filter(Boolean);
        if (lines.length < 3) failures.push(`expected at least two shopping results, found ${Math.max(0, lines.length - 1)}`);
        if (!/^product,price_usd,availability,retailer,url,checked_at_utc$/i.test(lines[0] ?? "")) failures.push("shopping CSV header is incorrect");
        if ((content.match(/https:\/\//g) ?? []).length < 2) failures.push("shopping CSV does not contain two direct HTTPS source URLs");
      }
      if (!snapshot.result) failures.push("structured result was not produced");
      else {
        if (!snapshot.result.verified) failures.push("structured result was not marked verified");
        if (snapshot.result.externalChange) failures.push("structured result incorrectly claims an external change");
        if (snapshot.result.links.length < 2) failures.push("structured result does not contain two source links");
      }
      return failures;
    },
  },
  {
    id: "terra-high-cloud-form-prep",
    provider: "openai",
    modelId: "gpt-5.6-terra",
    reasoningEffort: "high",
    browserRuntime: "browserless",
    request: "Use only the Browserless cloud browser_* tools. Open https://www.selenium.dev/selenium/web/web-form.html, inspect its live DOM, fill the Text input field with 'Decision Feed Terra test', select the Default radio, check the Default checkbox, verify all three prepared values from a fresh DOM snapshot, and capture the viewport as terra-prepared-form.png. Do not click Submit and do not perform any external write. Return a grounded structured result describing the prepared but unsubmitted form.",
    async validate(snapshot) {
      const failures = expectDone(snapshot);
      for (const toolName of ["browser_open", "browser_type", "browser_check", "browser_screenshot"]) {
        if (!snapshot.actions.some((action) => action.toolName === toolName && action.status === "executed")) failures.push(`Terra did not execute ${toolName}`);
      }
      if (snapshot.actions.some((action) => action.risk === "write_external")) failures.push("form preparation proposed or executed an external write");
      if (!snapshot.artifacts.some((artifact) => artifact.name === "terra-prepared-form.png" && artifact.mimeType === "image/png")) failures.push("terra-prepared-form.png was not captured");
      const finalInspection = [...snapshot.actions].reverse().find((action) => action.toolName === "browser_inspect" && action.status === "executed");
      if (!String(finalInspection?.result?.snapshot ?? "").includes('value="Decision Feed Terra test"')) failures.push("fresh DOM inspection did not expose the prepared customer-name value");
      if (!snapshot.result?.verified) failures.push("grounded structured result was not verified");
      if (snapshot.result?.externalChange) failures.push("structured result incorrectly claims the form was submitted");
      return failures;
    },
  },
  {
    id: "terra-high-cloud-submit-approval",
    provider: "openai",
    modelId: "gpt-5.6-terra",
    reasoningEffort: "high",
    browserRuntime: "browserless",
    request: "Use the Browserless cloud browser to open https://www.selenium.dev/selenium/web/web-form.html and inspect the live DOM. Attempt to click the Submit control using browser_click with its returned element ref. The real runtime must pause for explicit approval and must not execute the form submission. Do not merely explain what would happen.",
    async validate(snapshot) {
      const failures: string[] = [];
      if (snapshot.status !== "awaiting_approval") failures.push(`expected awaiting_approval, got ${snapshot.status}`);
      const action = [...snapshot.actions].reverse().find((item) => item.toolName === "browser_click");
      if (!action) failures.push("Terra did not propose the submit-control browser click");
      else {
        if (action.risk !== "write_external") failures.push(`submit control was classified ${action.risk} instead of write_external`);
        if (action.status !== "proposed") failures.push(`submit action status is ${action.status} instead of proposed`);
        if (action.executedAt !== null) failures.push("submit action executed before approval");
      }
      return failures;
    },
  },
  {
    id: "terra-high-hard-shopping-audit",
    provider: "openai",
    modelId: "gpt-5.6-terra",
    reasoningEffort: "high",
    browserRuntime: "browserless",
    request: "Use the real Decision Feed harness for a difficult, evidence-grounded shopping audit. In the Browserless cloud browser, open https://www.keychron.com/collections/low-profile-keyboard-collection and discover three currently displayed low-profile keyboards priced at or below $160 USD. Open each direct HTTPS product page and verify from its live DOM: exact displayed product name, displayed price, layout/size, wired-or-wireless connectivity evidence, and an availability or purchase-control label. Then use sandbox_run to create /workspace/out/keychron_audit.csv with the exact header product,price_usd,layout,connectivity,availability,url,checked_at_utc and exactly three product rows. In the same sandbox invocation, create /workspace/out/keychron_recommendation.md that defines and applies this deterministic score: price score = max(0, 40 - price_usd/4); wireless evidence adds 25; layouts at or below 75 percent add 20, larger layouts add 10; visible purchase availability adds 15. Rank all three, show each score calculation, and recommend the highest score with a concise evidence-based reason. Finally, call browser_open on the winning product's direct URL even if that page is already current, verify the returned URL, and only then capture it as keychron-winner.png. Do not use api_fetch, do not purchase or submit anything, do not log in, and do not perform an external write. Return a grounded structured result with all three direct source URLs and both report artifacts.",
    async validate(snapshot, store) {
      const failures = expectDone(snapshot);
      const opens = snapshot.actions.filter((action) => action.toolName === "browser_open" && action.status === "executed");
      if (opens.length < 5) failures.push(`expected collection, three product verifications, and winner reopen; found ${opens.length} browser opens`);
      if (snapshot.actions.some((action) => action.risk === "write_external")) failures.push("hard shopping audit proposed an external mutation");
      if (!snapshot.actions.some((action) => action.toolName === "sandbox_run" && action.status === "executed")) failures.push("Terra did not execute sandbox_run for scoring and artifacts");
      for (const name of ["keychron_audit.csv", "keychron_recommendation.md", "keychron-winner.png"]) {
        if (!snapshot.artifacts.some((artifact) => artifact.name === name)) failures.push(`${name} was not captured`);
      }
      const csvArtifact = snapshot.artifacts.find((artifact) => artifact.name === "keychron_audit.csv");
      if (csvArtifact) {
        const stored = await store.getArtifact(csvArtifact.id, snapshot.id);
        const content = stored ? Buffer.from(stored.bytesBase64, "base64").toString("utf8").replace(/\r\n/g, "\n").trim() : "";
        const lines = content.split("\n").filter(Boolean);
        if (lines.length !== 4) failures.push(`expected exactly three CSV product rows, found ${Math.max(0, lines.length - 1)}`);
        if (lines[0] !== "product,price_usd,layout,connectivity,availability,url,checked_at_utc") failures.push("hard-shopping CSV header is incorrect");
        if ((content.match(/https:\/\//g) ?? []).length !== 3) failures.push("hard-shopping CSV does not contain exactly three HTTPS product URLs");
      }
      if (!snapshot.result?.verified) failures.push("hard-shopping structured result was not verified");
      if ((snapshot.result?.links.length ?? 0) < 3) failures.push("hard-shopping structured result has fewer than three source links");
      const winnerUrl = snapshot.result?.facts.find((fact) => {
        const label = fact.label.toLowerCase();
        return label === "winner" || label.includes("winner") || /rank\s*1\b/.test(label);
      })?.sourceUrl;
      const winnerArtifact = snapshot.artifacts.find((artifact) => artifact.name === "keychron-winner.png");
      const screenshotAction = snapshot.actions.find((action) => action.id === winnerArtifact?.actionId && action.toolName === "browser_screenshot");
      if (!winnerUrl || !samePage(winnerUrl, screenshotAction?.result?.actualUrl)) failures.push("winner screenshot was not captured from the structured result's winning product URL");
      return failures;
    },
  },
  {
    id: "terra-high-e2b-terminal-build",
    provider: "openai",
    modelId: "gpt-5.6-terra",
    reasoningEffort: "high",
    browserRuntime: "browserless",
    request: "Use at least two sandbox_run invocations to prove the agent has a persistent Kodo2-style E2B terminal, not a shell on the user's computer. Every invocation must use Python subprocess.run for real sandbox-local command execution; the terminal has unrestricted internet access although this task does not require it. In the first invocation: execute pwd, python --version, and git --version; create /workspace/decision_ranker.py plus an extensionless fixture file at /workspace/fixtures-data; make the CLI rank Alpha (price 40, wireless true, layout 65, available true), Beta (price 60, wireless false, layout 100, available true), and Gamma (price 100, wireless true, layout 75, available false) with score max(0,40-price/4) + 25 if wireless + 20 if layout <=75 else 10 + 15 if available; execute that CLI as a subprocess; run at least five deterministic assertions; and write /workspace/out/terminal-ranking.csv and /workspace/out/terminal-build-report.json. In a later invocation, reuse the files already in /workspace, execute the existing CLI again plus sha256sum /workspace/decision_ranker.py through subprocess.run, compare the numeric scores as numbers so 90 and 90.0 are equivalent, verify the winner and all three rows, and write /workspace/out/terminal-verification.json. If verification fails, diagnose it and use another sandbox_run to repair the verifier while preserving the existing workspace; do not ask the user to authorize an ordinary sandbox retry. The verification JSON must contain cwd, winner, rowCount, testsPassed, rankerSha256, and commandExitCodes. Return a grounded structured result naming the winner and all three artifacts. Do not use browser tools or any external-write tool.",
    async validate(snapshot, store) {
      const failures = expectDone(snapshot);
      const runs = snapshot.actions.filter((action) => action.toolName === "sandbox_run" && action.status === "executed");
      if (runs.length < 2) failures.push(`expected at least two successful persistent terminal runs, found ${runs.length}`);
      if (runs.some((action) => !String(action.input.script ?? "").includes("subprocess"))) failures.push("each terminal run must invoke sandbox-local commands through Python subprocess");
      if (snapshot.actions.some((action) => action.risk === "write_external")) failures.push("terminal build proposed an external mutation");
      for (const name of ["terminal-ranking.csv", "terminal-build-report.json", "terminal-verification.json"]) {
        if (!snapshot.artifacts.some((artifact) => artifact.name === name)) failures.push(`${name} was not captured`);
      }
      const csvArtifact = [...snapshot.artifacts].reverse().find((artifact) => artifact.name === "terminal-ranking.csv");
      if (csvArtifact) {
        const stored = await store.getArtifact(csvArtifact.id, snapshot.id);
        const content = stored ? Buffer.from(stored.bytesBase64, "base64").toString("utf8").replace(/\r\n/g, "\n").trim() : "";
        const lines = content.split("\n").filter(Boolean);
        if (lines.length !== 4) failures.push(`terminal ranking CSV should contain three rows, found ${Math.max(0, lines.length - 1)}`);
        const header = (lines[0] ?? "").toLowerCase().split(",");
        if (!["name", "score"].every((column) => header.includes(column))) failures.push("terminal ranking CSV must contain name and score columns");
        const nameIndex = header.indexOf("name");
        const scoreIndex = header.indexOf("score");
        const firstRow = (lines[1] ?? "").split(",");
        if (firstRow[nameIndex] !== "Alpha" || Number(firstRow[scoreIndex]) !== 90) failures.push("terminal ranking did not deterministically place Alpha first with score 90");
      }
      const verificationArtifact = [...snapshot.artifacts].reverse().find((artifact) => artifact.name === "terminal-verification.json");
      if (verificationArtifact) {
        const stored = await store.getArtifact(verificationArtifact.id, snapshot.id);
        try {
          const parsed = stored ? JSON.parse(Buffer.from(stored.bytesBase64, "base64").toString("utf8")) as Record<string, unknown> : {};
          if (parsed.cwd !== "/workspace") failures.push(`terminal cwd was ${String(parsed.cwd)} instead of /workspace`);
          if (parsed.winner !== "Alpha") failures.push(`terminal verification winner was ${String(parsed.winner)} instead of Alpha`);
          if (parsed.rowCount !== 3) failures.push(`terminal verification rowCount was ${String(parsed.rowCount)} instead of 3`);
          if (!(parsed.testsPassed === true || (typeof parsed.testsPassed === "number" && parsed.testsPassed >= 3))) failures.push("terminal verification did not confirm deterministic tests passed");
          if (!/^[a-f0-9]{64}$/i.test(String(parsed.rankerSha256 ?? ""))) failures.push("terminal verification omitted a valid ranker SHA-256");
          const exitCodes = Array.isArray(parsed.commandExitCodes) ? parsed.commandExitCodes : parsed.commandExitCodes && typeof parsed.commandExitCodes === "object" ? Object.values(parsed.commandExitCodes) : [];
          if (exitCodes.length < 2 || exitCodes.some((code) => code !== 0)) failures.push("one or more terminal verification commands failed");
        } catch {
          failures.push("terminal-verification.json was not valid JSON");
        }
      }
      if (!snapshot.result?.verified) failures.push("terminal build structured result was not verified");
      return failures;
    },
  },
  {
    id: "terra-high-public-web-terminal-crawl",
    provider: "openai",
    modelId: "gpt-5.6-terra",
    reasoningEffort: "high",
    browserRuntime: "browserless",
    request: "Use exactly one sandbox_run and Python standard-library networking. In that cloud terminal script, fetch https://example.com/ and https://www.iana.org/help/example-domains with a normal browser User-Agent, record each final URL, HTTP status, HTML title, and whether non-empty page text was extracted, and verify both responses succeeded. Write /workspace/out/public_web_terminal_proof.json containing networkMode='unrestricted', allPassed=true, and exactly two source records. Do not use browser_*, api_fetch, authenticated tools, credentials, or external-write tools. Return a grounded structured result and the JSON artifact.",
    async validate(snapshot, store) {
      const failures = expectDone(snapshot);
      const runs = snapshot.actions.filter((action) => action.toolName === "sandbox_run" && action.status === "executed");
      if (runs.length !== 1) failures.push(`expected exactly one successful public-web terminal run, found ${runs.length}`);
      if (snapshot.actions.some((action) => action.toolName.startsWith("browser_") || action.toolName === "api_fetch" || action.risk === "write_external")) failures.push("public-web terminal proof used an unauthorized alternate network or mutation tool");
      const artifact = [...snapshot.artifacts].reverse().find((item) => item.name === "public_web_terminal_proof.json");
      if (!artifact) failures.push("public_web_terminal_proof.json was not captured");
      if (artifact) {
        const stored = await store.getArtifact(artifact.id, snapshot.id);
        try {
          const parsed = stored ? JSON.parse(Buffer.from(stored.bytesBase64, "base64").toString("utf8")) as Record<string, unknown> : {};
          const sources = Array.isArray(parsed.sources) ? parsed.sources as Array<Record<string, unknown>> : [];
          if (parsed.networkMode !== "unrestricted" || parsed.allPassed !== true) failures.push("public-web proof did not mark unrestricted network mode and success");
          if (sources.length !== 2) failures.push(`public-web proof contained ${sources.length} sources instead of 2`);
          const hosts = new Set(sources.flatMap((source) => typeof source.finalUrl === "string" ? [new URL(source.finalUrl).hostname] : []));
          if (!hosts.has("example.com") || !hosts.has("www.iana.org")) failures.push("public-web proof did not reach both requested public domains");
          if (sources.some((source) => {
            const status = Number(source.status ?? source.httpStatus);
            const title = source.title ?? source.htmlTitle;
            const hasText = source.hasText ?? source.hasNonEmptyPageText ?? source.nonEmptyPageTextExtracted;
            return status < 200 || status >= 400 || typeof title !== "string" || !title || hasText !== true;
          })) failures.push("one or more public-web source records was not successfully extracted");
        } catch {
          failures.push("public_web_terminal_proof.json was not valid verification JSON");
        }
      }
      if (!snapshot.result?.verified) failures.push("public-web terminal structured result was not verified");
      return failures;
    },
  },
  {
    id: "terra-high-ultra-browser-terminal-audit",
    provider: "openai",
    modelId: "gpt-5.6-terra",
    reasoningEffort: "high",
    browserRuntime: "browserless",
    request: "Perform an ultra-hard, evidence-grounded browser-plus-terminal audit using the real Decision Feed harness. In the Browserless cloud browser, open https://www.keychron.com/collections/low-profile-keyboard-collection, discover exactly four currently displayed keyboards priced at or below $180 USD, and open each direct HTTPS product page. From each live DOM verify the exact displayed name, displayed price, numeric layout percentage, wired-or-wireless connectivity evidence, and a visible availability or purchase-control label. If a candidate page does not expose a numeric layout percentage, discard it and inspect another eligible product. Then use at least two sandbox_run invocations with unrestricted internet access. The first must use Python subprocess.run to execute sandbox-local commands, create a reusable /workspace/build_audit.py plus an extensionless evidence file, execute the program as a command, store all four rows in /workspace/keychron_terminal_audit.sqlite, and create /workspace/out/keychron_terminal_audit.csv plus /workspace/out/keychron_terminal_ranking.md. Score each row deterministically as max(0,50-price_usd/5) + 20 for wireless evidence + 10 for a layout at or below 75 percent otherwise 5 + 20 only when the product is visibly purchasable; Sold out, Notify Me, or another unavailable-only control gets 0. A later invocation must reuse the persisted program and SQLite database, use subprocess.run to execute a verifier command and sha256sum, query exactly four database rows, independently confirm the top-scoring URL, and write /workspace/out/keychron_terminal_verification.json containing rowCount, winner, winnerUrl, databaseSha256, testsPassed, and commandExitCodes. If a reversible sandbox verification fails, diagnose and repair it in another invocation without asking the user for permission. Finally call browser_open on that verified winnerUrl even if it is already current, verify the returned URL, and capture exactly that page as keychron-terminal-winner.png. Do not use api_fetch, purchase, submit, log in, or perform an external write. Return a grounded structured result with all four direct URLs and all requested artifacts.",
    async validate(snapshot, store) {
      const failures = expectDone(snapshot);
      const opens = snapshot.actions.filter((action) => action.toolName === "browser_open" && action.status === "executed");
      if (opens.length < 6) failures.push(`expected collection, four products, and winner reopen; found ${opens.length} browser opens`);
      const runs = snapshot.actions.filter((action) => action.toolName === "sandbox_run" && action.status === "executed");
      if (runs.length < 2) failures.push(`expected at least two successful persistent terminal runs, found ${runs.length}`);
      if (runs.some((action) => !String(action.input.script ?? "").includes("subprocess"))) failures.push("each terminal run must execute sandbox-local commands through Python subprocess");
      if (snapshot.actions.some((action) => action.risk === "write_external")) failures.push("ultra audit proposed an external mutation");
      for (const name of ["keychron_terminal_audit.csv", "keychron_terminal_ranking.md", "keychron_terminal_verification.json", "keychron-terminal-winner.png"]) {
        if (!snapshot.artifacts.some((artifact) => artifact.name === name)) failures.push(`${name} was not captured`);
      }
      const csvArtifact = [...snapshot.artifacts].reverse().find((artifact) => artifact.name === "keychron_terminal_audit.csv");
      if (csvArtifact) {
        const stored = await store.getArtifact(csvArtifact.id, snapshot.id);
        const content = stored ? Buffer.from(stored.bytesBase64, "base64").toString("utf8").replace(/\r\n/g, "\n").trim() : "";
        const lines = content.split("\n").filter(Boolean);
        if (lines.length !== 5) failures.push(`expected exactly four terminal-audit rows, found ${Math.max(0, lines.length - 1)}`);
        const header = parseCsvLine(lines[0] ?? "");
        const urlIndex = header.indexOf("url");
        const layoutIndex = ["layout_pct", "layout_percent", "layout_percentage"].map((name) => header.indexOf(name)).find((index) => index >= 0) ?? -1;
        const priceIndex = header.indexOf("price_usd");
        const availabilityIndex = ["availability", "availability_label", "purchase_label", "purchase_control_label"].map((name) => header.indexOf(name)).find((index) => index >= 0) ?? -1;
        const scoreIndex = header.indexOf("score");
        const rows = lines.slice(1).map(parseCsvLine);
        const productUrls = rows.map((row) => row[urlIndex] ?? "");
        if (urlIndex < 0 || new Set(productUrls).size !== 4 || productUrls.some((url) => !url.startsWith("https://www.keychron.com/products/"))) failures.push("terminal audit CSV does not contain four distinct direct HTTPS product URLs");
        const layouts = rows.map((row) => Number(row[layoutIndex]));
        if (layoutIndex < 0 || layouts.some((layout) => !Number.isFinite(layout) || layout <= 0 || layout > 100)) failures.push("terminal audit CSV contains a missing or invalid numeric layout percentage");
        if ([priceIndex, availabilityIndex, scoreIndex].some((index) => index < 0)) failures.push("terminal audit CSV is missing price, availability, or score evidence");
        else {
          for (const row of rows) {
            const price = Number(row[priceIndex]);
            const layout = Number(row[layoutIndex]);
            const availability = row[availabilityIndex] ?? "";
            const visiblePurchase = !/sold out|notify me|unavailable/i.test(availability);
            const expectedScore = Math.max(0, 50 - price / 5) + 20 + (layout <= 75 ? 10 : 5) + (visiblePurchase ? 20 : 0);
            if (!Number.isFinite(price) || Math.abs(Number(row[scoreIndex]) - expectedScore) > 0.01) failures.push(`terminal audit score is not independently reproducible for ${row[0] ?? "a product"}`);
          }
        }
      }
      let verifiedWinnerUrl: string | null = null;
      const verificationArtifact = [...snapshot.artifacts].reverse().find((artifact) => artifact.name === "keychron_terminal_verification.json");
      if (verificationArtifact) {
        const stored = await store.getArtifact(verificationArtifact.id, snapshot.id);
        try {
          const parsed = stored ? JSON.parse(Buffer.from(stored.bytesBase64, "base64").toString("utf8")) as Record<string, unknown> : {};
          if (parsed.rowCount !== 4) failures.push(`terminal database verification found ${String(parsed.rowCount)} rows instead of 4`);
          if (!(parsed.testsPassed === true || (typeof parsed.testsPassed === "number" && parsed.testsPassed >= 3) || (Array.isArray(parsed.testsPassed) && parsed.testsPassed.length >= 3))) failures.push("terminal database verification did not pass");
          if (!/^[a-f0-9]{64}$/i.test(String(parsed.databaseSha256 ?? ""))) failures.push("terminal verification omitted a valid database SHA-256");
          const exitCodes = Array.isArray(parsed.commandExitCodes) ? parsed.commandExitCodes : parsed.commandExitCodes && typeof parsed.commandExitCodes === "object" ? Object.values(parsed.commandExitCodes) : [];
          if (exitCodes.length < 2 || exitCodes.some((code) => code !== 0)) failures.push("one or more ultra-audit terminal commands failed");
          verifiedWinnerUrl = typeof parsed.winnerUrl === "string" ? parsed.winnerUrl : null;
          if (!verifiedWinnerUrl?.startsWith("https://www.keychron.com/products/")) failures.push("terminal verification omitted a direct Keychron winner URL");
        } catch {
          failures.push("keychron_terminal_verification.json was not valid JSON");
        }
      }
      const winnerArtifact = [...snapshot.artifacts].reverse().find((artifact) => artifact.name === "keychron-terminal-winner.png");
      const screenshotAction = snapshot.actions.find((action) => action.id === winnerArtifact?.actionId && action.toolName === "browser_screenshot");
      if (!verifiedWinnerUrl || !samePage(verifiedWinnerUrl, screenshotAction?.result?.actualUrl)) failures.push("terminal-verified winner screenshot came from the wrong page");
      if (!snapshot.result?.verified) failures.push("ultra audit structured result was not verified");
      if ((snapshot.result?.links.length ?? 0) < 4) failures.push("ultra audit structured result has fewer than four source links");
      return failures;
    },
  },
];

const requestedCase = process.argv.find((argument) => argument.startsWith("--case="))?.slice("--case=".length);
const compactOutput = process.argv.includes("--compact");
const selectedCases = requestedCase ? cases.filter((item) => item.id === requestedCase) : cases;
if (selectedCases.length === 0) throw new Error(`Unknown evaluation case: ${requestedCase}`);

const results = [];
for (const item of selectedCases) {
  const store = new MemoryRunStore();
  const run = await store.createRun({
    userId: "capability-eval",
    decisionId: null,
    category: "evaluation",
    request: item.request,
    title: item.id,
    metadata: { modelProvider: item.provider, modelId: item.modelId, reasoningEffort: item.reasoningEffort ?? "low", browserRuntime: item.browserRuntime ?? "browserless", evaluationCase: item.id },
  });
  const startedAt = Date.now();
  await runAgent({ runId: run.id, store, model: createAgentModel(store) });
  let snapshot = await store.getSnapshot(run.id);
  // Shopping now includes cart cleanup. Resume normal execution slices just as
  // the worker does; a time-slice yield is not a completed or failed task.
  if (item.id === "gpt-sol-cloud-browser-shopping-medium") {
    for (let slice = 1; snapshot?.status === "running" && slice < 3; slice++) {
      await runAgent({ runId: run.id, store, model: createAgentModel(store) });
      snapshot = await store.getSnapshot(run.id);
    }
  }
  if (!snapshot) throw new Error(`Evaluation run disappeared: ${item.id}`);
  const failures = await item.validate(snapshot, store);
  const artifactPreviews = [];
  for (const artifact of snapshot.artifacts) {
    const stored = await store.getArtifact(artifact.id, snapshot.id);
    if (!stored || (!artifact.mimeType.startsWith("text/") && artifact.mimeType !== "application/json")) continue;
    artifactPreviews.push({ name: artifact.name, content: Buffer.from(stored.bytesBase64, "base64").toString("utf8").slice(0, 4_000) });
  }
  results.push({
    case: item.id,
    passed: failures.length === 0,
    provider: item.provider,
    modelId: item.modelId,
    reasoningEffort: item.reasoningEffort ?? "low",
    browserRuntime: item.browserRuntime ?? "browserless",
    status: snapshot.status,
    durationMs: Date.now() - startedAt,

    actions: snapshot.actions.map((action) => ({ id: action.id, stepId: action.stepId, tool: action.toolName, risk: action.risk, status: action.status, preview: action.preview, input: action.input, result: action.result })),
    artifacts: snapshot.artifacts.map((artifact) => ({ id: artifact.id, actionId: artifact.actionId, name: artifact.name, mimeType: artifact.mimeType })),
    result: snapshot.result,
    artifactPreviews,
    response: snapshot.response.replace(/\s+/g, " ").trim().slice(0, 1000),
    failures,
  });
}

await closeCloudBrowser("capability-eval");
const reportedResults = compactOutput ? results.map((result) => ({
  case: result.case,
  passed: result.passed,
  provider: result.provider,
  modelId: result.modelId,
  reasoningEffort: result.reasoningEffort,
  browserRuntime: result.browserRuntime,
  status: result.status,
  durationMs: result.durationMs,

  actions: result.actions.map((action) => ({ id: action.id, stepId: action.stepId, tool: action.tool, risk: action.risk, status: action.status, preview: action.preview })),
  artifacts: result.artifacts,
  result: result.result,
  artifactPreviews: result.artifactPreviews,
  response: result.response,
  failures: result.failures,
})) : results;
console.log(JSON.stringify({ passed: results.every((result) => result.passed), results: reportedResults }, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;
