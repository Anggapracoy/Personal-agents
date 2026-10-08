import { installationNamespace } from "../../installation-identity";
import { keepControllerAlive } from "./controller-lease";
import { CHARACTERS, characterIndexFor } from "../../conversation-character";
import { BrowserPreDispatchError } from "./approval";
import type { BrowserTarget } from "./policy";
import { assertExecutionOwnership } from "../execution-lock";
import { createHash, randomUUID } from "node:crypto";
import { Sandbox as ControllerSandbox } from "e2b";
import { CLOUD_BROWSER_CONTROLLER } from "./cloud-controller";
import { viewerHealth, type ViewerHealth } from "./viewer-health";
import type { ImportedChromeCookie } from "../../browser/chrome-profile-import";

const MAX_IDLE_MS = 30 * 60_000;
const ROOT = "/home/user/.decision-feed";
const PRIVATE_NETWORKS = [
  "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
  "172.16.0.0/12", "192.0.0.0/24", "192.168.0.0/16",
];

type DomElement = { ancestorRefs?: string[]; ref: string; tag: string; role: string; name: string; href: string; type: string; value?: string; valueRedacted?: boolean; options?: Array<{ value: string; label: string; selected: boolean }>; disabled: boolean; readOnly?: boolean; settable?: boolean; checked: boolean | "mixed" | null; required?: boolean; valid?: boolean | null; validationMessage?: string; ariaInvalid?: boolean };
export type BrowserOutcomeObservation = {
  state: "settled" | "failed" | "unknown";
  reason: string;
  elapsedMs: number;
  navigationObserved: boolean;
  pageChanged: boolean;
  preexistingValidationErrorCount: number;
  freshValidationErrors: Array<{ field: string; message: string }>;
  mutationRequests: Array<{ method: string; url: string; status: number | null; finished: boolean; failed: boolean }>;
};
export type BrowserAXNode = {
  id: string; parentId: string | null; ref?: string; role: string; name: string;
  focused?: boolean; disabled?: boolean; readonly?: boolean; required?: boolean;
  expanded?: boolean; selected?: boolean; checked?: boolean | "mixed"; level?: number;
};
export type BrowserSnapshot = { documentId?: string; scopeRef?: string; focusedRef?: string; axTree?: BrowserAXNode[]; warnings?: string[]; title: string; url: string; text: string; elements: DomElement[]; activeModalCount: number; persistenceWarning?: string; outcomeObservation?: BrowserOutcomeObservation };
export type BrowserElementDescription = { name?: string; tag?: string; type?: string; href?: string; role?: string; disabled?: boolean; x?: number; y?: number; implicitSubmission?: boolean; formMethod?: string; formSubmitter?: BrowserElementDescription | null; isContentEditable?: boolean };
export type DeviceVaultRecipient = { token: string; algorithm: "RSA-OAEP-256+A256GCM"; publicKey: string; pageUrl?: string };
export type DeviceVaultEnvelope = { encryptedKey: string; sealed: string };
export type CloudBrowserAccountState = {
  sandbox: ControllerSandbox | null;
  sandboxId: string | null;
  userHash: string | null;
  initialization: Promise<void> | null;
};

export function createCloudBrowserAccountState(): CloudBrowserAccountState {
  return { sandbox: null, sandboxId: null, userHash: null, initialization: null };
}

