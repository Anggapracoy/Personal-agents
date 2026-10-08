// Trusted controller support. This code runs in a private E2B runtime, never in
// the agent-authored terminal sandbox. Account-wide flock serializes sessions,
// profile checkpoints and takeover across otherwise independent app workers.
export const BROWSERLESS_RUNTIME = String.raw`
BROWSER_STATE_PATH = ROOT + "/browserless.json"
BROWSER_STATE = {}
BROWSER_CONNECTION = None

def private_json(path, value):
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        os.chmod(temporary, 0o600)
        json.dump(value, handle)
    os.replace(temporary, path)

def browserless_host():
    host = os.environ.get("BROWSERLESS_HOST", "production-sfo.browserless.io")
    if host not in ("production-sfo.browserless.io", "production-lon.browserless.io", "production-ams.browserless.io"):
        raise RuntimeError("Unsupported Browserless region")
    return host

def browserless_url(value):
    url = urllib.parse.urlparse(value)
    if url.scheme not in ("https", "wss") or url.hostname != browserless_host() or url.username or url.password or url.port not in (None, 443):
        raise RuntimeError("Refused an untrusted Browserless endpoint")
    params = dict(urllib.parse.parse_qsl(url.query))
    params["token"] = os.environ["BROWSERLESS_API_TOKEN"]
    return urllib.parse.urlunparse(url._replace(query=urllib.parse.urlencode(params), fragment=""))

def browserless_api(path, method="GET", body=None):
    url = browserless_url(path if path.startswith("https://") else "https://" + browserless_host() + path)
    # Browserless parses JSON whenever this header is present, even on GET.
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=35) as response:
            data = response.read()
            return json.loads(data) if data else {}
    except urllib.error.HTTPError as error:
        # Never expose the request URL/token or an upstream body to the model.
        raise RuntimeError("Browserless API returned HTTP " + str(error.code)) from None

def browserless_profile():
    name = os.environ.get("BROWSERLESS_PROFILE", "")
    if not name.startswith("dash-") or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in name):
        raise RuntimeError("Invalid browser profile ownership")
    return name

def session_remaining_ms():
    return max(0, int((BROWSER_STATE.get("expiresAt", 0) - time.time()) * 1000))

def browser_idle_deadline():
    now = time.time()
    deadline = BROWSER_STATE.get("expiresAt", now)
    takeover = any(v.get("control") and v.get("expiresAt", 0) > now for v in BROWSER_STATE.get("live", {}).values())
    waiting_until = max([now] + list(BROWSER_STATE.get("userWaits", {}).values()))
    return min(deadline, deadline if takeover else max(now + 120, waiting_until))

def set_user_wait(target_key, waiting):
    # Only retain an existing tab. Never create a browser or a replacement tab.
    target_id = read_target_id(target_path(target_key))
    targets = json_request("/json/list") if target_id else []
    waits = {key: value for key, value in BROWSER_STATE.get("userWaits", {}).items() if value > time.time()}
    if waiting and any(target.get("id") == target_id for target in targets):
        # Repeated delivery of the same pause must not slide the deadline.
        waits.setdefault(target_key, min(BROWSER_STATE.get("expiresAt", 0), time.time() + 600))
    else:
        waits.pop(target_key, None)
    BROWSER_STATE["userWaits"] = waits
    private_json(BROWSER_STATE_PATH, BROWSER_STATE)
    return {"waitingUntil": waits.get(target_key)}

# Read storage in isolated worlds without attaching Puppeteer or changing the
# viewport. Browserless's live save/refresh CDP extensions reset it to 800x600.
PROFILE_STORAGE_EXPRESSION = r"""(async () => {
    if (!/^https?:$/.test(location.protocol) || location.origin === 'null') return null;
    // Sandboxed frames may deny storage; leave any previously saved origin alone.
    let storage;
    try { storage = localStorage; } catch { return null; }
    const local = Object.fromEntries(Array.from({length: storage.length}, (_, i) => {
        const key = storage.key(i); return [key, storage.getItem(key)];
    }));
    // The profile API accepts JSON. Do not silently corrupt structured-clone
    // values (Blob, Date, typed arrays, cycles, etc.) by JSON-stringifying them.
    const validate = (value, seen = new Set()) => {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
        if (typeof value === 'number' && Number.isFinite(value)) return;
        if (typeof value !== 'object' || seen.has(value) ||
            (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype))
            throw new Error('Profile contains non-JSON storage');
        seen.add(value);
        for (const item of Object.values(value)) validate(item, seen);
        seen.delete(value);
    };
    const databases = [];
    for (const info of await indexedDB.databases()) {
        if (!info.name) continue;
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(info.name, info.version);
            request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Database changed')); };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(new Error('Database unavailable'));
            request.onblocked = () => reject(new Error('Database blocked'));
        });
        try {
            const objectStores = await Promise.all(Array.from(db.objectStoreNames, name => new Promise((resolve, reject) => {
                const transaction = db.transaction(name, 'readonly');
                const store = transaction.objectStore(name);
                const entries = [];
                const indexes = Array.from(store.indexNames, name => {
                    const index = store.index(name);
                    return {name, keyPath:index.keyPath, unique:index.unique, multiEntry:index.multiEntry};
                });
                const request = store.openCursor();
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) return;
                    try { validate(cursor.key); validate(cursor.value); }
                    catch (error) { transaction.abort(); reject(error); return; }
                    entries.push({key:cursor.key, value:cursor.value});
                    cursor.continue();
                };
                request.onerror = () => reject(new Error('Database read failed'));
                transaction.onabort = () => reject(new Error('Database read aborted'));
                transaction.onerror = () => reject(new Error('Database read failed'));
                transaction.oncomplete = () => resolve({name, keyPath:store.keyPath, autoIncrement:store.autoIncrement, entries, indexes});
            })));
            databases.push({name:db.name, version:db.version, objectStores});
        } finally { db.close(); }
    }
    return {origin:location.origin, localStorage:local, indexedDBs:databases};
})()"""

def profile_failure_code(error):
    code = observation_error_code(error)
    if code: return "profile_" + code
    message = str(error)
    for code in ("non_json_storage", "database_read", "database_changed", "storage_denied", "provider_rejected", "partial_save"):
        if "profile_" + code in message: return "profile_" + code
    match = re.search(r"Browserless API returned HTTP ([0-9]{3})", message)
    if match: return "profile_http_" + match.group(1)
    return "profile_capture_failed"

def profile_failure_diagnostic(error):
    # Never log raw provider/page errors: they can contain cookies or tokens.
    if globals().get("DIAGNOSTICS_ENABLED", False):
        print("DASH_DIAGNOSTIC " + json.dumps({"stage":"profile_save", "errorCode":profile_failure_code(error)}, separators=(",", ":")), flush=True)

def capture_profile_state(cdp):
    return recover_observation(cdp, lambda: capture_profile_state_once(cdp))

def capture_profile_state_once(cdp):
    # Preserve origins no longer open (e.g. an OAuth redirect). This account's
    # profile is shared by run tabs; one account worker serializes uploads.
    previous = browserless_api("/profile/" + browserless_profile() + "/download") if BROWSER_STATE.get("profileExists") else {}
    def has_storage(item):
        return bool(item.get("localStorage") or any(store.get("entries") for db in item.get("indexedDBs",[]) for store in db.get("objectStores",[])))
    origins = {item["origin"]: item for item in previous.get("origins", []) if has_storage(item)}
    active = {}
    for target in json_request("/json/list"):
        page = CDP(target["webSocketDebuggerUrl"])
        try:
            for context in frame_contexts(page, refresh=True):
                value = evaluate_context(page, PROFILE_STORAGE_EXPRESSION, context)
                if value is not None:
                    # Empty current storage also removes an old signed-in copy.
                    origins.pop(value["origin"],None)
                    active.pop(value["origin"],None)
                    if has_storage(value): active[value["origin"]] = value
        finally:
            page.close()
    # A live cookie snapshot includes deletions; merging old cookies would
    # resurrect signed-out sessions. Never log or persist the captured values.
    # Browserless stores at most 50 origins. Keep active storage first, then
    # recently retained origins; never repeatedly submit an oversized snapshot.
    retained = list(active.values()) + list(origins.values())
    return {"cookies": cdp.command("Storage.getCookies")["cookies"], "origins": retained[:50]}

def checkpoint_profile(cdp, force=False, persist=True):
    if not force and time.time() - BROWSER_STATE.get("savedAt", 0) < 60:
        return
    state = capture_profile_state(cdp)
    path = "/profile/refresh" if BROWSER_STATE.get("profileExists") else "/profile/upload"
    result = browserless_api(path, "POST", {"name": browserless_profile(), "state": state})
    if result.get("error") or result.get("ok") is False:
        raise RuntimeError("profile_provider_rejected: Browser login state could not be saved")
    BROWSER_STATE["profileExists"] = True
    if any(result.get("diagnostics", {}).values()):
        if persist: private_json(BROWSER_STATE_PATH, BROWSER_STATE)
        error = RuntimeError("profile_partial_save: Browser login state was not saved completely")
        error.profile_diagnostics = result.get("diagnostics", {})
        raise error
    BROWSER_STATE["savedAt"] = time.time()
    if persist: private_json(BROWSER_STATE_PATH, BROWSER_STATE)

def connect_browser(request):
    global BROWSER_STATE, BROWSER_CONNECTION
    operation = request.get("operation")
    try:
        with open(BROWSER_STATE_PATH, encoding="utf-8") as handle:
            BROWSER_STATE = json.load(handle)
    except FileNotFoundError:
        BROWSER_STATE = {}
    if BROWSER_STATE.get("ws") and session_remaining_ms() > 2000:
        for attempt in range(2):
            try:
                BROWSER_CONNECTION = CDP(browserless_url(BROWSER_STATE["ws"]))
                BROWSER_CONNECTION.command("Target.getTargets")
                return
            except Exception as error:
                if BROWSER_CONNECTION:
                    BROWSER_CONNECTION.close()
                BROWSER_CONNECTION = None
                message = str(error).lower()
                transport_closed = "timed out" not in message and (isinstance(error, (OSError, EOFError)) or any(part in message for part in (
                    "cloud chrome closed", "connection reset", "broken pipe", "connection refused", "bad file descriptor",
                    "persistent browser connection returned no valid result", "devtools websocket handshake failed",
                )))
                if globals().get("DIAGNOSTICS_ENABLED", False):
                    # Never log endpoints, tokens, or the upstream exception text.
                    code = "transport_closed" if transport_closed else "timeout" if "timed out" in message else "probe_failed"
                    detail = {"stage":"connection_probe_failed", "at":time.time()*1000, "attempt":attempt+1, "errorCode":code}
                    close = re.search(r"WebSocket close code ([0-9]{4})", str(error))
                    status = re.search(r"handshake failed \(HTTP ([0-9]{3})\)", str(error))
                    if close: detail["webSocketCloseCode"] = int(close.group(1))
                    if status: detail["httpStatus"] = int(status.group(1))
                    print("DASH_DIAGNOSTIC " + json.dumps(detail, separators=(",", ":")), flush=True)
                # Only the initial read-only health probe may reconnect once.
                # No operation, navigation, input or uncertain submission has
                # been dispatched here. Keep the same browser and generation.
                if attempt or not transport_closed: break
    # A read/view request must never quietly create a paid replacement browser.
    # Stale refs, pending secure fills and uncertain mutations cannot be replayed.
    if operation not in ("navigate", "import_cookies"):
        raise RuntimeError("Browser session is not running. Saved logins may be restored, but the old page and element references are gone. Open a known URL to start a fresh browser; do not repeat an uncertain submission.")
    profile_exists = False
    try:
        browserless_api("/profile/" + browserless_profile())
        profile_exists = True
    except RuntimeError as error:
        if "HTTP 404" not in str(error):
            raise
    timeout = min(1800000, max(60000, int(os.environ.get("BROWSERLESS_SESSION_TIMEOUT_MS", "1800000"))))
    params = {"timeout": timeout, "proxy": "residential", "proxySticky": "true", "proxyCountry": os.environ.get("BROWSERLESS_PROXY_COUNTRY", "ca")}
    if profile_exists:
        params["profile"] = browserless_profile()
    started = time.time()
    result = browserless_api("/stealth/bql?" + urllib.parse.urlencode(params), "POST", {"query": "mutation { reconnect(timeout: 120000) { browserWSEndpoint browserQLEndpoint } }"})
    connection = (result.get("data") or {}).get("reconnect") or {}
    if result.get("errors") or not connection.get("browserWSEndpoint"):
        raise RuntimeError("Browserless could not start a browser session")
    browserless_url(connection["browserWSEndpoint"])
    BROWSER_STATE = {"ws": connection["browserWSEndpoint"], "bql": connection.get("browserQLEndpoint"), "expiresAt": started + timeout / 1000, "profileExists": profile_exists, "generation": os.urandom(16).hex(), "live": {}}
    private_json(BROWSER_STATE_PATH, BROWSER_STATE)
    # Old recipient keys must never be usable in a replacement browser.
    if os.path.isdir(SECRET_KEY_DIR):
        for name in os.listdir(SECRET_KEY_DIR):
            os.remove(os.path.join(SECRET_KEY_DIR, name))
    BROWSER_CONNECTION = CDP(browserless_url(BROWSER_STATE["ws"]))

def json_request(path, method="GET"):
    cdp = BROWSER_CONNECTION
    if cdp is None:
        raise RuntimeError("Browser session is not connected")
    if path == "/json/list":
        targets = cdp.command("Target.getTargets", {"filter": [{"type": "page"}]}).get("targetInfos", [])
        return [dict(item, id=item["targetId"], webSocketDebuggerUrl=browserless_url(BROWSER_STATE["ws"]) + "#" + item["targetId"]) for item in targets]
    if path.startswith("/json/new?"):
        target = cdp.command("Target.createTarget", {"url": urllib.parse.unquote(path.split("?", 1)[1])})["targetId"]
        return {"id": target, "type": "page", "webSocketDebuggerUrl": browserless_url(BROWSER_STATE["ws"]) + "#" + target}
    if path.startswith("/json/close/"):
        identity = urllib.parse.unquote(path[len("/json/close/"):])
        result = cdp.command("Target.closeTarget", {"targetId": identity})
        if not result.get("success"): raise RuntimeError("Browser tab could not be closed")
        return result
    raise RuntimeError("Unsupported browser target operation")

def finish_browser():
    if BROWSER_CONNECTION is None:
        return
    try:
        remaining = session_remaining_ms()
        now = time.time()
        lease = BROWSER_STATE.get("reconnectLease", {})
        if lease.get("generation") == BROWSER_STATE.get("generation") and now - lease.get("refreshedAt", 0) < 10 and lease.get("expiresAt", 0) > now + 30:
            return  # The verified browser lease remains valid; close the client in finally.
        if remaining > 1000:
            targets = json_request("/json/list")
            if not targets:
                BROWSER_CONNECTION.command("Browser.close")
                if os.path.exists(BROWSER_STATE_PATH): os.remove(BROWSER_STATE_PATH)
            if targets:
                page = CDP(targets[0]["webSocketDebuggerUrl"])
                try:
                    # The remote reconnect and local CDP worker share one deadline.
                    lease_ms = max(1, int((browser_idle_deadline() - time.time()) * 1000))
                    browser_diagnostic(page, "before_reconnect", targets[0].get("id"))
                    timeout_ms = min(remaining, lease_ms)
                    result = page.command("Browserless.reconnect", {"timeout": timeout_ms})
                    browser_diagnostic(page, "after_reconnect", targets[0].get("id"))
                    accepted = bool(result.get("browserWSEndpoint")) and not result.get("error")
                    if globals().get("DIAGNOSTICS_ENABLED", False):
                        print("DASH_DIAGNOSTIC " + json.dumps({"stage":"reconnect_lease_result", "accepted":accepted, "requestedMs":timeout_ms,
                            "sessionRemainingMs":remaining, "errorCode":None if accepted else "provider_rejected" if result.get("error") else "missing_endpoint"}, separators=(",", ":")), flush=True)
                    if accepted:
                        BROWSER_STATE["ws"] = result["browserWSEndpoint"]
                        BROWSER_STATE["reconnectLease"] = {"generation":BROWSER_STATE.get("generation"),"refreshedAt":now,"expiresAt":now + timeout_ms / 1000}
                        private_json(BROWSER_STATE_PATH, BROWSER_STATE)
                finally:
                    page.close()
    finally:
        BROWSER_CONNECTION.close()
`;
