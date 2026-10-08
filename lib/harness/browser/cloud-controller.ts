import { EXTENDED_BROWSER_CONTROLLER } from "./extended-controller";
import { BROWSERLESS_RUNTIME } from "./browserless-runtime";
import { PROFILE_WORKER } from "./profile-worker";
import { CDP_POOL } from "./cdp-pool";
import { HOSTED_FIELD_RECOVERY_EXPRESSION } from "./hosted-field-recovery";
import { CURSOR_FRAME_POINT, CURSOR_RESTORE_EXPRESSION, VISUAL_CURSOR_EXPRESSION } from "./visual-cursor";

// This script runs inside a private E2B controller runtime. It deliberately uses only Python's
// standard library so the cloud browser does not depend on packages installed
// at runtime. Agent-authored code never reaches this file.
export const CLOUD_BROWSER_CONTROLLER = String.raw`#!/usr/bin/env python3
import base64
import fcntl
import hashlib
import json
import os
import re
import select
import socket
import ssl
import struct
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

class PreDispatchError(RuntimeError):
    input_dispatched = False

class SecureTargetFocusLost(RuntimeError):
    pass

ROOT = "/home/user/.decision-feed"
REQUEST_PATH = sys.argv[1] if len(sys.argv) > 1 else ROOT + "/request.json"
TARGET_DIR = ROOT + "/targets"
LOCK_PATH = ROOT + "/controller.lock"
SECRET_KEY_DIR = ROOT + "/device-vault-keys"

SHADOW_HELPERS = r"""
  const composedParent = element => element.assignedSlot || element.parentElement || element.getRootNode()?.host || null;
  const composedContains = (ancestor, element) => {
    for (let current = element; current; current = composedParent(current)) {
      if (current === ancestor) return true;
    }
    return false;
  };
  const deepRoots = (root = document) => {
    const roots = [root];
    if (root.shadowRoot) roots.push(...deepRoots(root.shadowRoot));
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) roots.push(...deepRoots(element.shadowRoot));
    }
    return roots;
  };
  const deepQueryAll = (selector, root = document) => deepRoots(root).flatMap(scope => Array.from(scope.querySelectorAll(selector)));
  const deepQuery = selector => {
    const direct = document.querySelector(selector);
    if (direct) return direct;
    for (const root of deepRoots().slice(1)) {
      const match = root.querySelector(selector);
      if (match) return match;
    }
    return null;
  };
  const deepActiveElement = () => {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  };
  const deepElementFromPoint = (x, y) => {
    let element = document.elementFromPoint(x, y);
    while (element?.shadowRoot) {
      const child = element.shadowRoot.elementFromPoint(x, y);
      if (!child || child === element) break;
      element = child;
    }
    return element;
  };
  // Geometry and bounded control metadata only. Never include text, values,
  // attributes such as id/class, or HTML from a checkout page.
  const targetHitState = element => {
    if (!element) return {missing:true};
    const box = e => { const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height].map(n=>Math.round(n*100)/100); };
    const r=element.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2;
    const hit=deepElementFromPoint(x,y), style=getComputedStyle(element);
    return {rect:box(element),viewport:[innerWidth,innerHeight],
      visualViewport:visualViewport ? [visualViewport.width,visualViewport.height,visualViewport.offsetLeft,visualViewport.offsetTop,visualViewport.scale] : null,
      pointerEvents:style.pointerEvents,visibility:style.visibility,display:style.display,
      disabled:element.matches(':disabled') || Boolean(element.closest('[aria-disabled="true"]')),
      centerInViewport:x>=0 && y>=0 && x<innerWidth && y<innerHeight,
      receivesInput:Boolean(hit && (hit===element || composedContains(element,hit))),
      hit:hit ? {tag:hit.tagName,ref:hit.getAttribute('data-decision-feed-ref'),rect:box(hit),pointerEvents:getComputedStyle(hit).pointerEvents} : null};
  };
"""

DOM_HELPERS = SHADOW_HELPERS + r"""
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const roleFor = element => element.getAttribute('role') || ({a:'link',button:'button',textarea:'textbox',select:'combobox',option:'option',dialog:'dialog',main:'main',nav:'navigation',form:'form',section:'region',tr:'row',li:'listitem'}[element.tagName.toLowerCase()]) || (element.tagName === 'INPUT' ? (['checkbox','radio'].includes(element.type) ? element.type : ['submit','button'].includes(element.type) ? 'button' : element.type === 'search' ? 'searchbox' : element.type === 'number' ? 'spinbutton' : 'textbox') : /^H[1-6]$/.test(element.tagName) ? 'heading' : '');
  const nameFor = element => {
    const labelled = clean(element.getAttribute('aria-labelledby')).split(' ').filter(Boolean).map(id => clean(document.getElementById(id)?.textContent)).join(' ');
    const labels = 'labels' in element ? Array.from(element.labels || []).map(label => clean(label.textContent)).filter(Boolean).join(' ') : '';
    const editable = element.matches('input,textarea,[contenteditable="true"]');
    const container = ['region','group','dialog','form','main','navigation'].includes(roleFor(element));
    return clean(labelled || element.getAttribute('aria-label') || element.getAttribute('title') || labels || element.getAttribute('placeholder') || (editable ? element.getAttribute('name') : container ? '' : element.innerText || element.textContent)).slice(0,240);
  };

"""

SNAPSHOT_EXPRESSION = '(() => {' + DOM_HELPERS + r'''
  const observationRoot = document;
  const rendered = (element, viewportOnly = true) => {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;
    if (viewportOnly && (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth)) return false;
    if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    for (let current = element; current; current = composedParent(current)) {
      const style = getComputedStyle(current);
      if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true') return false;
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number.parseFloat(style.opacity || '1') < 0.02 || style.contentVisibility === 'hidden') return false;
      if (style.clipPath === 'inset(50%)' || style.transform === 'matrix(0, 0, 0, 0, 0, 0)') return false;
    }
    return true;
  };
  const hitTestVisible = element => {
    if (!rendered(element)) return false;
    // A descendant may explicitly restore pointer events beneath a layout
    // ancestor that disables them. Trust the candidate's computed state plus
    // the browser's real top-hit test instead of rejecting that valid control.
    if (getComputedStyle(element).pointerEvents === 'none') return false;
    const rect = element.getBoundingClientRect();
    const points = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + Math.min(8, rect.width / 2), rect.top + Math.min(8, rect.height / 2)],
      [rect.right - Math.min(8, rect.width / 2), rect.bottom - Math.min(8, rect.height / 2)],
    ];
    return points.some(([x, y]) => {
      const hit = deepElementFromPoint(Math.max(0, Math.min(innerWidth - 1, x)), Math.max(0, Math.min(innerHeight - 1, y)));
      return hit && (hit === element || composedContains(element, hit) || composedContains(hit, element));
    });
  };
  const stableRefs = globalThis.__wdytElementRefs || (globalThis.__wdytElementRefs = new WeakMap());
  const stableTokens = globalThis.__wdytElementTokens || (globalThis.__wdytElementTokens = new WeakMap());
  let nextRef = Math.max(__REF_START__, Number(globalThis.__wdytRefCounter) || 0);
  const selector = '[role],h1,h2,h3,h4,h5,h6,main,nav,dialog,form,section[aria-label],section[aria-labelledby],[role="region"],[role="group"],[role="dialog"],[role="form"],[role="row"],[role="listitem"],[tabindex],a[href],button,input,textarea,select,[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="menuitem"],[role="tab"],[role="option"],[aria-autocomplete="list"],[aria-selected],[class*="pac-item"],[class*="autocomplete"] li,[class*="autocomplete"] [tabindex],[class*="suggestion"],[aria-label*="close" i],[title*="close" i],[class*="close"],[data-action="close"],[data-role="closeBtn"]';
  const semanticOverlaySelector = 'dialog,[role="dialog"],[role="alert"],[role="alertdialog"],[aria-modal="true"]';
  const overlayCandidateSelector = semanticOverlaySelector + ',[class~="modal"],[class^="modal-"],[class*=" modal-"],[class~="popup"],[class^="popup-"],[class*=" popup-"],[data-modal],[data-popup]';
  const overlayRoots = Array.from(deepQueryAll(overlayCandidateSelector)).filter(element => {
    if (!hitTestVisible(element)) return false;
    if (element.matches(semanticOverlaySelector)) return true;
    const style = getComputedStyle(element);
    const zIndex = Number.parseInt(style.zIndex || '0', 10);
    return (style.position === 'fixed' || style.position === 'absolute') && (Number.isFinite(zIndex) ? zIndex > 0 : style.zIndex === 'auto');
  });
  const overlayElements = overlayRoots.flatMap(root => deepQueryAll(selector, root).filter(hitTestVisible));
  const pageElements = [...(observationRoot instanceof Element ? [observationRoot] : []), ...deepQueryAll(selector, observationRoot)].filter(element => rendered(element, false));
  // Modal controls are the active task. Put them ahead of busy background
  // pages. Do not discard later controls: targeted inspection and interaction
  // must also be able to reach controls beyond the first viewport.
  const prioritizedElements = [...new Set([...(observationRoot === document ? overlayElements : []), ...pageElements])];
  for (const element of prioritizedElements) {
    const ref = stableRefs.get(element) || 'e' + (++nextRef);
    stableRefs.set(element, ref);
    if (!stableTokens.has(element)) stableTokens.set(element, String(globalThis.__wdytElementTokenCounter = (globalThis.__wdytElementTokenCounter || 0) + 1));
    if (element.getAttribute('data-decision-feed-ref') !== ref) element.setAttribute('data-decision-feed-ref', ref);
  }
  const elements = prioritizedElements.map(element => {
    // Refs were assigned in the write-only pass above. Do not mutate the DOM
    // between layout/text reads: even writing the same attribute notifies site
    // observers and can force another style/layout calculation per element.
    const ref = stableRefs.get(element);
    const tag = element.tagName.toLowerCase();
    const input = element;
    const labelText = 'labels' in input ? Array.from(input.labels || []).map(label => clean(label.textContent)).filter(Boolean).join(' ') : '';
    const inputType = String(input.type || '').toLowerCase();
    const optionContext = ['checkbox','radio'].includes(inputType) ? clean(element.closest('label,tr,li')?.innerText || element.parentElement?.innerText || '') : '';
    const autocomplete = String(element.getAttribute('autocomplete') || '').toLowerCase();
    const fieldDescriptor = clean([
      element.getAttribute('aria-label'), element.getAttribute('title'), labelText,
      element.getAttribute('placeholder'), element.getAttribute('name'), element.id,
    ].filter(Boolean).join(' '));
    const valueRedacted = element.getAttribute('data-decision-feed-secret') === 'true' || ('value' in input && (
      inputType === 'password' ||
      /(?:current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp|cc-exp-month|cc-exp-year)/.test(autocomplete) ||
      /\b(?:password|passwd|passcode|one[ -]?time|otp|verification code|credit card|card number|cardholder|cvc|cvv|security code|expir(?:y|ation)|routing number|bank account|access token|auth token|api key|secret)\b/i.test(fieldDescriptor)
    ));
    const exposesValue = 'value' in input && ['input', 'textarea', 'select'].includes(tag) && !['hidden', 'file', 'checkbox', 'radio', 'submit', 'button', 'reset', 'image'].includes(inputType);
    const safeValue = exposesValue && !valueRedacted ? clean(input.value).slice(0, 240) : undefined;
    const name = nameFor(element);
    const ancestorRefs = [];
    for (let parent = composedParent(element); parent; parent = composedParent(parent)) { const ancestor = stableRefs.get(parent); if (ancestor) ancestorRefs.push(ancestor); }
    const options = tag === 'select' ? Array.from(input.options || []).slice(0, 100).map(option => ({ value: option.value, label: clean(option.textContent), selected: option.selected })) : undefined;
    const isFormControl = ['input','textarea','select'].includes(tag);
    const validityTokens = new Set(clean(element.className).toLowerCase().split(' ').filter(Boolean));
    const semanticInvalid = isFormControl && (element.getAttribute('aria-invalid') === 'true' || ['invalid','is-invalid','error','has-error'].some(token => validityTokens.has(token)));
    const semanticValid = isFormControl && !semanticInvalid && ['valid','is-valid'].some(token => validityTokens.has(token));
    // checkValidity() dispatches invalid events and can mutate the application.
    // Observation must read constraints without triggering validation handlers.
    const nativeValid = input.validity ? (!input.willValidate || input.validity.valid) : null;
    const valid = semanticInvalid ? false : semanticValid ? true : nativeValid;
    const validationMessage = valid === false ? clean(input.validationMessage).slice(0, 240) : '';
    return { ref, _refToken: stableTokens.get(element), tag, role: roleFor(element), ancestorRefs, name, href: element.href || '', type: input.type || '', value: safeValue, valueRedacted, options, settable: !input.disabled && !input.readOnly && element.getAttribute('aria-disabled') !== 'true' && element.getAttribute('aria-readonly') !== 'true' && (exposesValue || element.isContentEditable || ['checkbox','radio'].includes(inputType) || element.hasAttribute('aria-checked') || ['slider','spinbutton'].includes(roleFor(element))), readOnly: Boolean(input.readOnly) || element.getAttribute('aria-readonly') === 'true', disabled: Boolean(input.disabled) || element.getAttribute('aria-disabled') === 'true', checked: ['checkbox','radio'].includes(inputType) ? (input.indeterminate ? 'mixed' : Boolean(input.checked)) : element.hasAttribute('aria-checked') ? (element.getAttribute('aria-checked') === 'mixed' ? 'mixed' : element.getAttribute('aria-checked') === 'true') : null, required: Boolean(input.required), valid, validationMessage, ariaInvalid: semanticInvalid };
  });
  return { title: document.title, url: location.href, elements, nextRef, documentId: globalThis.__wdytDocumentId || (globalThis.__wdytDocumentId = globalThis.crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random()), focusedRef: document.hasFocus() ? deepActiveElement()?.getAttribute('data-decision-feed-ref') || null : null, activeModalCount: overlayRoots.length };
})()'''

def target_digest(target_key):
    if not isinstance(target_key, str) or not target_key.strip() or len(target_key) > 256:
        raise RuntimeError("Invalid cloud browser target key")
    return hashlib.sha256(target_key.encode("utf-8")).hexdigest()

def target_path(target_key):
    return os.path.join(TARGET_DIR, target_digest(target_key) + ".target")

def target_lock_path(target_key):
    return os.path.join(TARGET_DIR, target_digest(target_key) + ".lock")

def read_target_id(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    except FileNotFoundError:
        return ""

def claimed_target_ids():
    claimed = set()
    try:
        names = os.listdir(TARGET_DIR)
    except FileNotFoundError:
        return claimed
    for name in names:
        if not name.endswith(".target"):
            continue
        value = read_target_id(os.path.join(TARGET_DIR, name))
        if value:
            claimed.add(value)
    return claimed

def choose_target(target_key, allow_create=True):
    targets = [item for item in json_request("/json/list") if item.get("type") == "page" and item.get("webSocketDebuggerUrl")]
    os.makedirs(TARGET_DIR, mode=0o700, exist_ok=True)
    path = target_path(target_key)
    preferred = read_target_id(path)
    target = next((item for item in targets if item.get("id") == preferred), None)
    if target is None and not allow_create:
        raise RuntimeError("This task has no live browser tab. Navigate to a known URL; old element references are invalid.")
    # Never adopt an unclaimed popup belonging to a different run. Each new
    # task starts its own tab; persistent profile state is still shared as before.
    if target is None:
        target = json_request("/json/new?" + urllib.parse.quote("about:blank", safe=""), "PUT")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(str(target["id"]))
    return target

def recover_target(target_key):
    # This touches only the run's target mapping, never Chrome's shared profile.
    # Retired tabs remain claimed so another run cannot accidentally adopt them.
    path = target_path(target_key)
    attempts_path = path + ".recoveries"
    try:
        with open(attempts_path, "r", encoding="utf-8") as handle:
            history = json.load(handle)
            attempts = int(history.get("attempts", 0)) if time.time() - history.get("startedAt", 0) < 600 else 0
    except FileNotFoundError:
        history = {}
        attempts = 0
    if attempts >= 2:
        raise RuntimeError("Browser tab recovery limit reached. Stop retrying this browser and report the unresolved browser failure; do not repeat any uncertain external action.")
    prior = read_target_id(path)
    target = json_request("/json/new?" + urllib.parse.quote("about:blank", safe=""), "PUT")
    if prior:
        with open(path + ".retired-" + prior + ".target", "w", encoding="utf-8") as handle:
            handle.write(prior)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(str(target["id"]))
    with open(attempts_path, "w", encoding="utf-8") as handle:
        json.dump({"attempts": attempts + 1, "startedAt": history.get("startedAt", time.time()) if attempts else time.time()}, handle)
    return {"recovered": True}

def target_health(target):
    cdp = CDP(target["webSocketDebuggerUrl"])
    try:
        if hasattr(cdp, "observations") and cdp.observations().get("dialog"):
            return {"responsive": True}
        result = cdp.command("Runtime.evaluate", {"expression": "document.readyState", "returnByValue": True}, timeout=2)
        # Loading is still responsive. This is not a full page inspection.
        if result.get("result", {}).get("value") not in ("loading", "interactive", "complete"):
            raise RuntimeError("Browser tab health could not be established")
        return {"responsive": True}
    except Exception as error:
        if str(error).startswith("CDP command ") and " timed out" in str(error):
            return {"responsive": False}
        raise
    finally:
        cdp.close()

def prune_targets(target_keys, current_key):
    # Called under the global mapping lock. Never wait for another run's lock:
    # that run may itself be waiting for the global lock.
    closed = []
    deadline = time.time() + 5
    targets = {item["id"]: item for item in json_request("/json/list") if item.get("type") == "page"}
    for key in target_keys:
        if time.time() >= deadline or len(closed) >= 8:
            break
        if key == current_key:
            continue
        path = target_path(key)
        prefix = os.path.basename(path)
        owned = [os.path.join(TARGET_DIR, name) for name in os.listdir(TARGET_DIR)
                 if name == prefix or (name.startswith((prefix + ".retired-", prefix + ".child-")) and name.endswith(".target"))]
        if not owned:
            continue
        with open(target_lock_path(key), "a", encoding="utf-8") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                continue
            # A recent viewer interaction or resumed worker wins over the
            # database candidate list, which may have been read just before it.
            if any(time.time() - os.path.getmtime(name) < 1800 for name in owned):
                continue
            other_claims = {read_target_id(os.path.join(TARGET_DIR, name)) for name in os.listdir(TARGET_DIR)
                            if name.endswith(".target") and os.path.join(TARGET_DIR, name) not in owned}
            for name in owned:
                if time.time() >= deadline or len(closed) >= 8:
                    break
                target_id = read_target_id(name)
                if target_id in other_claims:
                    continue
                target = targets.get(target_id)
                if target:
                    cdp = CDP(target["webSocketDebuggerUrl"])
                    try:
                        result = cdp.command("Target.closeTarget", {"targetId": target_id}, timeout=2)
                        if not result.get("success"):
                            continue
                    finally:
                        cdp.close()
                    closed.append(target_id)
                os.remove(name)
            if not any(os.path.exists(name) for name in owned):
                try:
                    os.remove(path + ".recoveries")
                except FileNotFoundError:
                    pass
    return {"closed": closed}

def read_exact(sock, count):
    chunks = []
    remaining = count
    while remaining:
        chunk = sock.recv(remaining)
        if not chunk:
            raise RuntimeError("Cloud Chrome closed the DevTools connection (WebSocket close code 1006)")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)

class DirectCDP:
    def __init__(self, endpoint):
        self.endpoint = endpoint
        url = urllib.parse.urlparse(endpoint)
        browserless_url(endpoint)
        self.sock = ssl.create_default_context().wrap_socket(socket.create_connection((url.hostname, 443), timeout=10), server_hostname=url.hostname)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        path = url.path + (("?" + url.query) if url.query else "")
        handshake = (
            "GET " + path + " HTTP/1.1\r\n"
            "Host: " + url.netloc + "\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Key: " + key + "\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        ).encode("ascii")
        self.sock.sendall(handshake)
        header = b""
        while b"\r\n\r\n" not in header:
            chunk = self.sock.recv(1)
            if not chunk:
                raise RuntimeError("Browserless closed the DevTools handshake")
            header += chunk
            if len(header) > 65536:
                raise RuntimeError("Invalid DevTools WebSocket handshake")
        if not header.startswith(b"HTTP/1.1 101"):
            status = re.match(rb"HTTP/[0-9.]+ ([0-9]{3})", header)
            suffix = " (HTTP " + status.group(1).decode("ascii") + ")" if status else ""
            raise RuntimeError("DevTools WebSocket handshake failed" + suffix)
        self.next_id = 1
        self.events = []
        self.attached_targets = {}
        self.page_session = None
        if url.fragment:
            self.page_session = self.command("Target.attachToTarget", {"targetId": url.fragment, "flatten": True})["sessionId"]

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass

    def send(self, message):
        self.send_frame(json.dumps(message, separators=(",", ":")).encode("utf-8"))

    def send_frame(self, payload, opcode=1):
        mask = os.urandom(4)
        length = len(payload)
        if length < 126:
            header = bytes([0x80 | opcode, 0x80 | length])
        elif length <= 65535:
            header = bytes([0x80 | opcode, 0x80 | 126]) + struct.pack("!H", length)
        else:
            header = bytes([0x80 | opcode, 0x80 | 127]) + struct.pack("!Q", length)
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def receive(self, return_control=False, deadline=None):
        # A bounded read can time out between bytes of a WebSocket frame.
        # Preserve both partial frames and message fragments so a later command
        # can drain its late acknowledgement without corrupting the transport.
        buffer = getattr(self, "receive_buffer", bytearray())
        self.receive_buffer = buffer
        fragments = getattr(self, "receive_fragments", [])
        self.receive_fragments = fragments
        def ensure(length):
            while len(buffer) < length:
                if deadline is not None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0: raise socket.timeout()
                    self.sock.settimeout(remaining)
                chunk = self.sock.recv(length - len(buffer))
                if not chunk: raise RuntimeError("Cloud Chrome closed the DevTools connection (WebSocket close code 1006)")
                buffer.extend(chunk)
        while True:
            ensure(2)
            first, second = buffer[0], buffer[1]
            opcode = first & 0x0F
            final = bool(first & 0x80)
            length = second & 0x7F
            offset = 2
            if length == 126:
                ensure(4)
                length = struct.unpack("!H", bytes(buffer[2:4]))[0]
                offset = 4
            elif length == 127:
                ensure(10)
                length = struct.unpack("!Q", bytes(buffer[2:10]))[0]
                offset = 10
            if length > 32 * 1024 * 1024:
                raise RuntimeError("DevTools returned an oversized message")
            mask = None
            if second & 0x80:
                ensure(offset + 4)
                mask = bytes(buffer[offset:offset+4])
                offset += 4
            ensure(offset + length)
            payload = bytes(buffer[offset:offset+length])
            del buffer[:offset+length]
            if mask:
                payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
            if opcode == 8:
                code = struct.unpack("!H", payload[:2])[0] if len(payload) >= 2 else 1005
                # Close reasons can contain URLs or credentials. Persist only
                # the protocol's numeric close code, never arbitrary payload.
                raise RuntimeError("Cloud Chrome closed the DevTools connection (WebSocket close code " + str(code) + ")")
            if opcode == 9:
                self.send_frame(payload, 10)
                if return_control and not fragments: return {}
                continue
            if opcode == 10:
                if return_control and not fragments: return {}
                continue
            if opcode in (0, 1):
                fragments.append(payload)
            if final and fragments:
                payload = b"".join(fragments)
                fragments.clear()
                return json.loads(payload.decode("utf-8"))

    def command(self, method, params=None, timeout=20, session_id=None):
        effective_session = session_id or (self.page_session if not method.startswith(("Target.", "Browser.", "Storage.")) else None)
        # These domains remain enabled for the lifetime of the CDP session.
        # Re-enabling Runtime also re-emits context events on busy pages.
        enable_key = (effective_session, method.split('.')[0])
        enabled = getattr(self, "enabled_domains", {})
        if method in ("Page.enable", "Runtime.enable", "Target.setDiscoverTargets") and enabled.get(enable_key) == (params or {}):
            return {}
        if method in ("Page.disable", "Runtime.disable"):
            enabled.pop(enable_key, None)
        target_id = (params or {}).get("targetId") if method == "Target.attachToTarget" else None
        if target_id in self.attached_targets:
            return self.attached_targets[target_id]
        world_key = None
        if method == "Page.createIsolatedWorld":
            world_key = (session_id or self.page_session, (params or {}).get("frameId"), (params or {}).get("worldName"), bool((params or {}).get("grantUniveralAccess")))
            cached = getattr(self, "isolated_worlds", {}).get(world_key)
            if cached is not None: return dict(cached)
        command_id = self.next_id
        self.next_id += 1
        message = {"id": command_id, "method": method, "params": params or {}}
        session_id = session_id or (self.page_session if not method.startswith(("Target.", "Browser.", "Storage.")) else None)
        if session_id:
            message["sessionId"] = session_id
        self.send(message)
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError("CDP command " + method + " timed out")
            self.sock.settimeout(remaining)
            try:
                message = self.receive()
            except (TimeoutError, socket.timeout) as error:
                raise RuntimeError("CDP command " + method + " timed out") from error
            if message.get("id") != command_id:
                if message.get("method"):
                    self.record_event(message)
                    # Chrome can defer the input acknowledgement until its modal
                    # dialog closes. Input was dispatched; report the dialog instead
                    # of timing out and inviting a replay of the action.
                    if message.get('method') == 'Page.javascriptDialogOpening' and (method.startswith('Input.') or method == 'Runtime.evaluate'):
                        return {}
                continue
            if message.get("error"):
                error_text = message["error"].get("message", "DevTools command failed")
                if "context" in error_text.lower() and any(x in error_text.lower() for x in ("cannot find", "destroyed", "not found")):
                    self.isolated_worlds = {k:v for k,v in getattr(self, "isolated_worlds", {}).items() if k[0] != session_id}
                raise RuntimeError(error_text)
            result = message.get("result", {})
            if method in ("Page.enable", "Runtime.enable", "Target.setDiscoverTargets"):
                enabled[enable_key] = dict(params or {})
                self.enabled_domains = enabled
            if target_id and result.get("sessionId"):
                self.attached_targets[target_id] = result
            if world_key is not None and result.get("executionContextId") is not None:
                worlds = getattr(self, "isolated_worlds", {})
                worlds[world_key] = dict(result)
                self.isolated_worlds = worlds
            return result

    def read_commands(self, commands, timeout=20, session_id=None, settled=False):
        # Only independent observation reads. Never batch input or replay on failure.
        allowed = {"Accessibility.getFullAXTree", "DOM.getDocument", "Page.getFrameTree", "Target.getTargets", "DOM.getFrameOwner", "DOM.getBoxModel"}
        if not isinstance(commands, list) or not 1 <= len(commands) <= 64 or any(not isinstance(c, dict) or c.get("method") not in allowed for c in commands):
            raise RuntimeError("Invalid parallel observation reads")
        return self._observation_commands(commands, timeout, session_id, settled)

    def reference_query(self, contexts, ref):
        # Existing identities only. Reuse the exact fresh query projection,
        # dispatch independent frame reads together, and retain every match.
        if not isinstance(ref,str) or not re.fullmatch(r'e[0-9]+',ref):
            raise RuntimeError("Invalid reference query")
        if not isinstance(contexts,list) or not 1 <= len(contexts) <= 64:
            raise RuntimeError("Invalid reference query frames")
        expression=extended_query_expression({'ref':ref}).replace('__REF_COUNTER_INIT__','',1)
        commands=[]
        for context in contexts:
            parameters={'expression':expression,'returnByValue':True,'awaitPromise':True}
            if context.get('contextId') is not None: parameters['contextId']=context['contextId']
            commands.append({'method':'Runtime.evaluate','params':parameters,'sessionId':context.get('sessionId')})
        replies=self._observation_commands(commands,20,None,True)
        return [{'error':reply['error']} if 'error' in reply else {'error':'The page rejected a DOM operation'} if reply['result'].get('exceptionDetails') else {'value':reply['result'].get('result',{}).get('value')} for reply in replies]

    def existing_locator_query(self, contexts, locator):
        # Controller-authored, read-only selector projection. No fresh refs or
        # DOM writes; unknown nodes force the original sequential allocator.
        if not isinstance(locator,dict) or not isinstance(contexts,list) or not 1 <= len(contexts) <= 64:
            raise RuntimeError("Invalid locator observation batch")
        expression=extended_query_expression(locator,existing_only=True).replace('__REF_COUNTER_INIT__','',1)
        commands=[]
        for context in contexts:
            parameters={'expression':expression,'returnByValue':True,'awaitPromise':True}
            if context.get('contextId') is not None: parameters['contextId']=context['contextId']
            commands.append({'method':'Runtime.evaluate','params':parameters,'sessionId':context.get('sessionId')})
        replies=self._observation_commands(commands,20,None,True)
        return [{'error':reply['error']} if 'error' in reply else {'error':'The page rejected a DOM operation'} if reply['result'].get('exceptionDetails') else {'value':reply['result'].get('result',{}).get('value')} for reply in replies]

    def frame_values(self, kind, contexts, counter=None):
        # Preset controller bookkeeping only: no caller-authored JavaScript and
        # no input/navigation. All frames are independent and errors are drained.
        if not isinstance(contexts, list) or not 1 <= len(contexts) <= 64:
            raise RuntimeError("Invalid frame observation batch")
        commands = []
        for context in contexts:
            expression = frame_observation_expression(kind, counter if context.get("main") else None)
            parameters = {"expression":"(() => {" + SHADOW_HELPERS + "return (" + expression + ");})()", "returnByValue":True, "awaitPromise":True}
            if context.get("contextId") is not None: parameters["contextId"] = context["contextId"]
            commands.append({"method":"Runtime.evaluate", "params":parameters, "sessionId":context.get("sessionId")})
        replies = self._observation_commands(commands, 20, None, True)
        return [{"error":reply["error"]} if "error" in reply else {"error":"The page rejected a DOM operation"} if reply["result"].get("exceptionDetails") else {"value":reply["result"].get("result", {}).get("value")} for reply in replies]

    def _observation_commands(self, commands, timeout, session_id, settled):
        pending = {}
        results = [None] * len(commands)
        for index, command in enumerate(commands):
            command_id = self.next_id
            self.next_id += 1
            message = {"id": command_id, "method": command["method"], "params": command.get("params") or {}}
            command_session = command.get("sessionId") or session_id or (self.page_session if not command["method"].startswith(("Target.", "Browser.", "Storage.")) else None)
            if command_session: message["sessionId"] = command_session
            self.send(message)
            pending[command_id] = index
        deadline = time.monotonic() + timeout
        failure = None
        while pending:
            remaining = deadline - time.monotonic()
            if remaining <= 0: raise RuntimeError("CDP command observation reads timed out")
            self.sock.settimeout(remaining)
            try: message = self.receive()
            except (TimeoutError, socket.timeout) as error:
                raise RuntimeError("CDP command observation reads timed out") from error
            if message.get("method"): self.record_event(message)
            index = pending.pop(message.get("id"), None)
            if index is None: continue
            if message.get("error"):
                error_text = message["error"].get("message", "DevTools observation failed")
                failure = failure or error_text
                if "context" in error_text.lower() and any(text in error_text.lower() for text in ("cannot find", "destroyed", "not found")):
                    failed_session = commands[index].get("sessionId") or session_id or self.page_session
                    self.isolated_worlds = {key:value for key,value in getattr(self, "isolated_worlds", {}).items() if key[0] != failed_session}
                results[index] = {"error": error_text}
            else: results[index] = {"result": message.get("result", {})} if settled else message.get("result", {})
        # getDocument enables DOM mutation events. We only use backend IDs,
        # so release frontend tracking before returning the observation.
        for dom_session in {command.get("sessionId") or session_id or self.page_session for command in commands if command["method"] == "DOM.getDocument"}:
            self.command("DOM.disable", session_id=dom_session)
        if failure and not settled: raise RuntimeError(failure)
        return results

    def reference_routes(self, ref=None, updates=None):
        # Frame locations only. Every use performs a fresh DOM/WeakMap read;
        # this cache never grants permission or supplies element semantics.
        routes = getattr(self, "reference_route_cache", {})
        for update in updates or []:
            context = update["context"]
            for key in update["refs"]:
                if not isinstance(key,str) or not re.fullmatch(r'e[0-9]+',key): continue
                routes[key] = dict(context)
        if len(routes) > 20000: routes = {}
        self.reference_route_cache = routes
        return routes.get(ref) if ref else None

    def reference_maps(self, requests, updates=None):
        # Cache addressability only, never page text, values, AX semantics or
        # readiness. A new document or any newly assigned ref forces a fresh read.
        cache = getattr(self, "reference_map_cache", {})
        for update in updates or []:
            cache[update["sessionId"]] = update
        if len(cache) > 64: cache = {}
        self.reference_map_cache = cache
        result = []
        for request in requests:
            prior = cache.get(request["sessionId"])
            valid = prior and all(document[1] for document in json.loads(request["documents"])) and prior["documents"] == request["documents"] and set(request["refs"]).issubset(set(prior["refs"].values()))
            valid = valid and all(prior.get("tokens", {}).get(ref) == token for ref, token in request.get("tokens", {}).items())
            result.append(prior["refs"] if valid else None)
        return result

    def reference_backend(self, session_id, frame_id, document_id, ref, token):
        prior = getattr(self, "reference_map_cache", {}).get(session_id)
        if not prior or not document_id or not token: return None
        if [frame_id, document_id] not in json.loads(prior["documents"]): return None
        if prior.get("tokens", {}).get(ref) != [frame_id, token]: return None
        matches = [int(backend) for backend, value in prior["refs"].items() if value == ref]
        return matches[0] if len(matches) == 1 else None

    def type_keys(self, text, delay=0.006):
        # Preserve native keyDown/keyUp and their order. Pipeline only ordinary
        # text, never shortcuts, secure entry or unrelated agent actions. Each
        # small window is fully acknowledged before sending the next; failures
        # are never replayed. This removes a remote round trip per key event.
        if not isinstance(text, str) or len(text) > 512 or any(c in "\r\n\t" for c in text):
            raise RuntimeError("Invalid ordinary key sequence")
        for start in range(0, len(text), 16):
            pending = set()
            for character in text[start:start + 16]:
                for kind in ("keyDown", "keyUp"):
                    params = {"type": kind, "key": character}
                    if kind == "keyDown": params.update(text=character, unmodifiedText=character)
                    command_id = self.next_id
                    self.next_id += 1
                    message = {"id": command_id, "method": "Input.dispatchKeyEvent", "params": params}
                    if self.page_session: message["sessionId"] = self.page_session
                    self.send(message)
                    pending.add(command_id)
                if delay: time.sleep(delay)
            deadline = time.monotonic() + 20
            while pending:
                remaining = deadline - time.monotonic()
                if remaining <= 0: raise RuntimeError("CDP command key sequence timed out; input was not replayed")
                self.sock.settimeout(remaining)
                try:
                    message = self.receive()
                except (TimeoutError, socket.timeout) as error:
                    raise RuntimeError("CDP command key sequence timed out; input was not replayed") from error
                if message.get("method"):
                    self.record_event(message)
                    if message["method"] == "Page.javascriptDialogOpening":
                        raise RuntimeError("Browser dialog interrupted typing; inspect before continuing. Input was not replayed")
                if message.get("id") in pending:
                    pending.remove(message["id"])
                    if message.get("error"):
                        raise RuntimeError("CDP command key sequence failed; input was not replayed")

    def observations(self):
        return {"dialog":getattr(self,"pending_dialog",None),"logs":getattr(self,"browser_logs",[])}

    def frame_is_live(self, frame_id, session_id=None):
        session_id = session_id or self.page_session
        return any(key[0] == session_id and value.get("frameId") == frame_id
                   for key, value in getattr(self, "runtime_contexts", {}).items())

    def record_event(self, message):
        method=message.get('method');params=message.get('params',{})
        contexts = getattr(self, "runtime_contexts", {})
        event_session = message.get("sessionId")
        if method == "Runtime.executionContextCreated":
            context = params.get("context", {})
            contexts[(event_session, context.get("id"))] = {"frameId":context.get("auxData", {}).get("frameId")}
        elif method == "Runtime.executionContextDestroyed":
            contexts.pop((event_session, params.get("executionContextId")), None)
        elif method == "Runtime.executionContextsCleared":
            contexts = {k:v for k,v in contexts.items() if k[0] != event_session}
        elif method in ("Page.frameNavigated", "Page.frameDetached"):
            frame = params.get("frame", {}).get("id") if method == "Page.frameNavigated" else params.get("frameId")
            contexts = {k:v for k,v in contexts.items() if not (k[0] == event_session and v.get("frameId") == frame)}
        elif method == "Target.detachedFromTarget":
            contexts = {k:v for k,v in contexts.items() if k[0] != params.get("sessionId")}
        self.runtime_contexts = contexts
        routes = getattr(self, "reference_route_cache", {})
        if method == "Runtime.executionContextDestroyed":
            routes = {ref:c for ref,c in routes.items() if not ((c.get("sessionId") or self.page_session) == event_session and c.get("contextId") == params.get("executionContextId"))}
        elif method in ("Runtime.executionContextsCleared", "Target.detachedFromTarget"):
            retired = params.get("sessionId") if method == "Target.detachedFromTarget" else event_session
            routes = {ref:c for ref,c in routes.items() if (c.get("sessionId") or self.page_session) != retired}
        elif method in ("Page.frameNavigated", "Page.frameDetached"):
            retired = params.get("frame", {}).get("id") if method == "Page.frameNavigated" else params.get("frameId")
            routes = {ref:c for ref,c in routes.items() if c.get("frameId") != retired}
        self.reference_route_cache = routes
        worlds = getattr(self, "isolated_worlds", {})
        session = message.get("sessionId")
        if method == "Runtime.executionContextsCleared":
            worlds = {k:v for k,v in worlds.items() if k[0] != session}
        elif method == "Runtime.executionContextDestroyed":
            worlds = {k:v for k,v in worlds.items() if not (k[0] == session and v.get("executionContextId") == params.get("executionContextId"))}
        elif method in ("Page.frameNavigated", "Page.frameDetached"):
            frame_id = params.get("frame", {}).get("id") if method == "Page.frameNavigated" else params.get("frameId")
            worlds = {k:v for k,v in worlds.items() if not (k[0] == session and k[1] == frame_id)}
        elif method == "Target.detachedFromTarget":
            worlds = {k:v for k,v in worlds.items() if k[0] != params.get("sessionId")}
        self.isolated_worlds = worlds
        if method=='Browserless.liveComplete': self.live_url_epoch = getattr(self, "live_url_epoch", 0) + 1
        if method=='Page.javascriptDialogOpening': self.pending_dialog={k:params.get(k) for k in ('type','message','url','defaultPrompt')}
        elif method=='Page.javascriptDialogClosed': self.pending_dialog=None
        if method in ('Runtime.consoleAPICalled','Runtime.exceptionThrown','Log.entryAdded'):
            # Metadata only: console arguments can contain secure values even after navigation.
            entry=params.get('entry',{})
            logs=getattr(self,'browser_logs',[])
            logs.append({'event':method,'level':params.get('type') or entry.get('level'),'url':entry.get('url'),'timestamp':params.get('timestamp') or entry.get('timestamp')})
            self.browser_logs=logs[-50:]
        if message.get("method") == "Target.detachedFromTarget":
            session_id = message.get("params", {}).get("sessionId")
            self.attached_targets = {key: value for key, value in self.attached_targets.items() if value.get("sessionId") != session_id}
        self.events.append(message)
        if len(self.events) > 2000:
            self.events = self.events[-2000:]

    def clear_events(self):
        self.events = []

    def poll_idle(self):
        if not self.sock.pending() and not select.select([self.sock], [], [], 0)[0]:
            return False
        # Socket readability may mean only part of a TLS/WebSocket event is
        # available. A short idle deadline must not destroy the live transport.
        try:
            message = self.receive(return_control=True, deadline=time.monotonic() + 0.01)
        except (TimeoutError, socket.timeout):
            return False
        if message.get("method"):
            self.record_event(message)
        return True

    def take_events(self):
        events = self.events
        self.events = []
        return events

    def pump_events(self, timeout=0.1):
        deadline = time.monotonic() + max(0.0, timeout)
        while time.monotonic() < deadline:
            self.sock.settimeout(max(0.01, deadline - time.monotonic()))
            try:
                message = self.receive()
            except socket.timeout:
                break
            if message.get("method"):
                self.record_event(message)

${CDP_POOL}

def evaluate(cdp, expression, context_id=None, session_id=None):
    parameters = {"expression": "(() => {" + SHADOW_HELPERS + "return (" + expression + ");})()", "returnByValue": True, "awaitPromise": True}
    if context_id is not None:
        parameters["contextId"] = context_id
    result = cdp.command("Runtime.evaluate", parameters, session_id=session_id)
    if result.get("exceptionDetails"):
        if expression == PROFILE_STORAGE_EXPRESSION:
            description = str(result["exceptionDetails"].get("exception", {}).get("description", ""))
            for text, code in (("non-JSON storage", "non_json_storage"), ("Database read", "database_read"), ("Database changed", "database_changed"), ("SecurityError", "storage_denied")):
                if text in description: raise RuntimeError("profile_" + code)
        raise RuntimeError("The page rejected a DOM operation")
    return result.get("result", {}).get("value")

def cursor_transport(cdp):
    # Test doubles need no second socket. Real actions always keep decoration
    # on a separate transport so a visual timeout cannot discard the input CDP.
    if not hasattr(cdp, "endpoint"):
        return cdp
    if not getattr(cdp, "cursor_transport", None):
        cdp.cursor_transport = PooledCDP(cdp.endpoint, channel="visual")
    return cdp.cursor_transport

def visual_cursor(cdp, element=None, click=False):
    # Decorative, best effort only. Never gate input on animation or replay input
    # because rendering failed. Reuse contexts already resolved for the action.
    try:
        transport = cursor_transport(cdp)
        deadline = time.monotonic() + 0.8
        def command(method, params, **kwargs):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Cursor rendering budget elapsed")
            return transport.command(method, params, timeout=remaining, **kwargs)
        if click:
            context_id = getattr(cdp, "visual_cursor_context", None)
            if context_id is None:
                return
            event = {"kind": "click"}
        else:
            contexts = {item["frameId"]: item for item in (getattr(cdp, "frame_context_cache", None) or [])}
            current = contexts.get(element.get("frameId"))
            # Fast ref routing may describe a live control without populating
            # frame_context_cache. Use its verified main-frame identity directly.
            if not current and element.get("mainFrame"):
                current = {"frameId": element["frameId"], "main": True}
            elif not current:
                # Decorative ancestry only: no DOM/AX discovery or input replay.
                frames = flatten_frames(command("Page.getFrameTree", {}).get("frameTree", {}))
                contexts = {frame["id"]: {"frameId": frame["id"], "parentFrameId": frame.get("parentId"), "main": index == 0} for index, frame in enumerate(frames)}
                current = contexts.get(element.get("frameId"))
            if not current:
                return
            point = {"x": element["x"], "y": element["y"]}
            seen = set()
            while not current.get("main"):
                if current["frameId"] in seen or len(seen) >= 8:
                    return
                seen.add(current["frameId"])
                parent = contexts.get(current.get("parentFrameId"))
                if not parent:
                    return
                # Flattened attachment IDs are connection-specific. Attach the
                # same parent frame on the decorative socket when it is OOPIF.
                session = command("Target.attachToTarget", {"targetId": parent["frameId"], "flatten": True})["sessionId"] if parent.get("sessionId") else None
                owner = command("DOM.getFrameOwner", {"frameId": current["frameId"]}, session_id=session)
                params = {"backendNodeId": owner["backendNodeId"]}
                if parent.get("contextId") is not None:
                    params["executionContextId"] = parent["contextId"]
                remote = command("DOM.resolveNode", params, session_id=session)
                object_id = remote["object"]["objectId"]
                try:
                    result = command("Runtime.callFunctionOn", {"objectId": object_id, "functionDeclaration": ${JSON.stringify(CURSOR_FRAME_POINT)}, "arguments": [{"value": point}], "returnByValue": True}, session_id=session)
                    point = result["result"]["value"]
                finally:
                    command("Runtime.releaseObject", {"objectId": object_id}, session_id=session)
                current = parent
            command("Page.enable", {})
            context_id = command("Page.createIsolatedWorld", {"frameId": current["frameId"], "worldName": "dash-visual-cursor"})["executionContextId"]
            cdp.visual_cursor_context = context_id
            event = {"kind": "move", "color": os.environ.get("DASH_CURSOR_COLOR", "#111111"), **point}
            # The same tab's next document gets the last pointer location before
            # first paint. No site storage, navigation, focus or input mutation.
            scripts = BROWSER_STATE.setdefault("cursorScripts", {})
            tab_key = urllib.parse.urlparse(cdp.endpoint).fragment or cdp.endpoint
            old = scripts.pop(tab_key, None)
            if old:
                command("Page.removeScriptToEvaluateOnNewDocument", {"identifier": old})
            restored = command("Page.addScriptToEvaluateOnNewDocument", {
                "worldName": "dash-visual-cursor",
                "source": "(" + ${JSON.stringify(CURSOR_RESTORE_EXPRESSION)} + ")(" + json.dumps(event) + ")",
            })
            scripts[tab_key] = restored["identifier"]
            private_json(BROWSER_STATE_PATH, BROWSER_STATE)
        command("Runtime.evaluate", {"expression": "(" + ${JSON.stringify(VISUAL_CURSOR_EXPRESSION)} + ")(" + json.dumps(event) + ")", "contextId": context_id, "returnByValue": True})
    except Exception:
        pass

def hide_visual_cursor(cdp):
    # Clear future-document restoration as well as the current artwork. Keep
    # these independent so a disconnected preload cannot prevent hiding now.
    try:
        tab_key = urllib.parse.urlparse(cdp.endpoint).fragment or cdp.endpoint
        identifier = BROWSER_STATE.setdefault("cursorScripts", {}).pop(tab_key, None)
        private_json(BROWSER_STATE_PATH, BROWSER_STATE)
        if identifier:
            cursor_transport(cdp).command("Page.removeScriptToEvaluateOnNewDocument", {"identifier": identifier}, timeout=0.8)
    except Exception:
        pass
    try:
        expression = "document.getElementById('dash-visual-cursor')?.remove()"
        cursor_transport(cdp).command("Runtime.evaluate", {"expression": expression}, timeout=0.8)
    except Exception:
        pass

def flatten_frames(frame_tree):
    frames = []
    def visit(node):
        frame = node.get("frame") if isinstance(node, dict) else None
        if isinstance(frame, dict) and isinstance(frame.get("id"), str):
            frames.append(frame)
        for child in node.get("childFrames", []) if isinstance(node, dict) else []:
            visit(child)
    visit(frame_tree)
    return frames

def snapshot_frame_ids(cdp, frames):
    # Two batched metadata reads avoid creating worlds or reading AX trees for
    # hidden/pixel tracking frames. Unknown geometry stays observable.
    children = frames[1:]
    if not children or not hasattr(cdp, "read_commands"): return None
    owners = [result for start in range(0, len(children), 64) for result in cdp.read_commands([{"method":"DOM.getFrameOwner", "params":{"frameId":frame["id"]}} for frame in children[start:start+64]], settled=True)]
    known = [(frame, owner["result"]["backendNodeId"]) for frame, owner in zip(children, owners) if owner.get("result", {}).get("backendNodeId")]
    boxes = [result for start in range(0, len(known), 64) for result in cdp.read_commands([{"method":"DOM.getBoxModel", "params":{"backendNodeId":node}} for _, node in known[start:start+64]], settled=True)]
    allowed = {frame["id"] for frame in children}
    for (frame, _), box in zip(known, boxes):
        model = box.get("result", {}).get("model")
        if model:
            # BoxModel width includes borders; a 1px tracking document can
            # have a 5px outer box with Chrome's default iframe borders.
            quad = model.get("content")
            width = ((quad[2]-quad[0])**2 + (quad[3]-quad[1])**2)**0.5 if quad else model.get("width", 0)
            height = ((quad[4]-quad[2])**2 + (quad[5]-quad[3])**2)**0.5 if quad else model.get("height", 0)
            if width <= 1 or height <= 1: allowed.discard(frame["id"])
        elif "error" in box and "could not compute box model" in str(box["error"]).lower(): allowed.discard(frame["id"])
    return allowed

def frame_contexts(cdp, refresh=False):
    cached = getattr(cdp, "frame_context_cache", None)
    if cached is not None and not refresh:
        return cached
    prefetched_targets = None
    if hasattr(cdp, "read_commands"):
        try:
            cdp.command("Target.setDiscoverTargets", {"discover": True})
        except Exception:
            pass
        discovered = cdp.read_commands([
            {"method":"Page.getFrameTree"},
            {"method":"Target.getTargets", "params":{"filter":[{"type":"iframe"},{"type":"page"}]}}
        ], settled=True)
        if "error" in discovered[0]: raise RuntimeError(discovered[0]["error"])
        tree = discovered[0]["result"].get("frameTree", {})
        prefetched_targets = discovered[1].get("result", {}).get("targetInfos", [])
    else:
        tree = cdp.command("Page.getFrameTree").get("frameTree", {})
    frames = flatten_frames(tree)
    excluded_frame_ids = set()
    if getattr(cdp, "snapshot_deadline", None):
        allowed = snapshot_frame_ids(cdp, frames)
        if allowed is not None:
            excluded_frame_ids = {frame["id"] for frame in frames[1:] if frame["id"] not in allowed}
            frames = [frame for index, frame in enumerate(frames) if index == 0 or frame["id"] in allowed]
    page_frame_ids = {frame["id"] for frame in frames}
    # Discover process ownership before creating execution worlds. Chrome may
    # include OOPIF stubs in the parent's frame tree; asking the parent to create
    # their worlds can stall until timeout even though their own target is live.
    iframe_infos = []
    try:
        if prefetched_targets is None:
            cdp.command("Target.setDiscoverTargets", {"discover": True})
            target_infos = cdp.command("Target.getTargets", {"filter": [{"type": "iframe"}, {"type": "page"}]}).get("targetInfos", [])
        else:
            target_infos = prefetched_targets
        owned_target_ids = set(page_frame_ids)
        remaining = [info for info in target_infos if info.get("type") == "iframe" and info.get("targetId") not in excluded_frame_ids]
        while remaining and len(iframe_infos) < 32:
            added = [info for info in remaining if info.get("targetId") in page_frame_ids or
                     any(parent in owned_target_ids for parent in (info.get("parentId"), info.get("parentFrameId")) if parent)]
            if not added: break
            for info in added:
                iframe_infos.append(info)
                owned_target_ids.add(info.get("targetId"))
                remaining.remove(info)
                if len(iframe_infos) >= 32: break
    except Exception:
        # Older Chromium builds retain the ordinary frame-tree path.
        pass
    process_frames = {info["targetId"]: info for info in iframe_infos}
    contexts = []
    cdp.frame_context_warnings = []
    attached_frame_ids = set()
    def attach_frame(info):
        target_id = info["targetId"]
        if target_id in attached_frame_ids: return True
        try:
            attached = cdp.command("Target.attachToTarget", {"targetId":target_id,"flatten":True})
            session_id = attached.get("sessionId")
            if not session_id: return False
            cdp.command("Runtime.enable", session_id=session_id)
            contexts.append({"contextId":None,"frameId":target_id,"parentFrameId":info.get("parentFrameId") or info.get("parentId"),"main":False,"sessionId":session_id})
            attached_frame_ids.add(target_id)
            return True
        except Exception:
            return False
    for index, frame in enumerate(frames):
        if index > 0 and getattr(cdp, "snapshot_deadline", None) and time.monotonic() > cdp.snapshot_deadline - 1.5:
            cdp.frame_context_warnings.append("[Child-frame observation deferred to keep the main page responsive; inspect the frame before relying on absent controls.]")
            break
        if index > 0 and frame["id"] in process_frames and attach_frame(process_frames[frame["id"]]):
            continue
        if index > 0 and hasattr(cdp, "frame_is_live") and not cdp.frame_is_live(frame["id"]):
            # Chrome's frame tree can outlive a child renderer. Runtime.enable
            # delivers live contexts; use that evidence instead of asking a
            # dead/loading frame to create a world and waiting on its renderer.
            cdp.frame_context_warnings.append("[A child frame is still unavailable; inspect again before relying on absent controls.]")
            continue
        try:
            world = cdp.command("Page.createIsolatedWorld", {
                "frameId":frame["id"],"worldName":"decision-feed-dom-"+frame["id"],"grantUniveralAccess":False,
            }, timeout=20 if index == 0 else 2)
            context_id = world.get("executionContextId")
            if context_id is not None:
                contexts.append({"contextId":context_id,"frameId":frame["id"],"url":frame.get("url"),"parentFrameId":frame.get("parentId"),"main":index==0,"sessionId":None})
                attached_frame_ids.add(frame["id"])
        except Exception as error:
            # Let the read-only recovery wrapper refresh a lost main context.
            # Swallowing it turns a recoverable transport failure into an empty
            # snapshot and hides the cause. Never replay the preceding input.
            if index == 0: raise
            # Never silently claim a complete observation after a slow frame.
            # The native input connection remains usable after this bounded,
            # non-input request; a later inspection can observe the loaded frame.
            if "timed out" in str(error).lower():
                cdp.frame_context_warnings.append("[A child frame is still unavailable; inspect again before relying on absent controls.]")
    for info in iframe_infos:
        if getattr(cdp, "snapshot_deadline", None) and time.monotonic() > cdp.snapshot_deadline - 1.5: break
        attach_frame(info)
    cdp.frame_context_cache = contexts
    return contexts

def observation_error_code(error):
    message = str(error).lower()
    if any(text in message for text in ("cannot find context", "execution context was destroyed", "cannot find execution context", "no frame with given id", "session with given id not found", "inspected target navigated")):
        return "stale_context"
    if any(text in message for text in ("persistent browser connection ended", "persistent browser transport failed", "persistent browser connection returned no valid result", "websocket closed", "cloud chrome closed", "connection reset", "broken pipe")):
        return "connection_dropped"
    if message.startswith("cdp command ") and "timed out" in message:
        return "connection_dropped"
    return None

def recover_observation(cdp, read):
    # Only trusted observations call this helper. Never wrap input, navigation,
    # uploads, secure fills, or an agent-authored script in an automatic retry.
    try:
        return read()
    except Exception as error:
        code = observation_error_code(error)
        if code is None: raise
        cdp.frame_context_cache = None
        if code == "connection_dropped":
            if not hasattr(cdp, "reconnect_observation"): raise
            cdp.reconnect_observation()
        return read()

def evaluate_context(cdp, expression, context):
    return evaluate(cdp, expression, context.get("contextId"), context.get("sessionId"))

DIAGNOSTIC_TARGET = None
DIAGNOSTIC_REF = None
DIAGNOSTIC_TAB = None
DIAGNOSTIC_EXPRESSION = r"""(() => {
  if (!globalThis.__dashFocusEvents) {
    globalThis.__dashFocusEvents = [];
    const record = event => {
      const element = document.activeElement;
      globalThis.__dashFocusEvents.push({event:event.type,at:Date.now(),pageFocused:document.hasFocus(),activeRef:element?.getAttribute?.('data-decision-feed-ref') || null});
      if (globalThis.__dashFocusEvents.length > 12) globalThis.__dashFocusEvents.shift();
    };
    for (const event of ['focusin','focusout','visibilitychange']) document.addEventListener(event, record, true);
    for (const event of ['focus','blur','pagehide']) window.addEventListener(event, record, true);
  }
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return {pageFocused:document.hasFocus(),activeRef:active?.getAttribute?.('data-decision-feed-ref') || null,
    activeTag:['INPUT','TEXTAREA','SELECT','IFRAME','BODY','BUTTON','A'].includes(active?.tagName) ? active.tagName : 'OTHER',
    readyState:document.readyState,visibility:document.visibilityState,documentId:globalThis.__wdytDocumentId,
    events:globalThis.__dashFocusEvents.slice(-12)};
})()"""

def browser_diagnostic(cdp, stage, target_id=None):
    # Read-only and bounded. Never inspect values, names, URLs, or page text.
    if not globals().get("DIAGNOSTICS_ENABLED", False):
        return
    data = {"stage":stage, "at":time.time()*1000, "generation":BROWSER_STATE.get("generation", ""), "targetId":target_id or DIAGNOSTIC_TAB, "takeover":bool(BROWSER_STATE.get("live", {}).get(CURRENT_TARGET_KEY, {}).get("control"))}
    # Lifecycle markers need timestamps, not extra renderer round trips. Keep
    # fresh before/after-action focus samples and an end sample on error paths.
    if getattr(cdp, "passive_observation", False) or stage in ("before_reconnect", "after_reconnect") or (stage == "operation_end" and getattr(cdp, "diagnostic_after_operation", False)):
        print("DASH_DIAGNOSTIC " + json.dumps(data, separators=(",", ":")), flush=True)
        return
    if stage == "after_operation": cdp.diagnostic_after_operation = True
    try:
        if getattr(cdp, "diagnostic_unavailable", False):
            data["available"] = False
            print("DASH_DIAGNOSTIC " + json.dumps(data, separators=(",", ":")), flush=True)
            return
        if hasattr(cdp,'observations') and cdp.observations().get('dialog'): return
        transport = cdp
        if hasattr(cdp, "endpoint"):
            if not getattr(cdp, "diagnostic_transport", None):
                cdp.diagnostic_transport = PooledCDP(cdp.endpoint, channel="diagnostic")
            transport = cdp.diagnostic_transport
        def sample(context=None):
            params = {"expression":DIAGNOSTIC_EXPRESSION,"returnByValue":True}
            if context and context.get("contextId") is not None: params["contextId"] = context["contextId"]
            result = transport.command("Runtime.evaluate", params, timeout=1, session_id=context.get("sessionId") if context else None)
            return result.get("result", {}).get("value", {"available":False})
        data["page"] = sample()
        if DIAGNOSTIC_TARGET and (target_id is None or target_id == DIAGNOSTIC_TAB):
            data["ref"] = DIAGNOSTIC_REF
            data["frameId"] = DIAGNOSTIC_TARGET.get("frameId")
            # Execution/session IDs belong to the input connection. Never send
            # them over the diagnostic transport or reattach frames just to log.
            if transport is cdp: data["field"] = sample(DIAGNOSTIC_TARGET)
    except Exception:
        cdp.diagnostic_unavailable = True
        data["available"] = False
    print("DASH_DIAGNOSTIC " + json.dumps(data, separators=(",", ":")), flush=True)

def find_ref(cdp, ref, refresh=False, native_identity=True):
    return recover_observation(cdp, lambda: find_ref_once(cdp, ref, refresh, native_identity))

def ref_contexts(cdp, ref, refresh=False):
    # A previous fresh description tells us where to look, never what to click.
    # Re-read the node and native identity; stale contexts fall back to discovery.
    hint = globals().get("DIAGNOSTIC_TARGET") if not refresh and globals().get("DIAGNOSTIC_REF") == ref else None
    if hint:
        yield hint
    route = cdp.reference_routes(ref) if not refresh and hasattr(cdp, "reference_routes") else None
    if route and route != hint:
        yield route
    for context in frame_contexts(cdp, refresh=refresh):
        if context != hint and context != route:
            yield context

def find_ref_once(cdp, ref, refresh=False, native_identity=True):
    global DIAGNOSTIC_TARGET, DIAGNOSTIC_REF
    ref_json = json.dumps(ref)
    expression = "(() => {" + DOM_HELPERS + """const element = deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']'); if (!element) return null; const rect = element.getBoundingClientRect();
    const form = element.form;
    const associated = form ? Array.from(deepQueryAll('button,input')).filter(candidate => candidate.form === form) : [];
    const submitter = associated.find(candidate => ['submit','image'].includes(candidate.type));
    const blocksImplicit = candidate => candidate.tagName.toLowerCase() === 'input' && ['text','search','tel','url','email','password','date','month','week','time','datetime-local','number'].includes(candidate.type);
    const implicitSubmission = Boolean(form && blocksImplicit(element) && (submitter ? !submitter.disabled && !submitter.matches(':disabled') : associated.filter(blocksImplicit).length <= 1));
    const formSubmitter = submitter ? { name: nameFor(submitter), tag: submitter.tagName.toLowerCase(), role: roleFor(submitter), type: submitter.type, disabled: submitter.disabled || submitter.matches(':disabled') } : null;
    return { _identityDocument: globalThis.__wdytElementRefs?.get(element) === element.getAttribute('data-decision-feed-ref') ? globalThis.__wdytDocumentId : null, _identityToken: globalThis.__wdytElementTokens?.get(element), name: nameFor(element), tag: element.tagName.toLowerCase(), role: roleFor(element), type: element.type || '', href: element.href || '', x: rect.left + rect.width/2, y: rect.top + rect.height/2, disabled: Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true', implicitSubmission, formMethod: form ? (submitter && submitter.hasAttribute('formmethod') ? submitter.formMethod : form.method).toLowerCase() : undefined, formSubmitter, isContentEditable: element.isContentEditable }; })()""" % ref_json

    for context in ref_contexts(cdp, ref, refresh=refresh):
        try:
            value = evaluate_context(cdp, expression, context)
        except Exception:
            # OOPIF targets can disappear between target enumeration and DOM
            # evaluation. Ignore only that stale context and keep searching the
            # current page's remaining live frames.
            continue
        if value:
            identity_document = value.pop("_identityDocument", None)
            identity_token = value.pop("_identityToken", None)
            if native_identity:
                value.update(accessibility_ref_identity(cdp, context, ref, identity_document, identity_token))
            value["contextId"] = context["contextId"]
            value["frameId"] = context["frameId"]
            value["mainFrame"] = context["main"]
            value["sessionId"] = context.get("sessionId")
            if hasattr(cdp, "reference_routes"): cdp.reference_routes(updates=[{"context":context,"refs":[ref]}])
            DIAGNOSTIC_TARGET = dict(context)
            DIAGNOSTIC_REF = ref
            return value
    # A frame can navigate within an operation. Refresh context handles once;
    # do not retain evidence across controller calls or replay any input.
    return None if refresh else find_ref(cdp, ref, refresh=True, native_identity=native_identity)

def accessibility_ref_identity(cdp, context, ref, document_id=None, identity_token=None):
    # Describing one control must not serialize the entire document and AX
    # tree. Ask Chromium for that node's current native accessible identity.
    session = context.get("sessionId")
    nodes = None
    if document_id and identity_token and hasattr(cdp, "reference_backend"):
        backend = cdp.reference_backend(session, context.get("frameId"), document_id, ref, identity_token)
        if backend is not None:
            try:
                nodes = cdp.command("Accessibility.getPartialAXTree", {"backendNodeId":backend, "fetchRelatives":False}, session_id=session).get("nodes", [])
            except Exception:
                # Addressability can disappear between reads; resolve the live
                # node normally. This retries observation only, never an input.
                pass
    if nodes is None:
        params = {"expression": "(() => {" + SHADOW_HELPERS + "return deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']');})()" % json.dumps(ref), "returnByValue": False}
        if context.get("contextId") is not None:
            params["contextId"] = context["contextId"]
        remote = cdp.command("Runtime.evaluate", params, session_id=session)
        object_id = remote.get("result", {}).get("objectId")
        if not object_id:
            raise RuntimeError("Browser inspection target is stale")
        try:
            nodes = cdp.command("Accessibility.getPartialAXTree", {"objectId": object_id, "fetchRelatives": False}, session_id=session).get("nodes", [])
        finally:
            cdp.command("Runtime.releaseObject", {"objectId": object_id}, session_id=session)
    node = next((node for node in nodes if not node.get("ignored")), None)
    if node is None:
        return {}
    identity = {"role": str(node.get("role", {}).get("value", "")), "name": str(node.get("name", {}).get("value", "")).strip()}
    properties = {item["name"]: item.get("value", {}).get("value") for item in node.get("properties", [])}
    for ax_key, element_key in (("disabled", "disabled"), ("readonly", "readOnly")):
        if ax_key in properties:
            identity[element_key] = properties[ax_key] is True or properties[ax_key] == "true"
    return identity

def dom_ref_map(dom):
    refs = {}
    def visit(node):
        attributes = node.get("attributes", [])
        for index in range(0, len(attributes), 2):
            if attributes[index] == "data-decision-feed-ref":
                refs[node["backendNodeId"]] = attributes[index + 1]
        for child in node.get("children", []) + node.get("shadowRoots", []) + node.get("pseudoElements", []):
            visit(child)
        for key in ("contentDocument", "templateContent"):
            if node.get(key): visit(node[key])
    visit(dom.get("root", {}))
    return refs

def prefetch_accessibility(cdp, observations):
    # DOM snapshots assign identity to actual nodes before this phase. Reuse
    # backend-ID joins only when the document IDs and every current ref agree.
    groups = {}
    for _, context, value in observations:
        session = context.get("sessionId")
        group = groups.setdefault(session, {"sessionId":session, "documents":[], "refs":[], "tokens":{}})
        group["documents"].append((context["frameId"], value.get("documentId")))
        group["refs"].extend(element["ref"] for element in value["elements"])
        group["tokens"].update({element["ref"]:[context["frameId"], element["_refToken"]] for element in value["elements"] if element.get("_refToken")})
    requests = list(groups.values())
    for request in requests: request["documents"] = json.dumps(sorted(request["documents"]))
    cached = cdp.reference_maps(requests) if hasattr(cdp, "reference_maps") else [None] * len(requests)
    commands, keys, observed = [], [], {}
    for _, context, _ in observations:
        session = context.get("sessionId")
        commands.append({"method":"Accessibility.getFullAXTree", "params":{"frameId":context["frameId"]}, "sessionId":session})
        keys.append(("ax", session, context["frameId"]))
    for request, refs in zip(requests, cached):
        session = request["sessionId"]
        if refs is not None:
            observed[("dom", session)] = {"refs":{int(key):value for key,value in refs.items()}}
        else:
            commands.append({"method":"DOM.getDocument", "params":{"depth":-1,"pierce":True}, "sessionId":session})
            keys.append(("dom", session))
    for start in range(0, len(commands), 64):
        results = cdp.read_commands(commands[start:start + 64], settled=True)
        observed.update(zip(keys[start:start + 64], results))
    updates = []
    for request in requests:
        item = observed[("dom", request["sessionId"])]
        if "result" in item:
            refs = dom_ref_map(item.pop("result"))
            item["refs"] = refs
            updates.append({**request, "refs":refs})
    if updates and hasattr(cdp, "reference_maps"): cdp.reference_maps([], updates=updates)
    return observed

def accessibility_identity(cdp, context):
    # Join native AX identities to our stable element refs in two bulk reads.
    # The DOM is used for addressability; Chromium owns accessible names/roles.
    session = context.get("sessionId")
    parameters = {"frameId": context["frameId"]} if context.get("frameId") else {}
    # The native DOM tree covers same-process frames, not just this AX frame.
    # During a snapshot, reuse that one bulk read for every frame in its session.
    cache = getattr(cdp, "snapshot_ref_maps", None)
    refs = cache.get(session) if cache is not None else None
    prefetched = getattr(cdp, "snapshot_native_reads", None)
    if prefetched is not None:
        ax = prefetched[("ax", session, context["frameId"])]
        dom = prefetched[("dom", session)]
        if ax.get("error") or dom.get("error"):
            raise RuntimeError(ax.get("error") or dom.get("error"))
        nodes = ax["result"].get("nodes", [])
        refs = dom["refs"]
    elif refs is None and hasattr(cdp, "read_commands"):
        ax, dom = cdp.read_commands([
            {"method":"Accessibility.getFullAXTree", "params":parameters},
            {"method":"DOM.getDocument", "params":{"depth":-1,"pierce":True}},
        ], session_id=session)
        nodes = ax.get("nodes", [])
    else:
        nodes = cdp.command("Accessibility.getFullAXTree", parameters, session_id=session).get("nodes", [])
        dom = None
        if refs is None:
            try:
                dom = cdp.command("DOM.getDocument", {"depth":-1,"pierce":True}, session_id=session)
            finally:
                cdp.command("DOM.disable", session_id=session)
    if refs is None:
        refs = dom_ref_map(dom)
        if cache is not None:
            cache[session] = refs
    identities = {}
    ref_nodes = {}
    for node in nodes:
        ref = refs.get(node.get("backendDOMNodeId"))
        if ref and not node.get("ignored"):
            if ref in ref_nodes:
                ref_nodes[ref].pop("controlRef", None)
            ref_nodes[ref] = node
            node["controlRef"] = ref
            identities[ref] = {"role": str(node.get("role", {}).get("value", "")), "name": str(node.get("name", {}).get("value", "")).strip()}
            properties = {item["name"]: item.get("value", {}).get("value") for item in node.get("properties", [])}
            for ax_key, element_key in (("disabled", "disabled"), ("readonly", "readOnly")):
                if ax_key in properties:
                    identities[ref][element_key] = properties[ax_key] is True or properties[ax_key] == "true"
    return nodes, identities

def accessibility_rows(nodes, frame_index, redacted_refs=None):
    # Structured, value-free AX rows. Only the already-redacted DOM observation
    # may contribute field values when the model-facing tree is formatted.
    by_id = {node["nodeId"]: node for node in nodes}
    rows = []
    redacted_refs = redacted_refs or set()
    def visit(node, parent_id=None):
        role = str(node.get("role", {}).get("value", ""))
        ref = node.get("controlRef")
        ignored = node.get("ignored") or role in ("none", "InlineTextBox")
        if not ignored:
            node_id = ref or "n%d_%s" % (frame_index, node.get("backendDOMNodeId", node["nodeId"]))
            row = {"id": node_id, "parentId": parent_id, "role": role, "name": str(node.get("name", {}).get("value", "")).strip()}
            if ref:
                row["ref"] = ref
            properties = {item["name"]: item.get("value", {}).get("value") for item in node.get("properties", [])}
            for key in ("focused", "disabled", "readonly", "required", "expanded", "selected", "checked"):
                value = properties.get(key)
                if value is True or value == "true":
                    row[key] = True
                elif value is False or value == "false":
                    row[key] = False
                elif key == "checked" and value == "mixed":
                    row[key] = "mixed"
            if isinstance(properties.get("level"), (int, float)):
                row["level"] = properties["level"]
            rows.append(row)
            parent_id = node_id
        # AX descendants can echo typed values. Keep them out of both text and
        # structured trees; safe non-secret values come from the DOM fields.
        if role in ("textbox", "searchbox") or ref in redacted_refs:
            return
        for child_id in node.get("childIds", []):
            child = by_id.get(child_id)
            if child:
                visit(child, parent_id)
    if nodes:
        visit(nodes[0])
    return rows

def accessibility_text(cdp, context, root_backend_id=None, nodes=None):
    parameters = {"frameId": context["frameId"]} if context.get("frameId") else {}
    if nodes is None:
        nodes = cdp.command("Accessibility.getFullAXTree", parameters, session_id=context.get("sessionId")).get("nodes", [])
    by_id = {node["nodeId"]: node for node in nodes}
    lines = []
    def visit(node, depth=0):
        role = node.get("role", {}).get("value", "")
        name = str(node.get("name", {}).get("value", "")).strip()
        ignored = node.get("ignored") or role in ("none", "InlineTextBox", "RootWebArea")
        if not ignored and (name or role not in ("generic", "StaticText")):
            properties = {item["name"]: item.get("value", {}).get("value") for item in node.get("properties", [])}
            states = "".join(" [" + key + "]" for key in ("selected", "checked", "expanded", "disabled", "required") if properties.get(key) is True or properties.get(key) == "true")
            if properties.get("checked") == "mixed":
                states += " [checked=mixed]"
            if properties.get("readonly") is True:
                states += " [readonly]"
            level = properties.get("level")
            if role == "heading" and level:
                states += " [level=" + str(level) + "]"
            # Never include editable AX values: secure field values must stay out of model input.
            line = "  " * min(depth, 12) + "- " + role + (" " + json.dumps(name, ensure_ascii=False) if name else "") + states
            lines.append(line)
            depth += 1
        if role in ("textbox", "searchbox"):
            return
        for child_id in node.get("childIds", []):
            child = by_id.get(child_id)
            if child:
                visit(child, depth)
    if nodes:
        root = next((node for node in nodes if node.get("backendDOMNodeId") == root_backend_id), None) if root_backend_id else nodes[0]
        if root:
            visit(root)
    return "\n".join(lines)

def recover_missing_hosted_fields(cdp):
    live = BROWSER_STATE.get("live", {}).get(CURRENT_TARGET_KEY, {})
    if live.get("control") and live.get("expiresAt", 0) > time.time():
        return None
    try:
        return evaluate(cdp, ${JSON.stringify(HOSTED_FIELD_RECOVERY_EXPRESSION)})
    except Exception:
        # Checkout recovery must not prevent observation of the actual page.
        return None

def snapshot(cdp):
    # A single shared read budget; inputs are never retried by this wrapper.
    # Transport/rendering overhead outside observation is measured separately.
    if not hasattr(cdp, "command"): return recover_observation(cdp, lambda: snapshot_once(cdp))
    deadline = time.monotonic() + 3.0
    had_command_override = "command" in vars(cdp)
    had_reads_override = "read_commands" in vars(cdp)
    original_command = cdp.command
    original_reads = getattr(cdp, "read_commands", None)
    def bounded(call, *args, **kwargs):
        remaining = deadline - time.monotonic()
        if remaining <= 0: raise RuntimeError("Snapshot observation budget exhausted")
        kwargs["timeout"] = min(kwargs.get("timeout", 20), remaining)
        try: return call(*args, **kwargs)
        except Exception as error:
            if time.monotonic() >= deadline: raise RuntimeError("Snapshot observation budget exhausted") from error
            raise
    cdp.command = lambda *args, **kwargs: bounded(original_command, *args, **kwargs)
    if original_reads: cdp.read_commands = lambda *args, **kwargs: bounded(original_reads, *args, **kwargs)
    cdp.snapshot_deadline = deadline
    try: return recover_observation(cdp, lambda: snapshot_once(cdp))
    finally:
        if had_command_override: cdp.command = original_command
        else: del cdp.command
        if original_reads:
            if had_reads_override: cdp.read_commands = original_reads
            else: del cdp.read_commands
        cdp.snapshot_deadline = None

def snapshot_dom(cdp, expression, context):
    if not globals().get("DIAGNOSTICS_ENABLED", False):
        return evaluate_context(cdp, expression, context)
    started = time.monotonic()
    timed = "(() => { const started = performance.now(); const value = (" + expression + "); return {value,rendererMs:performance.now()-started}; })()"
    result = evaluate_context(cdp, timed, context)
    elapsed = (time.monotonic() - started) * 1000
    if len(BROWSER_PHASE_SPANS) < 80:
        BROWSER_PHASE_SPANS.append({"name":"snapshot_dom_renderer","durationMs":round(float(result.get("rendererMs") or 0),3),"mainFrame":context.get("main") is True})
        BROWSER_PHASE_SPANS.append({"name":"snapshot_dom_transport","durationMs":round(elapsed,3),"mainFrame":context.get("main") is True})
    return result["value"]

def snapshot_once(cdp):
    cdp.snapshot_native_reads = None
    status=cdp.observations() if hasattr(cdp,'observations') else {}
    if status.get('dialog'):
        dialog=status['dialog']
        return {'title':'JavaScript dialog','url':dialog.get('url',''),'text':'Browser dialog: '+json.dumps(dialog),'elements':[],'axTree':[],'activeModalCount':1,'dialog':dialog}
    cdp.frame_context_cache = None
    recovery = recover_missing_hosted_fields(cdp)
    if recovery and recovery.get("attempted") and not recovery.get("failed"):
        time.sleep(0.25)
    contexts = frame_contexts(cdp)
    if not contexts:
        raise RuntimeError("The cloud browser could not produce a DOM snapshot")
    merged = {"title": "", "url": "about:blank", "text": "", "elements": [], "axTree": [], "warnings": [], "activeModalCount": 0}
    text_parts = list(dict.fromkeys(getattr(cdp, "frame_context_warnings", [])))
    if recovery and recovery.get("attempted"):
        text_parts.append("[Attempted recovery of missing credit-card inputs. Verify exposed fields before entering payment details.]" if not recovery.get("failed") else "[Credit-card input recovery failed. Payment fields remain unavailable.]")
    merged["warnings"] = list(text_parts)
    secure_ref_set = set()
    document_ids = []
    observations = []
    next_ref = 0  # The main-frame snapshot reads its counter in the same evaluation.
    for frame_index, context in enumerate(contexts):
        if not context["main"] and getattr(cdp, "snapshot_deadline", None) and time.monotonic() > cdp.snapshot_deadline - 0.75:
            merged["warnings"].append("[Child-frame observation deferred; inspect the frame before relying on absent controls.]")
            break
        expression = SNAPSHOT_EXPRESSION.replace("__REF_START__", str(next_ref))
        if globals().get("DIAGNOSTICS_ENABLED", False):
            expression = "(" + DIAGNOSTIC_EXPRESSION + "," + expression + ")"
        try:
            value = snapshot_dom(cdp, expression, context)
        except Exception:
            if context["main"]: raise
            merged["warnings"].append("[A frame could not be observed; inspect again before relying on absent controls.]")
            continue
        if not isinstance(value, dict) or not isinstance(value.get("elements"), list):
            if context["main"]: raise RuntimeError("The main frame returned an incomplete DOM snapshot")
            merged["warnings"].append("[A frame returned an incomplete observation; inspect again before relying on absent controls.]")
            continue
        next_ref = max(next_ref, int(value.get("nextRef") or next_ref))
        observations.append((frame_index, context, value))
    if hasattr(cdp, "reference_routes"):
        cdp.reference_routes(updates=[{"context":context,"refs":[e["ref"] for e in value["elements"]]} for _,context,value in observations])
    # Assign refs in every frame before joining them to native AX nodes. A
    # shared DOM snapshot taken earlier would miss newly assigned child refs.
    cdp.snapshot_ref_maps = {}
    if hasattr(cdp, "read_commands"):
        try:
            cdp.snapshot_native_reads = prefetch_accessibility(cdp, observations)
        except Exception:
            # A failed read-only transport may still yield individual frames.
            # Preserve the established per-frame warnings and recovery path.
            cdp.snapshot_native_reads = None
    for frame_index, context, value in observations:
        if value.get("documentId"):
            document_ids.append((str(context.get("frameId", frame_index)), str(value["documentId"])))
        if context["main"]:
            merged["title"] = value.get("title") or ""
            merged["url"] = value.get("url") or "about:blank"
            merged["documentId"] = value.get("documentId")
        if value.get("focusedRef"):
            merged["focusedRef"] = value["focusedRef"]
        try:
            ax_nodes, identities = accessibility_identity(cdp, context)
            for element in value["elements"]:
                element.pop("_refToken", None)
                element.update(identities.get(element["ref"], {}))
            frame_text = accessibility_text(cdp, context, nodes=ax_nodes)
            merged["axTree"].extend(accessibility_rows(ax_nodes, frame_index, {element["ref"] for element in value["elements"] if element.get("valueRedacted")}))
        except Exception:
            frame_text = "[Accessibility tree unavailable for this frame; inspect its exposed controls or screenshot.]"
            # Keep freshly observed controls usable if a slow AX renderer
            # exhausts the budget. Never include editable values in this text.
            merged["axTree"].extend({"role":e["role"],"name":e["name"],"ref":e["ref"],"id":e["ref"]} for e in value["elements"])
            merged["warnings"].append(frame_text)
        if isinstance(frame_text, str) and frame_text and frame_text not in text_parts:
            text_parts.append(frame_text)
        for element in value["elements"]: element.pop("_refToken", None)
        merged["elements"].extend(value["elements"])
        merged["activeModalCount"] += int(value.get("activeModalCount") or 0)
    if getattr(cdp, "snapshot_deadline", None) and time.monotonic() >= cdp.snapshot_deadline:
        # Fail closed on values when the final redaction verification cannot
        # run. The control identities remain available for a fresh exact read.
        for element in merged["elements"]:
            if "value" in element: element.pop("value", None); element["valueRedacted"] = True
        secret_checks = []
    else:
        secret_checks = observe_frame_values(cdp, "secret_refs", [context for _, context, _ in observations], next_ref)
    for (_, context, _), check in zip(observations, secret_checks):
        if "error" in check:
            if "Snapshot observation budget exhausted" in check["error"]:
                for element in merged["elements"]:
                    if "value" in element: element.pop("value", None); element["valueRedacted"] = True
            elif context["main"]: raise RuntimeError(check["error"])
            continue
        if isinstance(check.get("value"), list):
            secure_ref_set.update(check["value"])
    cdp.snapshot_ref_maps = None
    cdp.snapshot_native_reads = None
    if not merged["title"] and contexts:
        merged["title"] = "Untitled"
    if document_ids:
        # Child-frame navigation also invalidates any prior diff baseline.
        merged["documentId"] = hashlib.sha256(json.dumps(sorted(document_ids)).encode("utf-8")).hexdigest()
    merged["text"] = "\n\n".join(text_parts)
    for element in merged["elements"]:
        if element.get("ref") in secure_ref_set:
            element.pop("value", None)
            element["valueRedacted"] = True
    return merged

def describe(cdp, ref):
    value = find_ref(cdp, ref)
    if not value:
        raise RuntimeError("Browser element %s is stale; inspect the page again" % ref)
    return value

def preflight_ref(cdp, ref, full_page=True):
    # Preserve describe -> fresh snapshot -> describe, within one controller RPC.
    original = describe(cdp, ref)
    if not full_page:
        # Routine input needs current target semantics and page identity, not
        # another full AX/DOM scan of every frame before the action's own scan.
        identity = evaluate(cdp, "({url:location.href,title:document.title})")
        return {"page": {**identity, "text": "", "elements": [{**original, "ref": ref}], "scopeRef": ref}, "element": original}
    page = snapshot(cdp)
    if not any(element.get("ref") == ref for element in page["elements"]):
        raise RuntimeError("Stale browser reference. Inspect the current page before acting.")
    element = describe(cdp, ref)
    if any(original.get(key) != element.get(key) for key in ("name", "tag", "type", "href")):
        raise RuntimeError("Browser reference changed while inspecting. Read a fresh snapshot and choose the intended control again.")
    return {"page": page, "element": element}

def inspect_ref(cdp, ref):
    return recover_observation(cdp, lambda: inspect_ref_once(cdp, ref))

def inspect_ref_once(cdp, ref):
    element = describe(cdp, ref)
    contexts = frame_contexts(cdp)
    next_ref = frame_reference_counter(cdp, contexts)
    root = "deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']')" % json.dumps(ref)
    expression = SNAPSHOT_EXPRESSION.replace("const observationRoot = document;", "const observationRoot = " + root + "; if (!observationRoot) throw new Error('Stale inspection target');").replace("__REF_START__", str(next_ref))
    page = evaluate_context(cdp, expression, element)
    if not element.get("mainFrame"):
        main = next((context for context in contexts if context.get("main")), None)
        if main:
            page.update(evaluate_context(cdp, "({title:document.title,url:location.href})", main))
    next_ref = max(next_ref, int(page.get("nextRef") or 0))
    for context in contexts:
        evaluate_context(cdp, 'globalThis.__wdytRefCounter=' + str(next_ref), context)
    params = {"expression": "(() => {" + SHADOW_HELPERS + "return " + root + ";})()", "returnByValue": False}
    if element.get("contextId") is not None:
        params["contextId"] = element["contextId"]
    remote = cdp.command("Runtime.evaluate", params, session_id=element.get("sessionId"))
    object_id = remote.get("result", {}).get("objectId")
    if not object_id:
        raise RuntimeError("Browser inspection target is stale")
    try:
        nodes = cdp.command("Accessibility.queryAXTree", {"objectId": object_id}, session_id=element.get("sessionId")).get("nodes", [])
        # Join native identities using only this subtree, including shadow roots.
        # Never serialize unrelated frames or the full document for a scoped read.
        tree = cdp.command("DOM.describeNode", {"objectId": object_id, "depth": -1, "pierce": True}, session_id=element.get("sessionId"))["node"]
        refs = {}
        def collect(node):
            attributes = node.get("attributes", [])
            for i in range(0, len(attributes), 2):
                if attributes[i] == "data-decision-feed-ref": refs[node["backendNodeId"]] = attributes[i + 1]
            for child in node.get("children", []) + node.get("shadowRoots", []): collect(child)
            if node.get("contentDocument"): collect(node["contentDocument"])
        collect(tree)
        elements = {candidate["ref"]: candidate for candidate in page["elements"]}
        for node in nodes:
            control_ref = refs.get(node.get("backendDOMNodeId"))
            if control_ref in elements and not node.get("ignored"):
                node["controlRef"] = control_ref
                elements[control_ref].update({"role": str(node.get("role", {}).get("value", "")), "name": str(node.get("name", {}).get("value", "")).strip()})
        page["text"] = accessibility_text(cdp, element, root_backend_id=tree["backendNodeId"], nodes=nodes)
        page["axTree"] = accessibility_rows(nodes, 0, {candidate["ref"] for candidate in page["elements"] if candidate.get("valueRedacted")})
    finally:
        cdp.command("Runtime.releaseObject", {"objectId": object_id}, session_id=element.get("sessionId"))
    for candidate in page["elements"]:
        candidate.pop("_refToken", None)
        candidate.update({key: element[key] for key in ("frameId", "contextId", "sessionId", "mainFrame") if key in element})
    page["scopeRef"] = ref
    return page

def wait_for_target(cdp, target, state, timeout_ms):
    deadline = time.monotonic() + min(20000, max(100, timeout_ms)) / 1000
    if state not in ("visible", "hidden", "enabled"):
        raise RuntimeError("Unsupported browser wait condition")
    while True:
        page = snapshot(cdp)
        def matches_target(element, requested):
            if isinstance(requested, str):
                return element["ref"] == requested
            if element.get("role") != requested.get("role") or element.get("name") != requested.get("name"):
                return False
            scope = requested.get("within")
            if scope:
                roots = [item for item in page["elements"] if matches_target(item, scope)]
                if len(roots) > 1:
                    raise RuntimeError("Browser scope must match exactly one container")
                return bool(roots and roots[0]["ref"] in element.get("ancestorRefs", []))
            return True
        # A scope must already exist: waiting for a future child inside a stale
        # or invented container can never provide useful readiness evidence.
        scope = target.get("within") if isinstance(target, dict) else None
        if scope:
            roots = [item for item in page["elements"] if matches_target(item, scope)]
            if len(roots) != 1:
                raise RuntimeError("Browser wait scope matched " + str(len(roots)) + " containers. Inspect the whole page and use a current scope; do not repeat this wait.")
        matches = [{"visible": True, "enabled": not element.get("disabled")} for element in page["elements"] if matches_target(element, target)]
        if not matches and state != "hidden" and isinstance(target, dict):
            name = target.get("name", "").strip().casefold()
            candidates = [item for item in page["elements"] if item.get("role") == target.get("role") and (not scope or roots[0]["ref"] in item.get("ancestorRefs", [])) and name and (name in item.get("name", "").casefold() or item.get("name", "").strip().casefold() and item.get("name", "").strip().casefold() in name)]
            if candidates:
                observed = [{"ref": item["ref"], "role": item.get("role"), "name": item.get("name")} for item in candidates[:5]]
                raise RuntimeError("Browser wait target does not match the current name. Observed candidates: " + json.dumps(observed) + ". Inspect and choose the intended exact target; this is not proof the page is still loading.")
        if len(matches) > 1:
            raise RuntimeError("Browser wait target is ambiguous; scope it to one container")
        matched = matches[0] if matches else None
        # Missing controls prove absence only after a complete observation.
        # A failed child-frame read must not satisfy a hidden condition.
        satisfied = (not page.get("warnings") and (not matched or not matched["visible"])) if state == "hidden" else bool(matched and matched["visible"] and (state != "enabled" or matched["enabled"]))
        if satisfied:
            return page
        if time.monotonic() >= deadline:
            raise RuntimeError("Browser wait timed out before target became " + state + ". Inspect the whole page before choosing another wait; a missing target does not prove the page is loading.")
        time.sleep(0.15)

def pointer_click(cdp, mouse, click_count=1, hold_ms=0, session_id=None):
    if isinstance(hold_ms, bool) or not isinstance(hold_ms, int) or not 0 <= hold_ms <= 10000:
        raise RuntimeError("holdMs must be an integer between 0 and 10000")
    if click_count not in (1, 2) or (hold_ms and click_count != 1):
        raise RuntimeError("A hold requires clickCount 1")
    for count in range(1, click_count + 1):
        try:
            cdp.command('Input.dispatchMouseEvent', dict(mouse, type='mousePressed', clickCount=count), session_id=session_id)
            if hold_ms: time.sleep(hold_ms / 1000)
        finally:
            # Also release if the wait or down acknowledgement is interrupted.
            cdp.command('Input.dispatchMouseEvent', dict(mouse, type='mouseReleased', clickCount=count), session_id=session_id)

def press_key(cdp, key):
    keys = {"Enter": ("Enter", "Enter", 13), "Space": (" ", "Space", 32), "Escape": ("Escape", "Escape", 27), "Tab": ("Tab", "Tab", 9), "ArrowUp": ("ArrowUp", "ArrowUp", 38), "ArrowDown": ("ArrowDown", "ArrowDown", 40), "ArrowLeft": ("ArrowLeft", "ArrowLeft", 37), "ArrowRight": ("ArrowRight", "ArrowRight", 39), "Home": ("Home", "Home", 36), "End": ("End", "End", 35), "PageUp": ("PageUp", "PageUp", 33), "PageDown": ("PageDown", "PageDown", 34), "Backspace": ("Backspace", "Backspace", 8), "Delete": ("Delete", "Delete", 46), "ControlOrMeta+A": ("a", "KeyA", 65), "ControlOrMeta+Enter": ("Enter", "Enter", 13), "Shift+Tab": ("Tab", "Tab", 9)}
    keys.update({"Insert":("Insert","Insert",45),"CapsLock":("CapsLock","CapsLock",20),"NumLock":("NumLock","NumLock",144),"PrintScreen":("PrintScreen","PrintScreen",44),"Pause":("Pause","Pause",19),"ContextMenu":("ContextMenu","ContextMenu",93)})
    keys.update({"F"+str(i):("F"+str(i),"F"+str(i),111+i) for i in range(1,25)})
    if isinstance(key,str) and len(key)==1 and key.isprintable() and not re.fullmatch(r"[A-Za-z0-9]",key):
        hide_visual_cursor(cdp)
        cdp.command('Input.dispatchKeyEvent',{'type':'keyDown','key':key,'text':key,'unmodifiedText':key})
        cdp.command('Input.dispatchKeyEvent',{'type':'keyUp','key':key})
        return
    if key not in keys and re.fullmatch(r"[A-Za-z0-9]{1,32}", key):
        hide_visual_cursor(cdp)
        for character in key:
            letter = character.isalpha()
            params = {"key": character, "code": ("Key" + character.upper()) if letter else ("Digit" + character), "windowsVirtualKeyCode": ord(character.upper()), "modifiers": 8 if letter and character.isupper() else 0}
            cdp.command("Input.dispatchKeyEvent", dict(params, type="keyDown", text=character))
            cdp.command("Input.dispatchKeyEvent", dict(params, type="keyUp"))
        return
    parts=key.split('+');base=parts[-1];modifiers=0
    for modifier in parts[:-1]:
        if modifier not in ('ControlOrMeta','Control','Meta','Shift','Alt'): raise RuntimeError('Unsupported keyboard modifier')
        modifiers |= {'ControlOrMeta':4 if sys.platform=='darwin' else 2,'Control':2,'Meta':4,'Shift':8,'Alt':1}[modifier]
    if base in keys: name,code,virtual=keys[base]
    elif re.fullmatch(r'[A-Za-z0-9]',base): name,code,virtual=(base.lower() if not modifiers & 8 else base.upper()),('Key'+base.upper() if base.isalpha() else 'Digit'+base),ord(base.upper())
    elif len(base)==1 and base.isprintable(): name,code,virtual=base,'',min(ord(base),255)
    else: raise RuntimeError('Unsupported browser key')
    params={"key":name,"code":code,"windowsVirtualKeyCode":virtual,"modifiers":modifiers}
    if modifiers & (2|4) and base.lower()=='a': params['commands']=['selectAll']
    if not modifiers and base in ('Enter','Space'): params['text']='\r' if base=='Enter' else ' '
    hide_visual_cursor(cdp)
    held=[];active=0
    for flag,name,code,virtual in [(1,'Alt','AltLeft',18),(2,'Control','ControlLeft',17),(4,'Meta','MetaLeft',91),(8,'Shift','ShiftLeft',16)]:
        if modifiers & flag:
            active |= flag
            held.append((flag,name,code,virtual))
            cdp.command('Input.dispatchKeyEvent',{'type':'rawKeyDown','key':name,'code':code,'windowsVirtualKeyCode':virtual,'modifiers':active})
    try:
        cdp.command('Input.dispatchKeyEvent',dict(params,type='keyDown'))
        params.pop('text',None); params.pop('commands',None)
        cdp.command('Input.dispatchKeyEvent',dict(params,type='keyUp'))
    finally:
        for flag,name,code,virtual in reversed(held):
            active &= ~flag
            cdp.command('Input.dispatchKeyEvent',{'type':'keyUp','key':name,'code':code,'windowsVirtualKeyCode':virtual,'modifiers':active})

def wait_for_input_ready(cdp, ref, pointer=True, timeout=3):
    # Mechanical readiness only: no URL, order, or approval-evidence comparison.
    # Retry observations before input, never a click that has been dispatched.
    deadline = time.monotonic() + timeout
    previous = None
    state = None
    while True:
        frame_blocked = False
        try:
            # Poll only mechanical state. Fetch the fresh native identity once
            # below, after stability/visibility/hit-testing and frame checks pass.
            element = find_ref(cdp, ref, native_identity=False)
            if not element:
                raise RuntimeError("Target detached")
        except RuntimeError:
            raise PreDispatchError("Target " + ref + " is stale or detached; no input was dispatched. Refresh the page observation and choose the current intended control; do not reuse this ref.")
        state = evaluate(cdp, """(() => {
          const e=deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']');
          if (!e) return null;
          e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
          const r=e.getBoundingClientRect(), style=getComputedStyle(e);
          const hit=deepElementFromPoint(r.left+r.width/2,r.top+r.height/2);
          return {rect:[r.x,r.y,r.width,r.height],enabled:!e.matches(':disabled') && !e.closest('[aria-disabled="true"]'),visible:r.width>0 && r.height>0 && style.visibility!=='hidden',receivesInput:Boolean(hit && (hit===e || composedContains(e,hit))),blocker:hit && hit!==e && !composedContains(e,hit) ? {tag:hit.tagName,ref:hit.getAttribute('data-decision-feed-ref'),role:hit.getAttribute('role'),label:(hit.getAttribute('aria-label') || hit.getAttribute('title') || '').slice(0,120)} : null};
        })()""" % json.dumps(ref), element["contextId"], element.get("sessionId"))
        rect = state.get("rect") if isinstance(state, dict) else None
        stable = previous is not None and rect is not None and all(abs(a-b) <= 0.5 for a,b in zip(previous,rect))
        if state and state.get("enabled") and state.get("visible") and stable and (not pointer or state.get("receivesInput")):
            try:
                if pointer:
                    assert_frame_uncovered(cdp, element)
                return describe(cdp, ref)
            except RuntimeError:
                frame_blocked = True
        previous = rect
        if time.monotonic() >= deadline:
            reason = "detached" if not state else "hidden" if not state.get("visible") else "disabled" if not state.get("enabled") else "moving" if not stable else "frame_covered" if frame_blocked else "covered"
            detail = {"targetRef":ref,"reason":reason,"rect":rect,"blocker":state.get("blocker") if state else None}
            recovery = {"detached":"Refresh the observation and select the current control.", "hidden":"The old target is hidden. Find the visible replacement in a fresh observation; do not keep waiting on this ref.", "disabled":"Inspect required selections or validation before retrying.", "moving":"Wait for a specific layout change to settle before retrying.", "frame_covered":"Inspect the parent page for the overlay covering this frame.", "covered":"Inspect the reported blocker and dismiss it only if appropriate, then verify the intended target is exposed."}[reason]
            raise PreDispatchError("Browser input blocked; no input was dispatched. " + json.dumps(detail,separators=(",",":")) + " " + recovery)
        time.sleep(0.08)

def ready(cdp, timeout=20):
    if hasattr(cdp,'observations') and cdp.observations().get('dialog'): return
    started = time.time()
    while time.time() - started < timeout:
        state = evaluate(cdp, "document.readyState")
        if state in ("complete", "interactive"):
            return
        time.sleep(0.15)
    raise RuntimeError("The page did not become interactive before the browser timeout")

def snapshot_signature(value):
    elements = []
    for element in value.get("elements", []) if isinstance(value, dict) else []:
        if not isinstance(element, dict):
            continue
        elements.append([
            element.get("tag"), element.get("role"), element.get("name"), element.get("type"),
            element.get("href"), element.get("disabled"), element.get("checked"),
            element.get("valid"), element.get("validationMessage"), element.get("ariaInvalid"),
        ])
    semantic = {
        "title": value.get("title") if isinstance(value, dict) else "",
        "url": value.get("url") if isinstance(value, dict) else "",
        "text": value.get("text") if isinstance(value, dict) else "",
        "elements": elements,
        "activeModalCount": value.get("activeModalCount") if isinstance(value, dict) else 0,
    }
    return hashlib.sha256(json.dumps(semantic, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

def validation_errors(value):
    errors = {}
    for element in value.get("elements", []) if isinstance(value, dict) else []:
        if not isinstance(element, dict) or not (element.get("valid") is False or element.get("ariaInvalid") is True):
            continue
        name = str(element.get("name") or element.get("type") or element.get("tag") or "field").strip()[:120]
        message = str(element.get("validationMessage") or "Invalid value").strip()[:240]
        key = (name.lower(), message.lower())
        errors[key] = {"field": name, "message": message}
    return errors

def public_event_url(value):
    try:
        parsed = urllib.parse.urlsplit(str(value))
        if parsed.scheme not in ("http", "https"):
            return ""
        return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))[:500]
    except Exception:
        return ""

def observe_click_outcome(cdp, before, timeout=10):
    started = time.monotonic()
    deadline = started + max(1, min(15, timeout))
    before_signature = snapshot_signature(before)
    before_errors = validation_errors(before)
    latest = before
    latest_signature = before_signature
    last_dom_change = started
    last_relevant_event = started
    page_changed = False
    navigation_observed = False
    load_observed = False
    requests = {}

    while time.monotonic() < deadline:
        cdp.pump_events(0.12)
        for event in cdp.take_events():
            method = event.get("method")
            params = event.get("params") if isinstance(event.get("params"), dict) else {}
            if method == "Network.requestWillBeSent":
                request = params.get("request") if isinstance(params.get("request"), dict) else {}
                request_method = str(request.get("method") or "GET").upper()
                request_url = public_event_url(request.get("url"))
                if request_method not in ("GET", "HEAD", "OPTIONS") and request_url:
                    request_id = str(params.get("requestId") or "")
                    requests[request_id] = {"method": request_method, "url": request_url, "status": None, "finished": False, "failed": False}
                    last_relevant_event = time.monotonic()
            elif method == "Network.responseReceived":
                request_id = str(params.get("requestId") or "")
                if request_id in requests:
                    response = params.get("response") if isinstance(params.get("response"), dict) else {}
                    status = response.get("status")
                    requests[request_id]["status"] = int(status) if isinstance(status, (int, float)) else None
                    last_relevant_event = time.monotonic()
            elif method in ("Network.loadingFinished", "Network.loadingFailed"):
                request_id = str(params.get("requestId") or "")
                if request_id in requests:
                    requests[request_id]["finished"] = True
                    requests[request_id]["failed"] = method == "Network.loadingFailed"
                    last_relevant_event = time.monotonic()
            elif method == "Page.frameNavigated":
                frame = params.get("frame") if isinstance(params.get("frame"), dict) else {}
                if not frame.get("parentId"):
                    navigation_observed = True
                    last_relevant_event = time.monotonic()
            elif method == "Page.loadEventFired":
                load_observed = True
                last_relevant_event = time.monotonic()

        try:
            current = snapshot(cdp)
            signature = snapshot_signature(current)
            if signature != latest_signature:
                latest_signature = signature
                last_dom_change = time.monotonic()
            latest = current
            page_changed = page_changed or signature != before_signature
        except Exception:
            pass

        now = time.monotonic()
        stable_for = now - last_dom_change
        quiet_for = now - last_relevant_event
        current_errors = validation_errors(latest)
        fresh_errors = [value for key, value in current_errors.items() if key not in before_errors]
        mutation_values = list(requests.values())
        mutations_finished = bool(mutation_values) and all(value.get("finished") or value.get("failed") for value in mutation_values)
        successful_mutation = any(isinstance(value.get("status"), int) and 200 <= value["status"] < 400 and not value.get("failed") for value in mutation_values)
        failed_mutations = bool(mutation_values) and mutations_finished and not successful_mutation and any(value.get("failed") or (isinstance(value.get("status"), int) and value["status"] >= 400) for value in mutation_values)

        state = None
        reason = None
        if fresh_errors and stable_for >= 0.4:
            state, reason = "failed", "fresh_validation_error"
        elif failed_mutations and stable_for >= 0.5 and quiet_for >= 0.5:
            state, reason = "failed", "mutation_request_failed"
        elif navigation_observed and load_observed and stable_for >= 0.5 and quiet_for >= 0.5:
            state, reason = "settled", "navigation_settled"
        elif mutations_finished and successful_mutation and stable_for >= 0.6 and quiet_for >= 0.6:
            state, reason = "settled", "mutation_response_settled"
        elif page_changed and stable_for >= 0.8 and quiet_for >= 0.6 and now - started >= 1.0:
            state, reason = "settled", "page_change_settled"

        if state:
            latest["outcomeObservation"] = {
                "state": state,
                "reason": reason,
                "elapsedMs": int((now - started) * 1000),
                "navigationObserved": navigation_observed,
                "pageChanged": page_changed,
                "preexistingValidationErrorCount": len(before_errors),
                "freshValidationErrors": fresh_errors[:10],
                "mutationRequests": mutation_values[:20],
            }
            return latest
        time.sleep(0.08)

    try:
        latest = snapshot(cdp)
    except Exception:
        pass
    current_errors = validation_errors(latest)
    latest["outcomeObservation"] = {
        "state": "unknown",
        "reason": "observation_timeout",
        "elapsedMs": int((time.monotonic() - started) * 1000),
        "navigationObserved": navigation_observed,
        "pageChanged": page_changed,
        "preexistingValidationErrorCount": len(before_errors),
        "freshValidationErrors": [value for key, value in current_errors.items() if key not in before_errors][:10],
        "mutationRequests": list(requests.values())[:20],
    }
    return latest

def secret_key_path(token):
    if not isinstance(token, str) or len(token) != 32 or any(character not in "0123456789abcdef" for character in token):
        raise RuntimeError("Invalid device vault recipient token")
    os.makedirs(SECRET_KEY_DIR, mode=0o700, exist_ok=True)
    return SECRET_KEY_DIR + "/" + token + ".pem"

def secret_scope():
    return {"generation": BROWSER_STATE.get("generation"), "target": CURRENT_TARGET_KEY, "targetId": read_target_id(target_path(CURRENT_TARGET_KEY))}

def secret_recipient(token):
    private_path = secret_key_path(token)
    if not os.path.exists(private_path):
        subprocess.run([
            "openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:3072", "-out", private_path,
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.chmod(private_path, 0o600)
        private_json(private_path + ".scope", secret_scope())
    with open(private_path + ".scope", encoding="utf-8") as handle:
        if json.load(handle) != secret_scope():
            raise RuntimeError("The vault recipient belongs to a different browser tab")
    public = subprocess.run([
        "openssl", "rsa", "-in", private_path, "-RSAPublicKey_out", "-outform", "DER",
    ], check=True, capture_output=True).stdout
    return {"token": token, "algorithm": "RSA-OAEP-256+A256GCM", "publicKey": base64.b64encode(public).decode("ascii")}

def decrypt_device_envelope(cdp, token, envelope):
    private_path = secret_key_path(token)
    if not os.path.exists(private_path):
        raise RuntimeError("The one-time device vault recipient has expired")
    with open(private_path + ".scope", encoding="utf-8") as handle:
        scope = json.load(handle)
    if scope != secret_scope():
        raise RuntimeError("The vault approval belongs to a different browser session")
    if not isinstance(envelope, dict) or not isinstance(envelope.get("encryptedKey"), str) or not isinstance(envelope.get("sealed"), str):
        raise RuntimeError("The device vault envelope is invalid")
    encrypted_key = base64.b64decode(envelope["encryptedKey"], validate=True)
    result = subprocess.run([
        "openssl", "pkeyutl", "-decrypt", "-inkey", private_path,
        "-pkeyopt", "rsa_padding_mode:oaep", "-pkeyopt", "rsa_oaep_md:sha256", "-pkeyopt", "rsa_mgf1_md:sha256",
    ], input=encrypted_key, capture_output=True)
    if result.returncode != 0 or len(result.stdout) != 32:
        raise RuntimeError("The device vault envelope could not be opened")
    key_b64 = base64.b64encode(result.stdout).decode("ascii")
    sealed_b64 = envelope["sealed"]
    expression = """(async () => {
      const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
      const key = await crypto.subtle.importKey('raw', decode(%s), {name:'AES-GCM'}, false, ['decrypt']);
      const sealed = decode(%s);
      if (sealed.length < 29) throw new Error('invalid envelope');
      const clear = await crypto.subtle.decrypt({name:'AES-GCM', iv:sealed.slice(0,12), tagLength:128}, key, sealed.slice(12));
      return JSON.parse(new TextDecoder().decode(clear));
    })()""" % (json.dumps(key_b64), json.dumps(sealed_b64))
    frame_tree = cdp.command("Page.getFrameTree")
    frame_id = frame_tree.get("frameTree", {}).get("frame", {}).get("id")
    if not frame_id:
        raise RuntimeError("The secure browser frame is unavailable")
    world = cdp.command("Page.createIsolatedWorld", {"frameId": frame_id, "worldName": "decision-feed-device-vault", "grantUniveralAccess": False})
    value = evaluate(cdp, expression, world.get("executionContextId"))
    if not isinstance(value, dict):
        raise RuntimeError("The device vault payload is invalid")
    return value

def assert_frame_uncovered(cdp, element):
    # Sending pointer input directly to an OOPIF bypasses the parent's hit
    # testing. Verify the exact point through every owning iframe first.
    if element.get("mainFrame"):
        return
    contexts = {context["frameId"]: context for context in frame_contexts(cdp)}
    current = contexts.get(element.get("frameId"))
    if not current:
        raise RuntimeError("Browser target frame is unavailable; inspect the page")
    point = {"x": element["x"], "y": element["y"]}
    seen = set()
    while current and not current.get("main"):
        if current["frameId"] in seen:
            raise RuntimeError("Browser frame ancestry could not be verified")
        seen.add(current["frameId"])
        parent = contexts.get(current.get("parentFrameId"))
        if not parent:
            raise RuntimeError("Browser frame parent is unavailable; inspect the page")
        session = parent.get("sessionId")
        owner = cdp.command("DOM.getFrameOwner", {"frameId": current["frameId"]}, session_id=session)
        params = {"backendNodeId": owner["backendNodeId"]}
        if parent.get("contextId") is not None:
            params["executionContextId"] = parent["contextId"]
        remote = cdp.command("DOM.resolveNode", params, session_id=session)
        object_id = remote["object"]["objectId"]
        try:
            function = "function(point) {" + SHADOW_HELPERS + """
              this.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
              const r=this.getBoundingClientRect();
              const x=r.left+(this.clientLeft+point.x)*r.width/this.offsetWidth;
              const y=r.top+(this.clientTop+point.y)*r.height/this.offsetHeight;
              const hit=deepElementFromPoint(x,y);
              return {x,y,uncovered:r.width>1 && r.height>1 && hit===this};
            }"""
            result = cdp.command("Runtime.callFunctionOn", {"objectId": object_id, "functionDeclaration": function, "arguments": [{"value": point}], "returnByValue": True}, session_id=session)
            point = result.get("result", {}).get("value") or {}
            if not point.get("uncovered"):
                raise RuntimeError("Browser target iframe is covered or not visible; inspect the page and dismiss the blocker")
        finally:
            cdp.command("Runtime.releaseObject", {"objectId": object_id}, session_id=session)
        current = parent

def focus_secure_target(cdp, ref):
    # The tool explicitly selects one destination. Focus and fill it in the
    # same locked controller operation instead of relying on focus surviving
    # observation, a viewer connection, or a phone unlock between RPCs.
    element = describe(cdp, ref)
    expression = r'''(() => {
      const e = deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']');
      if (!e || !e.matches('input,textarea') || ['button','submit','reset','checkbox','radio','file','hidden','image','range','color'].includes(e.type) || e.disabled || e.readOnly) return false;
      e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      const r=e.getBoundingClientRect(), hit=deepElementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return r.width > 1 && r.height > 1 && Boolean(hit && (hit===e || composedContains(e,hit)));
    })()''' % json.dumps(ref)
    if not evaluate(cdp, expression, element["contextId"], element.get("sessionId")):
        raise RuntimeError("The selected secure field is hidden, covered, disabled, or not editable; inspect the current page")
    current = describe(cdp, ref)
    if any(current.get(key) != element.get(key) for key in ("frameId", "contextId", "name", "tag", "type")):
        raise RuntimeError("The selected secure field changed before entry; inspect the current page")
    assert_frame_uncovered(cdp, current)
    visual_cursor(cdp, current)
    if current.get("mainFrame") or current.get("sessionId"):
        for event in ("mousePressed", "mouseReleased"):
            cdp.command("Input.dispatchMouseEvent", {"type": event, "x": current["x"], "y": current["y"], "button": "left", "clickCount": 1}, session_id=current.get("sessionId"))
    else:
        evaluate(cdp, "deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']').focus()" % json.dumps(ref), current["contextId"], current.get("sessionId"))
    visual_cursor(cdp, click=True)
    return assert_secure_target(cdp, ref, current)

def refocus_secure_target(cdp, ref):
    for attempt in range(3):
        try:
            return focus_secure_target(cdp, ref)
        except SecureTargetFocusLost:
            if attempt == 2:
                raise
            cdp.command("Page.bringToFront")

def assert_secure_target(cdp, ref, element=None):
    element = element or describe(cdp, ref)
    expression = r'''(() => {
      const element = deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']');
      return Boolean(element && element.matches('input,textarea,select') && !['button','submit','reset','checkbox','radio','file','hidden','image','range','color'].includes(element.type) && !element.disabled && !element.readOnly &&
        deepActiveElement() === element && document.hasFocus());
    })()''' % json.dumps(ref)
    if not evaluate(cdp, expression, element["contextId"], element.get("sessionId")):
        state = evaluate(cdp, "(() => { const e=deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']'); return {ref:%s,activeRef:deepActiveElement()?.getAttribute('data-decision-feed-ref'),editable:Boolean(e && e.matches('input,textarea,select') && !['button','submit','reset','checkbox','radio','file','hidden','image','range','color'].includes(e.type)),focused:deepActiveElement()===e,pageFocused:document.hasFocus(),readOnly:e?.readOnly,disabled:e?.disabled}; })()" % (json.dumps(ref), json.dumps(ref)), element["contextId"], element.get("sessionId"))
        if isinstance(state, dict) and state.get("editable") is True and (state.get("focused") is False or state.get("pageFocused") is False) and not state.get("disabled") and not state.get("readOnly"):
            raise SecureTargetFocusLost("The selected secure field lost page focus before typing")
        raise RuntimeError("Click the exact target field before securely typing; its focus changed or it is not editable: " + json.dumps(state))
    return element

def mark_secure_target(cdp, ref):
    element = assert_secure_target(cdp, ref)
    evaluate(cdp, "deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']').setAttribute('data-decision-feed-secret','true')" % json.dumps(ref), element["contextId"], element.get("sessionId"))

def replace_field_text(cdp, ref, text, strategy="keys", require_focused=False):
    if require_focused:
        element = assert_secure_target(cdp, ref)
    else:
        # Fill must establish the same scroll/visibility/hit-test readiness as
        # click. Unscrolled field coordinates can hit a dialog's backdrop and
        # dismiss the form before focus or typing ever occurs.
        element = wait_for_input_ready(cdp, ref, pointer=True)
        ref_json = json.dumps(ref)
        # Activate ordinary main-frame and OOPIF fields through Chrome's real input
        # path. Synthetic DOM activation can run payment-widget click
        # handlers without the trusted pointer sequence those widgets expect.
        pointer_session = element.get("sessionId")
        visual_cursor(cdp, element)
        if element.get("mainFrame") or pointer_session:
            cdp.command("Input.dispatchMouseEvent", {"type": "mousePressed", "x": element["x"], "y": element["y"], "button": "left", "clickCount": 1}, session_id=pointer_session)
            cdp.command("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": element["x"], "y": element["y"], "button": "left", "clickCount": 1}, session_id=pointer_session)
            visual_cursor(cdp, click=True)
        focused = evaluate(cdp, "(() => { const element = deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']'); if (!element) return false; element.focus(); return deepActiveElement() === element; })()" % ref_json, element["contextId"], pointer_session)
        if not focused:
            raise RuntimeError("Browser field could not be focused")
    # Remove immediately before typing; next pointer action recreates the art.
    hide_visual_cursor(cdp)
    if strategy == "insert":
        # Select the chosen field's text directly, then use Chrome's native
        # insertion. This avoids platform-dependent Ctrl/Meta shortcuts and
        # four extra key round trips just to replace a value.
        evaluate(cdp, "deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']').select()" % json.dumps(ref), element["contextId"], element.get("sessionId"))
        if require_focused:
            assert_secure_target(cdp, ref, element)
        cdp.command("Input.insertText", {"text": text})
        return
    cdp.command("Input.dispatchKeyEvent", {"type": "keyDown", "modifiers": 2, "key": "a", "code": "KeyA", "windowsVirtualKeyCode": 65, "nativeVirtualKeyCode": 65})
    cdp.command("Input.dispatchKeyEvent", {"type": "keyUp", "modifiers": 2, "key": "a", "code": "KeyA", "windowsVirtualKeyCode": 65, "nativeVirtualKeyCode": 65})
    if require_focused:
        assert_secure_target(cdp, ref, element)
    cdp.command("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Backspace", "code": "Backspace", "windowsVirtualKeyCode": 8, "nativeVirtualKeyCode": 8})
    cdp.command("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Backspace", "code": "Backspace", "windowsVirtualKeyCode": 8, "nativeVirtualKeyCode": 8})
    # Autocomplete widgets frequently listen to keyboard events rather than a
    # single programmatic text insertion. Type ordinary short form values as a
    # real key sequence so address, location, and product suggestions appear.
    if require_focused:
        assert_secure_target(cdp, ref, element)
    if strategy == "keys" and len(text) <= 512 and not any(character in "\r\n\t" for character in text):
        if not require_focused and hasattr(cdp, "type_keys"):
            cdp.type_keys(text)
            return
        for character in text:
            if require_focused:
                assert_secure_target(cdp, ref, element)
            cdp.command("Input.dispatchKeyEvent", {"type": "keyDown", "key": character, "text": character, "unmodifiedText": character})
            cdp.command("Input.dispatchKeyEvent", {"type": "keyUp", "key": character})
            time.sleep(0.006)
    else:
        cdp.command("Input.insertText", {"text": text})

def controlled_field_text(cdp, ref, text):
    element = assert_secure_target(cdp, ref)
    hide_visual_cursor(cdp)
    ref_json = json.dumps(ref)
    text_json = json.dumps(text)
    expression = r'''(() => {
      const element = deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']');
      if (!element || !('value' in element)) return false;
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
        element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (!setter) return false;
      if (deepActiveElement() !== element || !document.hasFocus()) return false;
      setter.call(element, %s);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: %s, inputType: 'insertText' }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return true;
    })()''' % (ref_json, text_json, text_json)
    return evaluate(cdp, expression, element["contextId"], element.get("sessionId")) is True

def secure_field_state(cdp, ref):
    element = describe(cdp, ref)
    ref_json = json.dumps(ref)
    expression = r'''(() => {
      const element = deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']');
      if (!element || !('value' in element)) return null;
      const tokens = new Set(String(element.className || '').trim().toLowerCase().split(/\s+/).filter(Boolean));
      const semanticInvalid = element.getAttribute('aria-invalid') === 'true' || ['invalid','is-invalid','error','has-error'].some(token => tokens.has(token));
      const semanticValid = !semanticInvalid && ['valid','is-valid'].some(token => tokens.has(token));
      const nativeValid = element.validity ? (!element.willValidate || element.validity.valid) : true;
      return {
        value: String(element.value),
        valid: semanticInvalid ? false : semanticValid ? true : nativeValid,
        nativeValid,
        semanticValidity: semanticInvalid ? 'invalid' : semanticValid ? 'valid' : 'unknown',
      };
    })()''' % ref_json
    return evaluate(cdp, expression, element["contextId"], element.get("sessionId"))

def secure_text_candidates(name, text):
    candidates = [text]
    digits = "".join(character for character in text if character.isdigit())
    if name == "cardNumber" and len(digits) >= 12:
        groups = [digits[index:index + 4] for index in range(0, len(digits), 4)]
        candidates.extend([digits, " ".join(groups), "-".join(groups)])
    elif name == "expiry" and len(digits) in (4, 6):
        candidates.extend([digits[:2] + "/" + digits[-2:], digits[:2] + "/" + digits[2:]])
    return list(dict.fromkeys(candidates))

def replace_secure_field_text(cdp, ref, name, text):
    # Native text insertion is one browser input operation. Sending every
    # character through separate network round trips and focus probes makes a
    # field needlessly slow and increases exposure to unrelated page events.
    # Retained-value verification decides whether a widget needs key events.
    for candidate in secure_text_candidates(name, text):
        for strategy in ("insert", "keys"):
            replace_field_text(cdp, ref, candidate, strategy, require_focused=True)
            time.sleep(0.04)
            state = secure_field_state(cdp, ref)
            # Hosted widgets often format their controlled value with spaces or
            # separators that contradict a stale native HTML pattern. Prefer an
            # explicit semantic rejection from the widget; otherwise verify the
            # retained secure value without exposing it.
            if secure_field_accepts_value(name, text, state):
                return candidate
        if controlled_field_text(cdp, ref, candidate):
            time.sleep(0.04)
            state = secure_field_state(cdp, ref)
            if secure_field_accepts_value(name, text, state):
                return candidate
    raise RuntimeError("The website did not retain the securely filled %s field" % name)

def secure_values_match(name, expected, retained):
    if not isinstance(retained, str):
        return False
    if name in ("cardNumber", "expiry", "expiryMonth", "expiryYear", "securityCode"):
        expected_digits = "".join(character for character in expected if character.isdigit())
        retained_digits = "".join(character for character in retained if character.isdigit())
        if name == "expiry" and len(expected_digits) == 6 and len(retained_digits) == 4:
            expected_digits = expected_digits[:2] + expected_digits[-2:]
        return retained_digits == expected_digits
    if name == "billingPostalCode":
        normalize = lambda value: "".join(character for character in value.upper() if character.isalnum())
        return normalize(retained) == normalize(expected)
    return retained == expected

def secure_field_accepts_value(name, expected, state):
    return (
        isinstance(state, dict)
        and state.get("semanticValidity") != "invalid"
        and secure_values_match(name, expected, state.get("value"))
    )

def capture_screenshot(cdp):
    # A read-only capture can be retried; never replay the preceding input.
    # Keep the same target and masking throughout, without changing focus.
    attempts = []
    for attempt in range(2):
        started = time.monotonic()
        try:
            result = cdp.command("Page.captureScreenshot", {
                "format": "png", "captureBeyondViewport": False,
                "fromSurface": attempt == 0, "optimizeForSpeed": True,
            }, timeout=1.5 if attempt == 0 else 2.5)
            if not result.get("data"):
                raise RuntimeError("Empty screenshot")
            attempts.append({"elapsedMs": round((time.monotonic() - started) * 1000), "status": "ok"})
            return result, attempts
        except Exception as error:
            # Log categories only: upstream exception strings may contain URLs.
            code = "timeout" if "timed out" in str(error).lower() else "capture_failed"
            attempts.append({"elapsedMs": round((time.monotonic() - started) * 1000), "status": code})
            if attempt == 0 and hasattr(cdp, "reconnect_observation"):
                cdp.reconnect_observation()
    raise RuntimeError("Screenshot capture failed after two bounded attempts: " + json.dumps(attempts))

def frame_observation_expression(kind, counter=None):
    if kind == "counter": return 'globalThis.__wdytRefCounter || 0'
    if kind == "mask_on": return "(() => { for (const root of deepRoots()) { const prior = root.querySelector('#decision-feed-secret-mask'); if (prior) prior.remove(); const style = document.createElement('style'); style.id = 'decision-feed-secret-mask'; style.textContent = '[data-decision-feed-secret=\"true\"]{-webkit-text-security:disc!important;color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}'; (root === document ? document.documentElement : root).appendChild(style); } })()"
    if kind == "mask_off": return "deepQueryAll('#decision-feed-secret-mask').forEach(style => style.remove())"
    if kind == "secret_refs":
        expression = "Array.from(deepQueryAll('[data-decision-feed-secret=\"true\"]')).map(element => element.getAttribute('data-decision-feed-ref')).filter(Boolean)"
        if counter is not None:
            if not isinstance(counter, int) or counter < 0: raise RuntimeError("Invalid reference counter")
            expression = "(() => { const refs = (" + expression + "); globalThis.__wdytRefCounter = %d; return refs; })()" % counter
        return expression
    raise RuntimeError("Invalid frame observation kind")

def observe_frame_values(cdp, kind, contexts, counter=None):
    if hasattr(cdp, "frame_values") and not getattr(cdp, "snapshot_deadline", None):
        return [value for start in range(0, len(contexts), 64) for value in cdp.frame_values(kind, contexts[start:start+64], counter)]
    values = []
    for context in contexts:
        try:
            values.append({"value":evaluate_context(cdp, frame_observation_expression(kind, counter if context.get("main") else None), context)})
        except Exception as error:
            values.append({"error":str(error)})
    return values

def frame_reference_counter(cdp, contexts):
    values = observe_frame_values(cdp, "counter", contexts)
    for value in values:
        if "error" in value: raise RuntimeError(value["error"])
    return max([int(value.get("value") or 0) for value in values] + [0])

def set_secret_mask(cdp, enabled):
    observe_frame_values(cdp, "mask_on" if enabled else "mask_off", frame_contexts(cdp))

CURRENT_TARGET_KEY = ""

${EXTENDED_BROWSER_CONTROLLER}

def navigate_with_tunnel_retry(cdp, url):
    # A failed proxy CONNECT has not reached the destination HTTP server.
    # Retry this one navigation once; never retry dispatched page inputs or
    # uncertain HTTP/network failures that may have caused an external change.
    for attempt in range(2):
        response = cdp.command("Page.navigate", {"url": url})
        error = response.get("errorText")
        if not error:
            return response
        if attempt == 0 and "ERR_TUNNEL_CONNECTION_FAILED" in error:
            print("DASH_DIAGNOSTIC " + json.dumps({"kind": "proxy_tunnel_retry", "attempt": 1}), flush=True)
            time.sleep(0.5)
            continue
        raise RuntimeError("Browser navigation failed: " + error + (" (proxy tunnel retry also failed)" if attempt else ""))

def execute_request(request, target):
    global DIAGNOSTIC_TAB, DIAGNOSTIC_TARGET, DIAGNOSTIC_REF
    DIAGNOSTIC_TAB = target["id"]
    DIAGNOSTIC_TARGET = None
    DIAGNOSTIC_REF = None
    diagnostic_path = target_path(CURRENT_TARGET_KEY) + ".diagnostic"
    if globals().get("DIAGNOSTICS_ENABLED", False):
        try:
            with open(diagnostic_path, encoding="utf-8") as handle: prior = json.load(handle)
            if prior.get("generation") == BROWSER_STATE.get("generation") and prior.get("targetId") == DIAGNOSTIC_TAB:
                DIAGNOSTIC_TARGET = prior.get("context")
                DIAGNOSTIC_REF = prior.get("ref")
        except Exception:
            pass
    operation = request.get("operation")
    payload = request.get("payload") or {}
    cdp = CDP(target["webSocketDebuggerUrl"])
    target_closed = False
    cdp.frame_context_cache = None
    cdp.passive_observation = operation in ("snapshot", "inspect")
    try:
        pending_dialog = cdp.observations().get('dialog') if hasattr(cdp,'observations') else None
        if not pending_dialog:
            cdp.command("Page.enable")
            cdp.command("Runtime.enable")
        elif operation not in ('snapshot','screenshot') and not (operation=='extended' and payload.get('action') in ('dialog','logs')):
            raise PreDispatchError('A browser dialog is open. Inspect it and accept or dismiss it before other actions.')
        live = BROWSER_STATE.get("live", {}).get(CURRENT_TARGET_KEY, {})
        if live.get("control") and live.get("expiresAt", 0) > time.time() and operation not in ("end_takeover", "live_url", "screenshot", "snapshot"):
            raise RuntimeError("The user is controlling this browser. Wait until they choose Continue.")
        # Establish the viewport for navigation, not for every read/write RPC.
        # Reapplying emulation during observation or secure entry can disturb
        # an active widget and makes a passive viewer mutate the page.
        if operation == "navigate" and not (live.get("control") and live.get("expiresAt", 0) > time.time()):
            cdp.command("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        # Keep automation focus stable between RPCs: foreground activation alone
        # does not prevent host-window blur from closing React-style menus.
        # Do not change page focus during passive observation or user takeover.
        if operation in ("navigate", "click", "press", "type", "keyboard_type", "keyboard_press", "secure_type", "secure_target", "secure_fill_envelope", "end_takeover"):
            cdp.command("Emulation.setFocusEmulationEnabled", {"enabled": True})
        # A watched/background tab can keep the selected iframe input active
        # while document.hasFocus() is false. Activate only this run's page
        # before real input; never invent/refocus a different element or bypass
        # the secure target check. The takeover guard above still runs first.
        if operation in ("navigate", "back", "import_cookies", "end_takeover"):
            BROWSER_STATE.pop("page_keyboard:"+CURRENT_TARGET_KEY, None)
            private_json(BROWSER_STATE_PATH, BROWSER_STATE)
        browser_diagnostic(cdp, "before_operation")
        if operation in ("click", "press", "type", "keyboard_type", "keyboard_press", "secure_type", "secure_target", "secure_fill_envelope"):
            cdp.command("Page.bringToFront")
            browser_diagnostic(cdp, "after_activation")
        if operation == "live_url":
            prior = BROWSER_STATE.setdefault("live", {}).get(CURRENT_TARGET_KEY)
            control = payload.get("control") is True
            if prior and prior.get("control") is True and not control and prior.get("expiresAt", 0) > time.time():
                raise PreDispatchError("The user is controlling this browser. Wait until they choose Continue.")
            if control:
                cdp.command("Emulation.setFocusEmulationEnabled", {"enabled": False})
                hide_visual_cursor(cdp)
            # Keep the live URL creator on its own persistent CDP connection.
            # Replacing an input/observation socket must not end the viewer.
            stream_cdp = PooledCDP(cdp.endpoint, channel="viewer") if hasattr(cdp, "endpoint") else cdp
            transport = stream_cdp.transport_identity() if hasattr(stream_cdp, "transport_identity") else None
            if payload.get("refresh") is not True and prior and prior.get("transport") == transport and prior.get("control") == control and prior.get("expiresAt", 0) > time.time() + 10:
                value = {"url": prior["url"]}
            else:
                if prior:
                    try:
                        stream_cdp.command("Browserless.closeLiveURL", {"liveURLId": prior["id"]})
                    except Exception:
                        # A disconnected creator can have already retired this URL.
                        if prior.get("transport") == transport:
                            raise
                # Observation must last with the browser, not expire after two
                # minutes and falsely tell the viewer that the session ended.
                # Keep the separate bounded lease for interactive takeover.
                duration = session_remaining_ms() - 1000
                if control:
                    duration = min(duration, 600000)
                    if prior and prior.get("control"):
                        duration = min(duration, int((prior.get("expiresAt", 0) - time.time()) * 1000))
                if duration < 1000:
                    raise RuntimeError("Browser session is ending; reopen the website before takeover")
                result = stream_cdp.command("Browserless.liveURL", {"timeout": duration, "interactable": control, "showBrowserInterface": False, "resizable": False})
                if result.get("error") or not result.get("liveURL"):
                    raise RuntimeError("Browser live view could not be opened")
                browserless_url(result["liveURL"])
                # Minting/replacing may consume completion events from the
                # previous URL. Store the creator's final health identity.
                transport = stream_cdp.transport_identity() if hasattr(stream_cdp, "transport_identity") else None
                BROWSER_STATE["live"][CURRENT_TARGET_KEY] = {"id": result["liveURLId"], "url": result["liveURL"], "control": control, "expiresAt": time.time() + min(duration, result.get("timeout") or duration) / 1000, "transport": transport}
                private_json(BROWSER_STATE_PATH, BROWSER_STATE)
                value = {"url": result["liveURL"]}
        elif operation == "end_takeover":
            prior = BROWSER_STATE.setdefault("live", {}).pop(CURRENT_TARGET_KEY, None)
            if prior:
                cdp.command("Browserless.closeLiveURL", {"liveURLId": prior["id"]})
            private_json(BROWSER_STATE_PATH, BROWSER_STATE)
            value = {"closed": True}
            try: queue_profile_save()
            except Exception as error: profile_failure_diagnostic(error)
        elif operation == "solve_captcha":
            attempt_key = "captcha:" + CURRENT_TARGET_KEY
            if BROWSER_STATE.get(attempt_key):
                raise RuntimeError("CAPTCHA solving was already attempted in this session. Request user takeover if still blocked.")
            BROWSER_STATE[attempt_key] = True
            private_json(BROWSER_STATE_PATH, BROWSER_STATE)
            result = cdp.command("Browserless.solveCaptcha", timeout=35)
            value = {"found": result.get("captchaFound") is True, "solved": result.get("solved") is True, "page": snapshot(cdp)}
        elif operation == "navigate":
            response = navigate_with_tunnel_retry(cdp, payload["url"])
            ready(cdp)
            value = snapshot(cdp)
        elif operation == "extended":
            value = extended_browser(cdp, target, payload)
            target_closed = payload.get("action") == "tabs_close" and payload.get("id") == target["id"]
        elif operation == "snapshot":
            value = snapshot(cdp)
        elif operation == "preflight_ref":
            value = preflight_ref(cdp, payload["ref"], payload.get("fullPage", True))
        elif operation == "preflight_locator":
            # Resolve and inspect within the same locked controller request.
            # No input is dispatched here; approval and input readiness remain
            # in their original later stages. Never guess an ambiguous match.
            matches = extended_query(cdp, payload["locator"])
            if len(matches) > 1:
                candidates=[{key:row.get(key) for key in ("ref","role","name","visible","enabled","containers","frameId","mainFrame")} for row in matches[:20]]
                for row in candidates:
                    row["name"]=str(row.get("name") or "")[:240]
                    row["containers"]=(row.get("containers") or [])[:4]
                value={"matches":candidates,"locatorAmbiguous":True,"matchCount":len(matches),"inputDispatched":False}
            else:
                value = {"matches": matches}
            if len(matches) == 1:
                value.update(preflight_ref(cdp, matches[0]["ref"], payload.get("fullPage", True)))
        elif operation == "inspect":
            value = inspect_ref(cdp, payload["ref"])
        elif operation == "wait_for":
            value = wait_for_target(cdp, payload["target"], payload["state"], payload.get("timeoutMs", 10000))
        elif operation == "hover":
            element = describe(cdp, payload["ref"])
            evaluate(cdp, "deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']').scrollIntoView({block:'center',behavior:'instant'})" % json.dumps(payload["ref"]), element["contextId"], element.get("sessionId"))
            element = describe(cdp, payload["ref"])
            hit = evaluate(cdp, "(() => {const e=deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']');const r=e.getBoundingClientRect();const h=deepElementFromPoint(r.left+r.width/2,r.top+r.height/2);return Boolean(h && (h===e || composedContains(e, h)));})()" % json.dumps(payload["ref"]), element["contextId"], element.get("sessionId"))
            if not hit:
                raise RuntimeError("Browser hover target is covered or not actionable")
            visual_cursor(cdp, element)
            cdp.command("Input.dispatchMouseEvent", {"type":"mouseMoved", **extended_pointer_point(cdp,element)})
            value = snapshot(cdp)
        elif operation == "maximize":
            cdp.command("Target.activateTarget", {"targetId": target["id"]})
            window = cdp.command("Browser.getWindowForTarget", {"targetId": target["id"]})
            try:
                cdp.command("Browser.setWindowBounds", {"windowId": window["windowId"], "bounds": {"windowState": "maximized"}})
            except Exception:
                cdp.command("Browser.setWindowBounds", {"windowId": window["windowId"], "bounds": {"left": 0, "top": 0, "width": 1440, "height": 900}})
            time.sleep(0.25)
            value = snapshot(cdp)
        elif operation == "import_cookies":
            cookies = payload.get("cookies")
            if not isinstance(cookies, list) or not cookies or len(cookies) > 5000:
                raise RuntimeError("Chrome import must contain between 1 and 5,000 cookies")
            allowed_keys = {"name", "value", "domain", "path", "secure", "httpOnly", "sameSite", "expires"}
            normalized = []
            for cookie in cookies:
                if not isinstance(cookie, dict) or not isinstance(cookie.get("name"), str) or not isinstance(cookie.get("value"), str) or not isinstance(cookie.get("domain"), str):
                    raise RuntimeError("Chrome import contained an invalid cookie")
                normalized.append({key: value for key, value in cookie.items() if key in allowed_keys})
            cdp.command("Network.enable")
            cdp.command("Network.setCookies", {"cookies": normalized}, timeout=45)
            value = {"imported": len(normalized)}
        elif operation == "secret_recipient":
            # Identity and recipient must come from the same run-scoped tab.
            # No DOM/AX scan is needed merely to prepare or verify an unlock.
            page_url = evaluate(cdp, "location.href")
            expected_origin = payload.get("expectedOrigin")
            if expected_origin:
                actual = urllib.parse.urlsplit(page_url)
                expected = urllib.parse.urlsplit(expected_origin)
                if actual.scheme != "https" or expected.scheme != "https" or (actual.hostname, actual.port or 443) != (expected.hostname, expected.port or 443):
                    raise RuntimeError("The secure website changed. Choose your saved item again on the current page.")
            value = {**secret_recipient(payload.get("token")), "pageUrl": page_url}
        elif operation == "secure_target":
            focus_secure_target(cdp, payload["ref"])
            value = {"ref": payload["ref"], "focused": True}
        elif operation == "secure_fill_envelope":
            token = payload.get("token")
            private_path = secret_key_path(token)
            retain_recipient = False
            try:
                # The agent must choose exactly one value and its exact field.
                # Reject old bundles rather than silently selecting a destination.
                fields = payload.get("fields")
                if not isinstance(fields, list) or len(fields) != 1 or payload.get("autoDiscover") or payload.get("autoAdvanceLogin"):
                    raise RuntimeError("Secure typing requires exactly one agent-selected field and never discovers fields or advances forms")
                field = fields[0]
                name, ref = field.get("name"), field.get("ref")
                allowed = {"login": ("username", "password"), "payment_card": ("cardholderName", "cardNumber", "expiry", "expiryMonth", "expiryYear", "billingPostalCode", "securityCode")}
                if name not in allowed.get(payload.get("kind"), ()) or not isinstance(ref, str):
                    raise RuntimeError("Invalid secure value or target field")
                if evaluate(cdp, "location.href") != payload.get("expectedUrl"):
                    raise RuntimeError("The page changed before secure typing; inspect and click the intended field again")
                refocus_secure_target(cdp, ref)
                lease_path = private_path + ".lease"
                origin = urllib.parse.urlsplit(payload["expectedUrl"])
                origin = origin.scheme + "://" + origin.netloc.lower()
                if not origin.startswith("https://"):
                    raise RuntimeError("Secure typing requires HTTPS")
                if os.path.exists(lease_path):
                    with open(lease_path, encoding="utf-8") as handle:
                        lease = json.load(handle)
                    if lease.get("origin") != origin or (payload.get("kind") != "payment_card" and time.time() - lease.get("createdAt", 0) > 600):
                        raise RuntimeError("The secure typing release has expired or belongs to another origin")
                else:
                    private_json(lease_path, {"origin": origin, "createdAt": time.time()})
                secret = decrypt_device_envelope(cdp, token, payload.get("envelope"))
                if secret.get("kind") != payload.get("kind"):
                    raise RuntimeError("The unlocked vault item has the wrong kind")
                if name == "expiry":
                    month, year = secret.get("expiryMonth"), secret.get("expiryYear")
                    text = (str(month) + "/" + (str(year) if field.get("fourDigitYear") else str(year)[-2:])) if month and year else None
                else:
                    text = secret.get(name)
                if not isinstance(text, str):
                    raise RuntimeError("The unlocked item is missing the requested secure value")
                for attempt in range(3):
                    try:
                        mark_secure_target(cdp, ref)
                        replace_secure_field_text(cdp, ref, name, text)
                        break
                    except SecureTargetFocusLost:
                        if attempt == 2:
                            raise
                        cdp.command("Page.bringToFront")
                        refocus_secure_target(cdp, ref)
                time.sleep(0.2)
                if not secure_field_accepts_value(name, text, secure_field_state(cdp, ref)):
                    raise RuntimeError("The website did not retain the securely typed field")
                value = snapshot(cdp)
                value["secureFieldsVerified"] = True
                value["secureFieldNames"] = [name]
                retain_recipient = payload.get("retainForSecureTyping") is True
            except SecureTargetFocusLost:
                # A background viewer can steal page focus while the exact
                # selected field remains active. Keep this run's encrypted
                # release so the agent can retry that same field without a
                # second phone unlock.
                retain_recipient = payload.get("retainForSecureTyping") is True
                raise
            finally:
                if not retain_recipient:
                    for path in (private_path, private_path + ".scope", private_path + ".lease"):
                        try:
                            os.remove(path)
                        except FileNotFoundError:
                            pass
        elif operation == "describe":
            value = describe(cdp, payload["ref"])
        elif operation == "keyboard_type":
            text = payload.get("text")
            if not isinstance(text, str) or not 1 <= len(text) <= 512 or any(__import__('unicodedata').category(ch).startswith('C') for ch in text):
                raise PreDispatchError("Use literal printable page text without control characters")
            if extended_secure_page(cdp):
                raise PreDispatchError("Page keyboard typing is unavailable on secure pages; use the exact field")
            # Do not steal focus from a field/frame, or activate a button left
            # focused by a previous click. Recheck after blur handlers run.
            neutral = evaluate(cdp, """(() => {
                const active = deepActiveElement();
                const visible = e => {
                    if (!e.getClientRects().length || !e.getBoundingClientRect().width || !e.getBoundingClientRect().height) return false;
                    if (typeof e.checkVisibility === 'function' && !e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) return false;
                    for (let p=e;p;p=composedParent(p)) {
                        const style=getComputedStyle(p);
                        if (p.hidden || p.inert || style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse' || Number(style.opacity)===0) return false;
                    }
                    return true;
                };
                if (deepQueryAll('[aria-modal="true"],dialog[open]').some(visible)) return false;
                if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT|IFRAME|EMBED|OBJECT)$/.test(active.tagName))) return false;
                if (active && active !== document.body && active !== document.documentElement) active.blur();
                const next = deepActiveElement();
                return document.hasFocus() && (!next || next === document.body || next === document.documentElement);
            })()""")
            if not neutral:
                raise PreDispatchError("Page typing requires neutral document focus; use the exact focused field or dismiss the dialog")
            typed_url = evaluate(cdp, "location.href")
            cdp.type_keys(text, delay=0)
            BROWSER_STATE["page_keyboard:"+CURRENT_TARGET_KEY] = {"url": typed_url, "at": time.time(), "generation": BROWSER_STATE.get("generation")}
            private_json(BROWSER_STATE_PATH, BROWSER_STATE)
            value = {"observationDeferred": True} if payload.get("deferObservation") is True else snapshot(cdp)
        elif operation == "keyboard_press":
            key = payload.get("key")
            if key not in ("Enter", "Backspace", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"):
                raise PreDispatchError("Unsupported page key; use an exact target")
            if extended_secure_page(cdp):
                raise PreDispatchError("Page keyboard presses are unavailable on secure pages")
            safe = evaluate(cdp, r"""(() => {
                const active = deepActiveElement();
                if (!document.hasFocus() || (active && active !== document.body && active !== document.documentElement)) return false;
                const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
                if (Array.from(deepQueryAll('[aria-modal="true"],dialog[open],form,input,textarea,select,[contenteditable]:not([contenteditable="false"]),embed,object')).some(visible)) return false;
                const consequential = /\b(?:buy|pay|purchase|checkout|send|reply|forward|delete|submit|confirm|book)\b|place\s+order/i;
                return !Array.from(deepQueryAll('button,[role="button"],input[type="submit"],a[href]')).some(e => visible(e) && consequential.test(e.getAttribute('aria-label') || e.innerText || e.textContent || ''));
            })()""")
            if not safe:
                raise PreDispatchError("Page key requires a neutral non-form interface without consequential controls; use an exact observed target")
            if key == "Enter":
                prior = BROWSER_STATE.get("page_keyboard:"+CURRENT_TARGET_KEY, {})
                if prior.get("generation") != BROWSER_STATE.get("generation") or prior.get("url") != evaluate(cdp, "location.href") or time.time() - prior.get("at", 0) > 30:
                    raise PreDispatchError("Enter requires recent page typing on the same page; inspect or use an exact target")
                BROWSER_STATE.pop("page_keyboard:"+CURRENT_TARGET_KEY, None)
                private_json(BROWSER_STATE_PATH, BROWSER_STATE)
            press_key(cdp, key)
            value = snapshot(cdp)
        elif operation in ("click", "press"):
            element = describe(cdp, payload["ref"])
            observe_outcome = payload.get("observeOutcome") is True
            before_click = snapshot(cdp) if observe_outcome else None
            if observe_outcome:
                cdp.command("Network.enable")
                cdp.command("Page.enable")
                cdp.clear_events()
            ref_json = json.dumps(payload["ref"])
            # Wait only for input readiness, immediately before a single dispatch.
            try:
                element = wait_for_input_ready(cdp, payload["ref"], pointer=operation == "click")
            except PreDispatchError as error:
                try:
                    fresh = snapshot(cdp)
                    controls = [{k:e.get(k) for k in ("ref","role","name","disabled")} for e in fresh.get("elements",[]) if e.get("role") in ("button","dialog","textbox","spinbutton","combobox")]
                    suffix = " Fresh controls (untrusted page data): " + json.dumps(controls[:24],separators=(",",":"))[:4000]
                except Exception:
                    suffix = " Fresh observation unavailable; inspect before retrying."
                raise PreDispatchError(str(error) + suffix)
            if operation == "click":
                visual_cursor(cdp, element)
            if operation == "press":
                if str(element.get("type", "")).lower() == "password":
                    raise RuntimeError("Use secure login fill for password fields")
                # Focus the exact control before dispatching real keyboard events.
                evaluate(cdp, "deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']').focus()" % ref_json, element["contextId"], element.get("sessionId"))
                focused = evaluate(cdp, "deepActiveElement()?.getAttribute('data-decision-feed-ref') === %s" % ref_json, element["contextId"], element.get("sessionId"))
                if not focused:
                    raise RuntimeError("Browser key target could not receive focus")
                key=payload['key']
                if re.fullmatch(r'(?:ControlOrMeta|Control|Meta)\+[cCxXvV]',key):
                    if extended_secure_page(cdp): raise PreDispatchError('Clipboard shortcuts cannot read or alter secure fields. Use secure-fill tools.')
                    if key[-1].lower()=='v':
                        for character in BROWSER_STATE.get('clipboard:'+CURRENT_TARGET_KEY,''):
                            cdp.command('Input.dispatchKeyEvent',{'type':'keyDown','key':character,'text':character,'modifiers':0})
                            cdp.command('Input.dispatchKeyEvent',{'type':'keyUp','key':character,'modifiers':0})
                    else:
                        selected=evaluate(cdp,"(() => {const e=deepActiveElement();return (e && typeof e.selectionStart==='number') ? e.value.slice(e.selectionStart,e.selectionEnd) : String(getSelection());})()",element['contextId'],element.get('sessionId'))
                        BROWSER_STATE['clipboard:'+CURRENT_TARGET_KEY]=str(selected or '')[:10000]
                        private_json(BROWSER_STATE_PATH,BROWSER_STATE)
                        if key[-1].lower()=='x': press_key(cdp,'Backspace')
                else:
                    press_key(cdp, key)
            elif not element.get("mainFrame") and not element.get("sessionId") and payload.get("button", "left") == "left" and payload.get("clickCount", 1) == 1 and not payload.get("modifiers") and not payload.get("holdMs"):
                evaluate(cdp, "(() => { const e=deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']'); e.focus(); e.click(); })()" % ref_json, element["contextId"], element.get("sessionId"))
            else:
                mouse={**({"x":element["x"],"y":element["y"]} if element.get("mainFrame") or element.get("sessionId") else extended_pointer_point(cdp,element)),"button":payload.get("button","left"),"modifiers":sum({'Alt':1,'Control':2,'Meta':4,'Shift':8}[m] for m in set(payload.get('modifiers',[])))}
                pointer_click(cdp, mouse, payload.get('clickCount', 1), payload.get('holdMs', 0), element.get('sessionId'))
            if operation == "click" and not (hasattr(cdp,"observations") and cdp.observations().get("dialog")):
                visual_cursor(cdp, click=True)
            if observe_outcome:
                try:
                    value = observe_click_outcome(cdp, before_click, 10)
                except Exception:
                    # The click may already have caused an irreversible external
                    # change. Return an unknown observation instead of failing
                    # the tool and making an automatic retry look safe.
                    try:
                        value = snapshot(cdp)
                    except Exception:
                        value = before_click
                    value["outcomeObservation"] = {
                        "state": "unknown",
                        "reason": "observer_error",
                        "elapsedMs": 0,
                        "navigationObserved": False,
                        "pageChanged": snapshot_signature(value) != snapshot_signature(before_click),
                        "preexistingValidationErrorCount": len(validation_errors(before_click)),
                        "freshValidationErrors": [],
                        "mutationRequests": [],
                    }
            else:
                time.sleep(0.4)
                try:
                    ready(cdp, 10)
                except Exception:
                    pass
                value = {"observationDeferred": True} if payload.get("deferObservation") is True else snapshot(cdp)
        elif operation in ("type", "secure_type"):
            element = describe(cdp, payload["ref"])
            if operation == "type" and str(element.get("type", "")).lower() == "password":
                raise RuntimeError("Password fields require user takeover in the cloud browser")
            if operation == "secure_type":
                mark_secure_target(cdp, payload["ref"])
            if operation == "type" and payload.get("append"):
                evaluate(cdp, "deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']').focus()" % json.dumps(payload["ref"]), element["contextId"], element.get("sessionId"))
                if hasattr(cdp, 'type_keys') and len(payload['text']) <= 512 and not any(character in '\r\n\t' for character in payload['text']):
                    # Append already has no per-character delay. Preserve its
                    # exact native events while removing round trips per key.
                    cdp.type_keys(payload['text'], delay=0)
                else:
                    for character in payload['text']:
                        cdp.command('Input.dispatchKeyEvent',{'type':'keyDown','key':character,'text':character,'unmodifiedText':character})
                        cdp.command('Input.dispatchKeyEvent',{'type':'keyUp','key':character})
            else:
                replace_field_text(cdp, payload["ref"], payload["text"], require_focused=operation == "secure_type")
            # Only ordinary fill batching may defer its post-action tree. All
            # targeting, native input, takeover and secret guards above still run.
            if operation == "type" and payload.get("deferObservation") is True and not payload.get("append"):
                value = {"observationDeferred": True}
            else:
                # Batched fills already await native input acknowledgements and
                # check readiness before the next target. Settle only when this
                # operation promises a fresh observation, not after every field.
                time.sleep(0.15)
                value = snapshot(cdp)
        elif operation == "select":
            element = describe(cdp, payload["ref"])
            ref_json = json.dumps(payload["ref"])
            value_json = json.dumps(payload["value"])
            expression = """(() => { const element = deepQuery('[data-decision-feed-ref="' + %s + '"]'); if (!element || element.tagName.toLowerCase() !== 'select' || element.matches(':disabled') || element.closest('[aria-disabled="true"]')) return null; const wanted = %s; const option = Array.from(element.options).find(item => item.value === wanted || String(item.textContent || '').trim() === wanted); if (!option || option.disabled || option.parentElement?.matches('optgroup:disabled')) return null; element.value = option.value; element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true})); return {value:option.value}; })()""" % (ref_json, value_json)
            selection = evaluate(cdp, expression, element["contextId"], element.get("sessionId"))
            if not selection:
                raise RuntimeError("Browser select or option is disabled or unavailable; no selection was made")
            value = snapshot(cdp)
            retained = evaluate(cdp, "(() => { const e=deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']'); return Boolean(e && e.value === %s); })()" % (ref_json, json.dumps(selection["value"])), element["contextId"], element.get("sessionId"))
            if not retained:
                raise RuntimeError("The page did not retain the selected option; inspect the current state before acting again")
        elif operation == "check":
            element = describe(cdp, payload["ref"])
            ref_json = json.dumps(payload["ref"])
            checked = "true" if payload["checked"] else "false"
            expression = """(() => { const element = deepQuery('[data-decision-feed-ref="' + %s + '"]'); if (!element || element.matches(':disabled,[aria-disabled=\"true\"]') || !('checked' in element || element.hasAttribute('aria-checked'))) return false; const checked = () => 'checked' in element ? Boolean(element.checked) : element.getAttribute('aria-checked') === 'true'; if (checked() !== %s) element.click(); return checked() === %s; })()""" % (ref_json, checked, checked)
            if not evaluate(cdp, expression, element["contextId"], element.get("sessionId")):
                raise RuntimeError("Browser control could not be updated")
            time.sleep(0.1)
            value = snapshot(cdp)
        elif operation == "back":
            evaluate(cdp, "history.back()")
            time.sleep(0.4)
            try:
                ready(cdp, 10)
            except Exception:
                pass
            value = snapshot(cdp)
        elif operation == "wait":
            time.sleep(min(10, max(0.1, float(payload["milliseconds"]) / 1000)))
            value = {"observationDeferred": True} if payload.get("deferObservation") is True else snapshot(cdp)
        elif operation == "scroll":
            if payload.get("ref"):
                element = describe(cdp, payload["ref"])
                evaluate(cdp, "deepQuery('[data-decision-feed-ref=' + JSON.stringify(%s) + ']').scrollBy({top:%d,left:%d,behavior:'instant'})" % (json.dumps(payload["ref"]), int(payload["deltaY"]), int(payload.get('deltaX',0))), element["contextId"], element.get("sessionId"))
            else:
                evaluate(cdp, "window.scrollBy({top:%d,left:%d,behavior:'instant'})" % (int(payload["deltaY"]),int(payload.get('deltaX',0))))
            time.sleep(0.1)
            value = snapshot(cdp)
        elif operation == "screenshot":
            screenshot_path = payload.get("path")
            inline_screenshot = payload.get("inline") is True
            if not inline_screenshot and (not isinstance(screenshot_path, str) or not screenshot_path.startswith(ROOT + "/screenshot-") or not screenshot_path.endswith(".png")):
                raise RuntimeError("Invalid cloud browser screenshot path")
            set_secret_mask(cdp, True)
            # Capture the live surface without toggling cursor visibility.
            try:
                result, capture_attempts = capture_screenshot(cdp)
                if not inline_screenshot:
                    with open(screenshot_path, "wb") as handle:
                        handle.write(base64.b64decode(result["data"]))
            finally:
                try:
                    set_secret_mask(cdp, False)
                except Exception:
                    pass  # Cleanup must not replace the capture failure.
            value = {**({"base64":result["data"]} if inline_screenshot else {"path":screenshot_path}), "captureAttempts":capture_attempts}
        else:
            raise RuntimeError("Unknown cloud browser operation")
        if not target_closed: browser_diagnostic(cdp, "after_operation")
        # Reads and preflight never trigger saves. Mutations enqueue only; the
        # account's private worker captures/uploads without this action lock.
        save_operations = ("navigate", "back", "click", "press", "type", "keyboard_type", "keyboard_press", "select", "check", "import_cookies", "secure_type")
        save_extended = operation == "extended" and payload.get("action") in ("reload", "forward", "upload", "dialog")
        if not target_closed and (operation in save_operations or save_extended):
            try: queue_profile_save()
            except Exception as error: profile_failure_diagnostic(error)
        warning = profile_save_warning()
        if warning and isinstance(value,dict): value["persistenceWarning"] = warning
        print(json.dumps({"ok": True, "value": value}, separators=(",", ":")))
    finally:
        if not target_closed: browser_diagnostic(cdp, "operation_end")
        if globals().get("DIAGNOSTICS_ENABLED", False) and DIAGNOSTIC_TARGET:
            try:
                private_json(diagnostic_path, {"generation":BROWSER_STATE.get("generation"), "targetId":DIAGNOSTIC_TAB, "context":DIAGNOSTIC_TARGET, "ref":DIAGNOSTIC_REF})
            except Exception:
                pass
        cdp.close()

${BROWSERLESS_RUNTIME}
${PROFILE_WORKER}


# Durations only: never record arguments, page content, or returned values.
BROWSER_PHASE_SPANS = []
BROWSER_PHASE_STARTED = time.monotonic()
def timed_browser_phase(name, function):
    def measured(*args, **kwargs):
        if not globals().get("DIAGNOSTICS_ENABLED", False):
            return function(*args, **kwargs)
        started = time.monotonic()
        failed = False
        try:
            return function(*args, **kwargs)
        except Exception:
            failed = True
            raise
        finally:
            if len(BROWSER_PHASE_SPANS) < 80 or name == "snapshot":
                BROWSER_PHASE_SPANS.append({"name":name,"startMs":round((started-BROWSER_PHASE_STARTED)*1000,3),"durationMs":round((time.monotonic()-started)*1000,3),"failed":failed})
    return measured

for _phase_name in ("connect_browser", "choose_target", "describe", "wait_for_input_ready", "pointer_click", "ready", "snapshot", "frame_contexts", "recover_missing_hosted_fields", "prefetch_accessibility", "accessibility_identity", "observe_frame_values", "visual_cursor", "finish_browser"):
    globals()[_phase_name] = timed_browser_phase(_phase_name, globals()[_phase_name])

def main():
    global CURRENT_TARGET_KEY
    os.umask(0o077)
    os.makedirs(ROOT, mode=0o700, exist_ok=True)
    # Remove the per-invocation payload before spawning any long-lived worker.
    # The command line contains only a private path, never page data or text.
    inline_request = os.environ.pop("DASH_BROWSER_REQUEST", None)
    if inline_request is not None:
        request = json.loads(inline_request)
    else:
        with open(REQUEST_PATH, "r", encoding="utf-8") as handle:
            request = json.load(handle)
    global DIAGNOSTICS_ENABLED
    DIAGNOSTICS_ENABLED = False
    target_key = request.get("targetKey", "shared")
    CURRENT_TARGET_KEY = target_key
    os.makedirs(TARGET_DIR, mode=0o700, exist_ok=True)
    lock_started = time.monotonic()
    with open(target_lock_path(target_key), "a", encoding="utf-8") as run_lock:
        fcntl.flock(run_lock, fcntl.LOCK_EX)
        with open(LOCK_PATH, "a", encoding="utf-8") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            BROWSER_PHASE_SPANS.append({"name":"lock_wait","startMs":round((lock_started-BROWSER_PHASE_STARTED)*1000,3),"durationMs":round((time.monotonic()-lock_started)*1000,3)})
            if request.get("operation") == "close_browser":
                try:
                    connect_browser(request)
                except Exception:
                    pass  # No live session; closing must never launch one.
                if BROWSER_CONNECTION is not None:
                    flush_profile_before_close()
                    try:
                        BROWSER_CONNECTION.command("Browser.close")
                    except Exception:
                        pass  # Chrome can close the socket before acknowledging.
                    finally:
                        BROWSER_CONNECTION.close()
                if os.path.exists(BROWSER_STATE_PATH): os.remove(BROWSER_STATE_PATH)
                print(json.dumps({"ok": True, "value": {"closed": True}}))
                return
            connect_browser(request)
            try:
                if request.get("operation") == "user_wait":
                    value = set_user_wait(target_key, request.get("payload", {}).get("waiting") is True)
                    print(json.dumps({"ok": True, "value": value}, separators=(",", ":")))
                    return
                if request.get("operation") == "recover_target":
                    value = recover_target(target_key)
                    print(json.dumps({"ok": True, "value": value}, separators=(",", ":")))
                    return
                if request.get("operation") == "target_health":
                    value = target_health(choose_target(target_key, False))
                    print(json.dumps({"ok": True, "value": value}, separators=(",", ":")))
                    return
                if request.get("operation") == "prune_targets":
                    value = prune_targets(request.get("payload", {}).get("targetKeys", []), target_key)
                    print(json.dumps({"ok": True, "value": value}, separators=(",", ":")))
                    return
                target = choose_target(target_key, request.get("operation") in ("navigate", "import_cookies"))
                execute_request(request, target)
            finally:
                try:
                    finish_browser()
                except Exception:
                    # Never turn a completed mutation into a retryable error.
                    pass
                print("DASH_DIAGNOSTIC " + json.dumps({"stage":"operation_phases","spans":BROWSER_PHASE_SPANS},separators=(",",":")),flush=True)

if __name__ == "__main__":
    try:
        if len(sys.argv) == 3 and sys.argv[1] == "--cdp-pool":
            ROOT = sys.argv[2]
            serve_cdp_pool()
        elif len(sys.argv) == 3 and sys.argv[1] == "--profile-worker":
            ROOT = sys.argv[2]
            serve_profile_worker()
        else:
            main()
    except Exception as error:
        message = str(error).replace(os.environ.get("BROWSERLESS_API_TOKEN", "__no_token__"), "[redacted]")
        print(json.dumps({"ok": False, "error": message, **({"inputDispatched": False} if isinstance(error, PreDispatchError) else {})}, separators=(",", ":")))
        sys.exit(1)
`;