function normalizedBrowserSnapshot(value: unknown): BrowserSnapshot {
  const snapshot = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const elements = Array.isArray(snapshot.elements) ? snapshot.elements.flatMap((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const element = value as Record<string, unknown>;
    const options = Array.isArray(element.options) ? element.options.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const option = value as Record<string, unknown>;
      return [{ value: typeof option.value === "string" ? option.value : "", label: typeof option.label === "string" ? option.label : "", selected: option.selected === true }];
    }) : undefined;
    return [{
      ref: typeof element.ref === "string" ? element.ref : `e${index + 1}`,
      ancestorRefs: Array.isArray(element.ancestorRefs) ? element.ancestorRefs.filter((ref): ref is string => typeof ref === "string") : [],
      tag: typeof element.tag === "string" ? element.tag : "element",
      role: typeof element.role === "string" ? element.role : "",
      name: typeof element.name === "string" ? element.name : "",
      href: typeof element.href === "string" ? element.href : "",
      type: typeof element.type === "string" ? element.type : "",
      ...(typeof element.value === "string" ? { value: element.value } : {}),
      ...(element.valueRedacted === true ? { valueRedacted: true } : {}),
      ...(options ? { options } : {}),
      disabled: element.disabled === true,
      readOnly: element.readOnly === true,
      ...(typeof element.settable === "boolean" ? { settable: element.settable } : {}),
      checked: element.checked === "mixed" ? "mixed" as const : typeof element.checked === "boolean" ? element.checked : null,
      required: element.required === true,
      valid: typeof element.valid === "boolean" ? element.valid : null,
      validationMessage: typeof element.validationMessage === "string" ? element.validationMessage : "",
      ariaInvalid: element.ariaInvalid === true,
    }];
  }) : [];
  const axTree: BrowserAXNode[] | undefined = Array.isArray(snapshot.axTree) ? snapshot.axTree.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !/^(?:e\d+|n\d+_[\w-]+)$/.test(row.id)) return [];
    const node: BrowserAXNode = { id: row.id, parentId: typeof row.parentId === "string" ? row.parentId : null, role: typeof row.role === "string" ? row.role : "generic", name: typeof row.name === "string" ? row.name : "" };
    if (typeof row.ref === "string" && /^e\d+$/.test(row.ref)) node.ref = row.ref;
    for (const property of ["focused", "disabled", "readonly", "required", "expanded", "selected"] as const) {
      if (typeof row[property] === "boolean") node[property] = row[property];
    }
    if (typeof row.checked === "boolean" || row.checked === "mixed") node.checked = row.checked;
    if (typeof row.level === "number" && Number.isFinite(row.level)) node.level = row.level;
    return [node];
  }) : undefined;
  const rawOutcome = snapshot.outcomeObservation && typeof snapshot.outcomeObservation === "object" && !Array.isArray(snapshot.outcomeObservation)
    ? snapshot.outcomeObservation as Record<string, unknown>
    : null;
  const outcomeState = rawOutcome?.state === "settled" || rawOutcome?.state === "failed" || rawOutcome?.state === "unknown" ? rawOutcome.state : null;
  const freshValidationErrors = Array.isArray(rawOutcome?.freshValidationErrors) ? rawOutcome.freshValidationErrors.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const error = value as Record<string, unknown>;
    return [{ field: typeof error.field === "string" ? error.field : "field", message: typeof error.message === "string" ? error.message : "Invalid value" }];
  }).slice(0, 10) : [];
  const mutationRequests = Array.isArray(rawOutcome?.mutationRequests) ? rawOutcome.mutationRequests.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const request = value as Record<string, unknown>;
    if (typeof request.method !== "string" || typeof request.url !== "string") return [];
    return [{ method: request.method, url: request.url, status: typeof request.status === "number" && Number.isFinite(request.status) ? Math.trunc(request.status) : null, finished: request.finished === true, failed: request.failed === true }];
  }).slice(0, 20) : [];
  return {
    title: typeof snapshot.title === "string" ? snapshot.title : "",
    url: typeof snapshot.url === "string" ? snapshot.url : "about:blank",
    text: typeof snapshot.text === "string" ? snapshot.text : "",
    elements,
    ...(axTree ? { axTree } : {}),
    ...(typeof snapshot.documentId === "string" ? { documentId: snapshot.documentId } : {}),
    ...(typeof snapshot.scopeRef === "string" ? { scopeRef: snapshot.scopeRef } : {}),
    ...(typeof snapshot.focusedRef === "string" ? { focusedRef: snapshot.focusedRef } : {}),
    ...(Array.isArray(snapshot.warnings) ? { warnings: snapshot.warnings.filter((warning): warning is string => typeof warning === "string") } : {}),
    ...(typeof snapshot.persistenceWarning === "string" ? { persistenceWarning: snapshot.persistenceWarning } : {}),
    activeModalCount: typeof snapshot.activeModalCount === "number" && Number.isFinite(snapshot.activeModalCount) ? Math.max(0, Math.trunc(snapshot.activeModalCount)) : 0,
    ...(rawOutcome && outcomeState ? { outcomeObservation: {
      state: outcomeState,
      reason: typeof rawOutcome.reason === "string" ? rawOutcome.reason : "unspecified",
      elapsedMs: typeof rawOutcome.elapsedMs === "number" && Number.isFinite(rawOutcome.elapsedMs) ? Math.max(0, Math.trunc(rawOutcome.elapsedMs)) : 0,
      navigationObserved: rawOutcome.navigationObserved === true,
      pageChanged: rawOutcome.pageChanged === true,
      preexistingValidationErrorCount: typeof rawOutcome.preexistingValidationErrorCount === "number" && Number.isFinite(rawOutcome.preexistingValidationErrorCount) ? Math.max(0, Math.trunc(rawOutcome.preexistingValidationErrorCount)) : 0,
      freshValidationErrors,
      mutationRequests,
    } } : {}),
  };
}

/** Large signed/tracking URLs can outweigh the entire accessibility tree.
 * Keep exact destinations in the structured snapshot and policy checks; the
 * agent can retrieve one through the existing grounded locator when needed. */
export function formatSnapshotLink(href: string, ref: string) {
  if (!href) return "";
  if (href.length <= 240) return `, URL: ${href}`;
  try {
    const url = new URL(href);
    if (!["http:", "https:"].includes(url.protocol)) return `, URL: ${href}`;
    const identity = createHash("sha256").update(href).digest("hex").slice(0, 12);
    return `, Link destination: ${url.origin} [${identity}; long URL; read exact href with page.ref(${JSON.stringify(ref)}).getAttribute("href")]`;
  } catch { return `, URL: ${href}`; }
}

export function formatDomSnapshot(value: unknown) {
  const snapshot = normalizedBrowserSnapshot(value);
  const elements = new Map(snapshot.elements.map(element => [element.ref, element]));
  const nativeRows = snapshot.axTree ?? [];
  const nativeById = new Map(nativeRows.map(row => [row.id, row]));
  const omitted = new Set(nativeRows.filter(row => {
    if (row.ref) return false;
    if (row.role === "generic" && !row.name) return true;
    const parent = row.parentId ? nativeById.get(row.parentId) : undefined;
    return row.role === "StaticText" && parent && ["button", "link"].includes(parent.role) && row.name === parent.name;
  }).map(row => row.id));
  const rows: BrowserAXNode[] = nativeRows.filter(row => !omitted.has(row.id)).map(row => {
    let parentId = row.parentId;
    const seen = new Set<string>();
    while (parentId && omitted.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId); parentId = nativeById.get(parentId)?.parentId ?? null;
    }
    return { ...row, parentId };
  });
  // Old receipts and unavailable AX frames still expose their current controls.
  // Keep the fallback inside the same tree instead of producing a second list.
  if (!rows.length && snapshot.text) rows.push({ id: "n0_fallback", parentId: null, role: "text", name: snapshot.text });
  const represented = new Set(rows.flatMap(row => row.ref ? [row.ref] : []));
  for (const element of snapshot.elements) {
    if (!represented.has(element.ref)) {
      rows.push({ id: element.ref, ref: element.ref, parentId: element.ancestorRefs?.find(ref => represented.has(ref)) ?? null, role: element.role || element.tag, name: element.name });
      for (const [index, option] of (element.options ?? []).entries()) rows.push({ id: `n0_${element.ref}_option${index}`, parentId: element.ref, role: "option", name: option.label || option.value, selected: option.selected });
    }
    represented.add(element.ref);
  }
  const byId = new Map(rows.map(row => [row.id, row]));
  const displayRole = (role: string) => ({ RootWebArea: "AXWebArea", generic: "container", LabelText: "container", StaticText: "text", MenuListPopup: "menu" }[role] || role);
  const describeRow = (row: BrowserAXNode) => {
    const element = row.ref ? elements.get(row.ref) : undefined;
    const role = element ? element.role || element.tag : row.role;
    const name = element ? element.name : row.name;
    const disabled = element?.disabled || row.disabled;
    const readonly = element?.readOnly || row.readonly;
    const settable = !disabled && !readonly && (element?.settable ?? Boolean(element && ["textbox", "searchbox", "combobox", "spinbutton", "slider", "checkbox", "radio", "switch", "ColorWell"].includes(element.role)));
    const checked = row.checked ?? (element && (["checkbox", "radio"].includes(element.type) || ["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio"].includes(element.role)) ? element.checked : undefined);
    const states = [
      disabled ? "disabled" : "", readonly ? "readonly" : "", settable ? "settable" : "",
      row.expanded === true ? "expanded" : row.expanded === false ? "collapsed" : "",
      checked === "mixed" ? "checked=mixed" : checked === true ? "checked" : checked === false ? "unchecked" : "",
      row.selected ? "selected" : "", element?.required || row.required ? "required" : "",
      element?.valid === false || element?.ariaInvalid ? "invalid" : "",
    ].filter(Boolean);
    const label = name ? ` ${JSON.stringify(name)}` : "";
    const fieldValue = element?.valueRedacted ? ", Value: [redacted]" : element?.value !== undefined && element.value !== "" ? `, Value: ${JSON.stringify(element.value)}` : "";
    const level = row.level !== undefined ? `, Level: ${row.level}` : "";
    const href = element?.href ? formatSnapshotLink(element.href, element.ref) : "";
    const validation = element?.valid === false && element.validationMessage ? `, Validation: ${JSON.stringify(element.validationMessage)}` : "";
    // Advertise executable tool operations, never an unimplemented AX action.
    const actions: string[] = [];
    if (!disabled && !readonly && element) {
      if (row.expanded === false) actions.push("Expand (locator.click)");
      if (row.expanded === true) actions.push(element.tag === "select" ? "Collapse (locator.press Escape)" : "Collapse (locator.click)");
      if (element.tag === "select") actions.push("Select (locator.selectOption)");
      if (["switch", "menuitemcheckbox", "menuitemradio"].includes(element.role) && checked !== undefined && checked !== null) actions.push("Check (locator.setChecked)");
    }
    const secondary = actions.length ? `, Secondary Actions: ${actions.join(", ")}` : "";
    return `${row.id.replace(/^n0_(\d+)$/, "n$1")} ${displayRole(role)}${states.length ? ` (${states.join(", ")})` : ""}${label}${fieldValue}${level}${href}${validation}${secondary}`;
  };
  const lines = rows.map(row => {
    const seen = new Set([row.id]);
    const ancestorRefs = new Set<string>();
    let parent = row.parentId ? byId.get(row.parentId) : undefined;
    let depth = 0;
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      if (parent.ref) ancestorRefs.add(parent.ref);
      depth++;
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    // aria-owns can make AX and DOM ancestry differ. Preserve any additional
    // valid DOM scopes so the within locator does not lose that information.
    const extraScopes = row.ref ? elements.get(row.ref)?.ancestorRefs?.filter(ref => !ancestorRefs.has(ref)) : [];
    return `${"  ".repeat(depth)}${describeRow(row)}${extraScopes?.length ? `, Scope: ${extraScopes.join(",")}` : ""}`;
  });
  const focused = snapshot.focusedRef ? rows.find(row => row.ref === snapshot.focusedRef) : [...rows].reverse().find(row => row.focused);
  const focus = focused ? describeRow(focused) : snapshot.focusedRef ? `${snapshot.focusedRef} (outside inspected scope)` : "unknown";
  const outcome = snapshot.outcomeObservation;
  const outcomeText = outcome ? `\n\nPost-click observation:\nState: ${outcome.state}\nReason: ${outcome.reason}\nNavigation observed: ${outcome.navigationObserved}\nPage changed: ${outcome.pageChanged}\nFresh validation errors: ${outcome.freshValidationErrors.length ? outcome.freshValidationErrors.map((error) => `${error.field}: ${error.message}`).join("; ") : "none"}\nMutation responses: ${outcome.mutationRequests.length ? outcome.mutationRequests.map((request) => `${request.method} ${request.url} -> ${request.failed ? "network failure" : request.status ?? "pending"}`).join("; ") : "none observed"}` : "";
  const warnings = snapshot.warnings?.length ? `\n\n${snapshot.warnings.join("\n")}` : "";
  return `Browser: ${JSON.stringify(snapshot.title || "Untitled")}, URL: ${snapshot.url}${snapshot.scopeRef ? `\nScope: ${snapshot.scopeRef}` : ""}\n\n${lines.join("\n") || "(no exposed accessibility nodes)"}\n\nThe focused UI element is ${focus}${elements.size ? "" : "\nNo actionable controls exposed."}${outcomeText}${warnings}${snapshot.persistenceWarning ? `\n\n${snapshot.persistenceWarning}` : ""}`;
}

function safeBrowserUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("The cloud browser only opens HTTP or HTTPS pages");
  const host = url.hostname.toLowerCase();
  if (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host) || host === "::1" || host.endsWith(".local") || /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(host)) throw new Error("Private network targets are blocked");
  return url.toString();
}

function parseControllerResult<T>(stdout: string): T {
  const line = stdout.trim().split("\n").reverse().find((candidate) => candidate.startsWith("{"));
  if (!line) throw new Error("The cloud browser controller returned no result");
  const result = JSON.parse(line) as { ok: boolean; value?: T; error?: string; inputDispatched?: boolean };
  if (!result.ok || result.value === undefined) throw (result.inputDispatched === false ? new BrowserPreDispatchError(result.error || "Browser input was not dispatched") : new Error(result.error || "The cloud browser controller failed"));
  return result.value;
}

export function isBrowserTimeoutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:CDP command .*timed out|socket.*timed out|^timed out$|command.*timed out)/i.test(message);
}

function isUnavailableSandboxError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /sandbox[^\n]*(?:not found|is not running|was killed|no longer exists|expired)/i.test(message);
}

export class BrowserlessCloudBrowserProvider {
  private latestSnapshot: BrowserSnapshot | null = null;
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly controllerPath: string;
  private providerInitialization: { sandboxId: string; promise: Promise<void> } | null = null;
  private attachedSandboxId: string | null = null;
  private lastTabCleanupAt = 0;
  private hasBrowserActivity = false;
  private cursorColor: Promise<string> | null = null;

  private conversationCursorColor() {
    return this.cursorColor ??= (async () => {
      if (this.targetKey === "shared") return "#111111";
      try {
        const { getRunStore } = await import("../store");
        const run = await getRunStore().getRun(this.targetKey);
        if (!run || run.userId !== this.userId) return "#111111";
        const key = run.decisionId ? `decision:${run.decisionId}` : `run:${run.id}`;
        return CHARACTERS[characterIndexFor(key)].color;
      } catch { return "#111111"; }
    })();
  }

  constructor(private readonly targetKey = "shared", private readonly account = createCloudBrowserAccountState(), private readonly userId?: string, private readonly inactiveTargetKeys?: () => Promise<string[]>) {
    if (!targetKey.trim() || targetKey.length > 256) throw new Error("Invalid cloud browser target key");
    // Every serverless provider gets private script paths. Multiple workers can
    // initialize the same account sandbox at once, and writing one shared
    // controller file allowed one worker to execute it while another was still
    // replacing it.
    const instanceId = randomUUID();
    this.controllerPath = `${ROOT}/controller-${instanceId}.py`;
  }

  async setWaitingForUser(waiting: boolean, reconnectExisting = false) {
    if (!this.hasBrowserActivity && !reconnectExisting) return;
    try {
      await this.run("user_wait", { waiting });
    } catch {
      // An expired or absent browser must not prevent pausing/resuming the task.
      // user_wait is never allowed to launch a paid replacement browser.
      console.warn("[cloud-browser] user wait lease unavailable", { targetKey: this.targetKey, waiting });
    }
  }

  async warm(userId: string, prepareController = false) {
    await this.ensureAccount(userId);
    if (prepareController) await this.ensureProviderAttached();
  }

  async open(userId: string, url: string) {
    await this.ensureAccount(userId);
    return this.navigate(url);
  }

  async navigate(url: string) {
    return this.snapshotOperation("navigate", { url: safeBrowserUrl(url) });
  }

  async extended(payload: Record<string, unknown>) { return this.run<Record<string, unknown>>("extended", payload); }

  async snapshot() { return this.snapshotOperation("snapshot", {}); }

  async inspect(ref: string) { return this.snapshotOperation("inspect", { ref }); }
  async waitFor(target: BrowserTarget, state: "visible" | "hidden" | "enabled", timeoutMs = 10_000) {
    return this.snapshotOperation("wait_for", { target, state, timeoutMs: Math.min(20_000, Math.max(100, timeoutMs)) });
  }
  async hover(ref: string) { return this.snapshotOperation("hover", { ref }); }
  async typePageText(text: string) {
    return this.snapshotOperation("keyboard_type", { text });
  }

  async typePageTextWithoutObservation(text: string) {
    this.latestSnapshot = null;
    return this.run<{ observationDeferred: true }>("keyboard_type", { text, deferObservation: true });
  }

  async pressPageKey(key: string) { return this.snapshotOperation("keyboard_press", { key }); }

  async press(ref: string, key: string, options: Parameters<BrowserlessCloudBrowserProvider["click"]>[1] = {}) {
    return this.snapshotOperation("press", { ref, key, ...options });
  }


  async describeRef(ref: string) {
    if (!/^e\d{1,8}$/.test(ref)) throw new Error("Invalid browser element reference");
    return this.run<BrowserElementDescription>("describe", { ref });
  }

  async preflightRef(ref: string, fullPage = true) {
    if (!/^e\d{1,8}$/.test(ref)) throw new Error("Invalid browser element reference");
    try {
      const result = await this.run<{ page: unknown; element: BrowserElementDescription }>("preflight_ref", { ref, ...(fullPage ? {} : { fullPage: false }) });
      const page = normalizedBrowserSnapshot(result.page);
      if (!page.elements.some(element => element.ref === ref)) throw new Error("Stale browser reference. Inspect the current page before acting.");
      this.latestSnapshot = page;
      return { page: { ...page, formatted: formatDomSnapshot(page) }, element: result.element };
    } catch (error) {
      this.latestSnapshot = null;
      throw error;
    }
  }

  async preflightLocator(locator: Record<string, unknown>, fullPage: boolean) {
    try {
      const result = await this.run<{ matches: Array<{ ref: string; name?: string; role?: string; visible?: boolean; enabled?: boolean; containers?: Array<{role:string;name:string;ref:string|null}>; frameId?: string; mainFrame?: boolean }>; locatorAmbiguous?: boolean; matchCount?: number; page?: unknown; element?: BrowserElementDescription }>("preflight_locator", { locator, fullPage });
      if (result.locatorAmbiguous) { this.latestSnapshot = null; return { matches: result.matches, locatorAmbiguous: true, matchCount: result.matchCount }; }
      if (!result.matches.length) { this.latestSnapshot = null; return { matches: result.matches }; }
      const ref = result.matches[0].ref;
      const page = normalizedBrowserSnapshot(result.page);
      if (result.matches.length !== 1 || !result.element || !page.elements.some(element => element.ref === ref)) throw new Error("Stale browser reference. Inspect the current page before acting.");
      this.latestSnapshot = page;
      return { matches: result.matches, ref, page: { ...page, formatted: formatDomSnapshot(page) }, element: result.element };
    } catch (error) {
      this.latestSnapshot = null;
      throw error;
    }
  }

  async click(ref: string, options: { button?: "left" | "right" | "middle"; clickCount?: number; holdMs?: number; modifiers?: string[]; observeOutcome?: boolean; expectedUrl?: string; expectedTarget?: Pick<BrowserElementDescription, "name" | "tag" | "type" | "href">; expectedKeySubmission?: { implicitSubmission: boolean; formMethod: string | null; formSubmitter: BrowserElementDescription | null; isContentEditable: boolean } } = {}) {
    if (!/^e\d{1,8}$/.test(ref)) throw new Error("Invalid browser element reference");
    return this.snapshotOperation("click", { ref, ...options, observeOutcome: options.observeOutcome === true });
  }

  async type(ref: string, text: string, append = false) {
    if (!/^e\d{1,8}$/.test(ref)) throw new Error("Invalid browser element reference");
    return this.snapshotOperation("type", { ref, text, append });
  }

  async clickWithoutObservation(ref: string, options: Parameters<BrowserlessCloudBrowserProvider["click"]>[1] = {}) {
    if (!/^e\d{1,8}$/.test(ref)) throw new Error("Invalid browser element reference");
    if (options.observeOutcome) throw new Error("Consequential input requires its outcome observation");
    this.latestSnapshot = null;
    return this.run<{ observationDeferred: true }>("click", { ref, ...options, deferObservation: true, observeOutcome: false });
  }

  async waitWithoutObservation(milliseconds: number) {
    this.latestSnapshot = null;
    return this.run<{ observationDeferred: true }>("wait", { milliseconds: Math.min(10_000, Math.max(100, milliseconds)), deferObservation: true });
  }

  async typeWithoutObservation(ref: string, text: string) {
    if (!/^e\d{1,8}$/.test(ref)) throw new Error("Invalid browser element reference");
    // Deferred observations never leave stale controls available as current state.
    this.latestSnapshot = null;
    return this.run<{ observationDeferred: true }>("type", { ref, text, deferObservation: true });
  }

  async secureType(ref: string, text: string) {
    if (!/^e\d{1,8}$/.test(ref)) throw new Error("Invalid browser element reference");
    return this.snapshotOperation("secure_type", { ref, text });
  }

  async createDeviceVaultRecipient(token: string, expectedOrigin?: string) {
    if (!/^[a-f0-9]{32}$/.test(token)) throw new Error("Invalid device vault recipient token");
    if (expectedOrigin && (new URL(expectedOrigin).protocol !== "https:" || new URL(expectedOrigin).origin !== expectedOrigin)) throw new Error("Invalid secure website origin");
    return this.run<DeviceVaultRecipient>("secret_recipient", { token, ...(expectedOrigin ? { expectedOrigin } : {}) });
  }

  async assertSecureTarget(ref: string) {
    if (!/^e\d{1,8}$/.test(ref)) throw new Error("Invalid secure typing target");
    return this.run<{ ref: string; focused: true }>("secure_target", { ref });
  }

  async secureFillEnvelope(input: {
    token: string;
    kind: "login" | "payment_card";
    envelope: DeviceVaultEnvelope;
    fields: Array<{ name: string; ref: string; fourDigitYear?: boolean }>;
    expectedUrl: string;
    retainForSecureTyping?: boolean;
  }) {
    if (!/^[a-f0-9]{32}$/.test(input.token)) throw new Error("Invalid device vault recipient token");
    if (!input.fields.every((field) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(field.name) && /^e\d{1,8}$/.test(field.ref))) throw new Error("Invalid secure-fill field mapping");
    if (input.fields.length !== 1) throw new Error("Secure typing requires exactly one agent-selected field");
    const raw = await this.run<unknown>("secure_fill_envelope", input);
    const page = normalizedBrowserSnapshot(raw);
    this.latestSnapshot = page;
    const secureFieldsVerified = Boolean(raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).secureFieldsVerified === true);
    const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const secureFieldNames = Array.isArray(record.secureFieldNames)
      ? record.secureFieldNames.filter((value): value is string => typeof value === "string")
      : [];
    return { ...page, formatted: formatDomSnapshot(page), secureFieldsVerified, secureFieldNames };
  }

  async select(ref: string, value: string) {
    if (!/^e\d{1,8}$/.test(ref)) throw new Error("Invalid browser element reference");
    return this.snapshotOperation("select", { ref, value });
  }

  async setChecked(ref: string, checked: boolean) {
    if (!/^e\d{1,8}$/.test(ref)) throw new Error("Invalid browser element reference");
    return this.snapshotOperation("check", { ref, checked });
  }

  async back() { return this.snapshotOperation("back", {}); }
  async wait(milliseconds: number) { return this.snapshotOperation("wait", { milliseconds: Math.min(10_000, Math.max(100, milliseconds)) }); }
  async scroll(deltaY: number, ref?: string, deltaX = 0) { return this.snapshotOperation("scroll", { deltaY: Math.trunc(deltaY), deltaX: Math.trunc(deltaX), ref }); }

  async screenshot(userId?: string) {
    if (userId) await this.ensureAccount(userId, false);
    // Return Chrome's existing PNG bytes through the command stream. A second
    // E2B file-download request added a separate, occasionally very slow hop.
    const image = await this.run<{ base64: string }>("screenshot", { inline: true });
    return Buffer.from(image.base64, "base64");
  }

  currentUrl() { return this.latestSnapshot?.url ?? "about:blank"; }

  async takeoverUrl(userId: string) {
    return this.streamUrl(userId, false);
  }

  async watchUrl(userId: string, refresh = false) {
    return this.streamUrl(userId, true, refresh);
  }

  async viewerHealth(userId: string, control: boolean): Promise<ViewerHealth> {
    // File reads only: do not attach CDP, extend the idle lease, or create a browser.
    await this.ensureAccount(userId, false);
    const sandbox = this.requireSandbox();
    const [state, transports] = await Promise.all([
      sandbox.files.read(`${ROOT}/browserless.json`),
      sandbox.files.read(`${ROOT}/cdp-health.json`),
    ]);
    return viewerHealth(JSON.parse(state), JSON.parse(transports), this.targetKey, control);
  }

  async maximize(userId: string) {
    await this.ensureAccount(userId, false);
    return this.snapshotOperation("maximize", {});
  }

  async importCookies(userId: string, cookies: ImportedChromeCookie[]) {
    if (cookies.length === 0 || cookies.length > 5_000) throw new Error("Chrome import must contain between 1 and 5,000 cookies");
    await this.ensureAccount(userId);
    return this.run<{ imported: number }>("import_cookies", { cookies });
  }

  private async streamUrl(userId: string, viewOnly: boolean, refresh = false) {
    await this.ensureAccount(userId, false);
    const result = await this.run<{ url: string }>("live_url", { control: !viewOnly, ...(refresh ? { refresh: true } : {}) });
    return result.url;
  }

  async endTakeoverStream(userId: string) {
    await this.ensureAccount(userId, false);
    await this.run("end_takeover", {});
  }

  async solveCaptcha() {
    const result = await this.run<{ found: boolean; solved: boolean; page: BrowserSnapshot }>("solve_captcha", {});
    const page = normalizedBrowserSnapshot(result.page);
    this.latestSnapshot = page;
    return { ...result, page: { ...page, formatted: formatDomSnapshot(page) } };
  }

  async destroy() {
    // Account deletion must also work after a server restart. List existing
    // controllers, never create a runtime or browser just to remove its data.
    await this.exclusive(async () => {
      const userHash = this.account.userHash ?? (this.userId ? createHash("sha256").update(this.userId.trim().toLowerCase()).digest("hex").slice(0, 24) : null);
      this.account.userHash = userHash;
      const sandboxes = new Map<string, ControllerSandbox>();
      if (this.account.sandbox) sandboxes.set(this.account.sandbox.sandboxId, this.account.sandbox);
      if (userHash && process.env.E2B_API_KEY) {
        const listing = ControllerSandbox.list({ apiKey: process.env.E2B_API_KEY, query: { metadata: { service: "dash-browser-controller", installation: installationNamespace(), user: userHash }, state: ["running", "paused"] } });
        while (listing.hasNext) {
          for (const item of await listing.nextItems()) {
            if (!sandboxes.has(item.sandboxId)) sandboxes.set(item.sandboxId, await ControllerSandbox.connect(item.sandboxId, { apiKey: process.env.E2B_API_KEY, timeoutMs: 60_000 }));
          }
        }
      }
      for (const sandbox of sandboxes.values()) {
        try {
          await sandbox.files.write(this.controllerPath, CLOUD_BROWSER_CONTROLLER);
          await this.runControllerCommand(sandbox, "close_browser", {});
        } finally {
          await sandbox.kill();
        }
      }
      if (userHash && process.env.BROWSERLESS_API_TOKEN) {
        const host = process.env.BROWSERLESS_HOST || "production-sfo.browserless.io";
        if (!["production-sfo.browserless.io", "production-lon.browserless.io", "production-ams.browserless.io"].includes(host)) throw new Error("Unsupported Browserless region");
        const url = new URL(`/profile/dash-${installationNamespace()}-${userHash}`, `https://${host}`);
        url.searchParams.set("token", process.env.BROWSERLESS_API_TOKEN);
        const response = await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(30_000) });
        if (!response.ok && response.status !== 404) throw new Error(`Browser profile deletion failed (HTTP ${response.status})`);
      }
      this.account.sandbox = null;
      this.account.sandboxId = null;
      this.account.initialization = null;
      this.providerInitialization = null;
      this.attachedSandboxId = null;
    });
  }

  private async snapshotOperation(operation: string, payload: Record<string, unknown>) {
    try {
      const page = normalizedBrowserSnapshot(await this.run<unknown>(operation, payload));
      this.latestSnapshot = page;
      return { ...page, formatted: formatDomSnapshot(page) };
    } catch (error) {
      // A failed navigation may have replaced the page with Chrome's error page.
      // Its previous URL and controls are no longer current evidence.
      this.latestSnapshot = null;
      throw error;
    }
  }

  private async run<T>(operation: string, payload: Record<string, unknown>) {
    this.hasBrowserActivity = true;
    return this.exclusive(async () => {
      const execute = async () => {
        if (this.userId && !this.account.initialization) await this.ensureAccount(this.userId, operation === "navigate" || operation === "import_cookies");
        await this.ensureProviderAttached();
        const sandbox = this.requireSandbox();
        await keepControllerAlive(sandbox, MAX_IDLE_MS);
        if (this.inactiveTargetKeys && Date.now() - this.lastTabCleanupAt > 60_000) {
          this.lastTabCleanupAt = Date.now();
          try {
            const targetKeys = (await this.inactiveTargetKeys()).filter(key => key !== this.targetKey);
            if (targetKeys.length) await this.runControllerCommand(sandbox, "prune_targets", { targetKeys });
          } catch (error) {
            console.warn("[cloud-browser] inactive tab cleanup deferred", { error: error instanceof Error ? error.message : String(error) });
          }
        }
        return this.runControllerCommand<T>(sandbox, operation, payload);
      };

      try {
        return await execute();
      } catch (error) {
        if (isBrowserTimeoutError(error) && operation !== "screenshot" && operation !== "user_wait" && this.account.sandbox) {
          this.latestSnapshot = null;
          // A command deadline does not establish that the tab is dead. Keep
          // progress in a responsive tab, without replaying the uncertain input.
          let responsive: boolean;
          try {
            const health = await this.runControllerCommand<{ responsive: boolean }>(this.account.sandbox, "target_health", {});
            responsive = health.responsive;
          } catch {
            // A failed transport/health check is not evidence that a new tab
            // will help. Preserve the original failure and existing target.
            throw error;
          }
          if (responsive) {
            throw new Error(`Browser ${operation} timed out, but the current tab is responsive and was preserved. The previous action's outcome is unknown; do not repeat a submission. Inspect the current page and verify the outcome before continuing. Original error: ${error instanceof Error ? error.message : String(error)}`);
          }
          // Preserve the old tab and its uncertain outcome. Never replay a click,
          // form submission, navigation, or secure fill after a timeout.
          const recovered = await this.runControllerCommand<{ recovered: boolean }>(this.account.sandbox, "recover_target", {});
          if (recovered.recovered) {
            this.attachedSandboxId = this.account.sandboxId;
            this.providerInitialization = null;
            throw new Error(`Browser ${operation} timed out. The unresponsive tab was preserved and a fresh blank tab was attached to the same signed-in browser. The previous action's outcome is unknown; do not repeat a submission. Inspect the new tab, verify any possible external change using independent confirmation, then navigate to a known safe page to continue. Original error: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        // E2B may reclaim a paused/idle controller while this long-lived provider
        // remains in the Next.js global registry. Recreate/reconnect once and
        // replay the same read/navigation operation instead of exposing a stale
        // sandbox handle to either the discovery or normal agent harness.
        if (!isUnavailableSandboxError(error) || !this.account.userHash) throw error;
        console.warn("[cloud-browser] sandbox unavailable; recreating", { operation });
        this.account.sandbox = null;
        this.account.sandboxId = null;
        this.latestSnapshot = null;
        this.providerInitialization = null;
        this.attachedSandboxId = null;
        this.account.initialization = this.initializeAccount(this.account.userHash, false).catch((initializationError) => {
          this.account.initialization = null;
          throw initializationError;
        });
        await this.account.initialization;
        await this.ensureProviderAttached();
        if (operation !== "snapshot") throw new Error(`Browser sandbox reconnected after ${operation} failed. The operation was not replayed. Inspect the current page and verify any possible external change before continuing; prior element references are stale.`);
        return execute();
      }
    });
  }

  private async ensureAccount(userId: string, allowCreate = true) {
    const hash = createHash("sha256").update(userId.trim().toLowerCase()).digest("hex").slice(0, 24);
    if (this.account.userHash && this.account.userHash !== hash) throw new Error("A cloud browser provider cannot be shared between accounts");
    this.account.userHash = hash;
    if (!this.account.initialization) this.account.initialization = this.initializeAccount(hash, allowCreate).catch((error) => { this.account.initialization = null; throw error; });
    await this.account.initialization;
  }

  private async initializeAccount(userHash: string, allowCreate = true) {
    if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY is not configured");
    if (!process.env.BROWSERLESS_API_TOKEN) throw new Error("BROWSERLESS_API_TOKEN is not configured");
    const listExisting = async () => {
      const list = ControllerSandbox.list({ apiKey: process.env.E2B_API_KEY, query: { metadata: { service: "dash-browser-controller", installation: installationNamespace(), user: userHash }, state: ["running", "paused"] }, limit: 10 });
      return (await list.nextItems()).sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime() || left.sandboxId.localeCompare(right.sandboxId));
    };
    const existing = (await listExisting()).at(0);
    if (existing) {
      this.account.sandbox = await ControllerSandbox.connect(existing.sandboxId, { apiKey: process.env.E2B_API_KEY, timeoutMs: MAX_IDLE_MS });
      this.account.sandboxId = existing.sandboxId;
    } else {
      if (!allowCreate) throw new Error("This account has no running browser controller. Open a known URL to start browsing.");
      const created = await ControllerSandbox.create({
        apiKey: process.env.E2B_API_KEY,
        timeoutMs: MAX_IDLE_MS,
        metadata: { service: "dash-browser-controller", installation: installationNamespace(), user: userHash },
        allowInternetAccess: true,
        network: { denyOut: PRIVATE_NETWORKS },
        lifecycle: { onTimeout: "pause", autoResume: true },
      });
      this.account.sandbox = created;
      this.account.sandboxId = created.sandboxId;
      // Separate serverless workers can both observe an empty account at the
      // same instant. Reconcile that first-start race to one deterministic
      // sandbox so their run-scoped tabs still share the signed-in profile.
      for (const delayMs of [250, 750]) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        const canonical = (await listExisting()).at(0);
        if (!canonical || canonical.sandboxId === created.sandboxId) continue;
        const connected = await ControllerSandbox.connect(canonical.sandboxId, { apiKey: process.env.E2B_API_KEY, timeoutMs: MAX_IDLE_MS });
        await created.kill().catch(() => undefined);
        this.account.sandbox = connected;
        this.account.sandboxId = canonical.sandboxId;
        break;
      }
    }
    const sandbox = this.requireSandbox();
    await sandbox.files.makeDir(ROOT).catch(() => undefined);
  }

  private async ensureProviderAttached() {
    const sandboxId = this.account.sandboxId;
    if (!sandboxId || !this.account.sandbox) throw new Error("The browser controller runtime has not been started");
    if (this.attachedSandboxId === sandboxId) return;
    if (!this.providerInitialization || this.providerInitialization.sandboxId !== sandboxId) {
      const promise = this.attachProvider(sandboxId).catch((error) => {
        if (this.providerInitialization?.sandboxId === sandboxId) this.providerInitialization = null;
        if (this.attachedSandboxId === sandboxId) this.attachedSandboxId = null;
        throw error;
      });
      this.providerInitialization = { sandboxId, promise };
    }
    await this.providerInitialization.promise;
  }

  private async attachProvider(sandboxId: string) {
    const sandbox = this.requireSandbox();
    if (this.account.sandboxId !== sandboxId) throw new Error("The cloud browser sandbox changed during provider attachment");
    await sandbox.files.write(this.controllerPath, CLOUD_BROWSER_CONTROLLER);
    this.attachedSandboxId = sandboxId;
  }

  private async runControllerCommand<T>(sandbox: ControllerSandbox, operation: string, payload: Record<string, unknown>) {
    await assertExecutionOwnership();
    const operationId = randomUUID();
    const requestPath = `${ROOT}/request-${operationId}.json`;
    const request = JSON.stringify({ operation, payload, targetKey: this.targetKey });
    // Ordinary small RPCs travel with the existing process launch, avoiding a
    // separate remote file write and delete. Large uploads and secure operations
    // retain their private-file transport. Never put request contents in shell args.
    const inlineRequest = Buffer.byteLength(request) <= 32_000 && !operation.startsWith("secure_");
    if (!inlineRequest) await sandbox.files.write(requestPath, request);
    try {
      await assertExecutionOwnership();
      const result = await sandbox.commands.run(`python3 ${this.controllerPath} ${requestPath}`, {
        timeoutMs: 90_000,
        envs: {
          ...(inlineRequest ? { DASH_BROWSER_REQUEST: request } : {}),
          DASH_CURSOR_COLOR: await this.conversationCursorColor(),
          BROWSERLESS_API_TOKEN: process.env.BROWSERLESS_API_TOKEN!,
          BROWSERLESS_HOST: process.env.BROWSERLESS_HOST || "production-sfo.browserless.io",
          BROWSERLESS_PROFILE: `dash-${installationNamespace()}-${this.account.userHash}`,
          BROWSERLESS_SESSION_TIMEOUT_MS: process.env.BROWSERLESS_SESSION_TIMEOUT_MS || "1800000",
          BROWSERLESS_PROXY_COUNTRY: process.env.BROWSERLESS_PROXY_COUNTRY || "ca",
        },
      });
      return parseControllerResult<T>(result.stdout);
    } catch (error) {
      // The controller deliberately emits a bounded JSON error before exiting
      // non-zero. Preserve that useful cause instead of reducing every browser
      // startup failure to the SDK's opaque "exit status 1" message.
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout ?? "") : "";
      if (stdout) return parseControllerResult<T>(stdout);
      throw error;
    } finally {
      if (!inlineRequest) await sandbox.files.remove(requestPath).catch(() => undefined);
    }
  }

  private requireSandbox() {
    if (!this.account.sandbox) throw new Error("The browser controller runtime has not been started");
    return this.account.sandbox;
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(operation, operation);
    this.operationQueue = run.then(() => undefined, () => undefined);
    return run;
  }
}
