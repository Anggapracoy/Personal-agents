// Private, account-scoped CDP transport. The controller process still handles
// each tool request; this small worker keeps Chrome's sessions attached between
// requests. It runs only in the trusted controller sandbox, never agent code.
export const CDP_POOL = String.raw`
CDP_POOL_PROTOCOL = 21
CDP_POOL_LIMIT = 64
CDP_POOL_MESSAGE_LIMIT = 40 * 1024 * 1024

def cdp_pool_path():
    return os.path.join(ROOT, "cdp-pool-v" + str(CDP_POOL_PROTOCOL) + ".sock")

def cdp_pool_metadata():
    state = BROWSER_STATE
    return {"generation": state.get("generation", ""), "idleUntil": browser_idle_deadline()}

def cdp_pool_exchange(message):
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(65)
    sent = False
    try:
        connection.connect(cdp_pool_path())
        stream = connection.makefile("rwb")
        try:
            sent = True
            stream.write(json.dumps(dict(message, protocol=CDP_POOL_PROTOCOL, **cdp_pool_metadata()), separators=(",", ":")).encode() + b"\n")
            stream.flush()
            line = stream.readline(CDP_POOL_MESSAGE_LIMIT + 1)
            if not line or len(line) > CDP_POOL_MESSAGE_LIMIT:
                raise RuntimeError("The persistent browser connection returned no valid result. The action's outcome may be unknown; it was not replayed. Inspect before retrying a submission")
            result = json.loads(line)
            if not result.get("ok"):
                raise RuntimeError(result.get("error") or "The persistent browser connection failed")
            return result.get("value")
        finally:
            stream.close()
    except (OSError, EOFError, json.JSONDecodeError):
        if sent:
            raise RuntimeError("The persistent browser transport failed. The action's outcome may be unknown; it was not replayed. Inspect before retrying a submission") from None
        raise
    finally:
        connection.close()

def start_cdp_pool():
    os.makedirs(ROOT, mode=0o700, exist_ok=True)
    os.chmod(ROOT, 0o700)
    with open(os.path.join(ROOT, "cdp-pool-start.lock"), "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            cdp_pool_exchange({"operation": "ping"})
            return
        except (FileNotFoundError, ConnectionRefusedError):
            pass
        try:
            os.remove(cdp_pool_path())
        except FileNotFoundError:
            pass
        subprocess.Popen([sys.executable, os.path.abspath(__file__), "--cdp-pool", ROOT],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True, close_fds=True)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                cdp_pool_exchange({"operation": "ping"})
                return
            except (FileNotFoundError, ConnectionRefusedError):
                time.sleep(0.05)
        raise RuntimeError("The persistent browser connection could not start")

class PooledCDP:
    def __init__(self, endpoint, channel=None):
        self.endpoint = endpoint
        self.channel = channel
        browserless_url(endpoint)
        start_cdp_pool()
        self.key = cdp_pool_exchange({"operation": "connect", "endpoint": endpoint, "channel": channel})

    def command(self, method, params=None, timeout=20, session_id=None):
        # Never reconnect or retry a command after it has been sent. A dropped
        # IPC/Chrome connection can mean a submission already reached the site.
        return cdp_pool_exchange({"operation": "command", "key": self.key, "method": method,
                                  "params": params, "timeout": timeout, "sessionId": session_id})

    def frame_is_live(self, frame_id, session_id=None):
        return cdp_pool_exchange({"operation":"frame_is_live", "key":self.key, "frameId":frame_id, "sessionId":session_id})

    def read_commands(self, commands, timeout=20, session_id=None, settled=False):
        return cdp_pool_exchange({"operation":"read_commands", "key":self.key, "commands":commands, "timeout":timeout, "sessionId":session_id, "settled":settled})

    def reference_query(self, contexts, ref):
        return cdp_pool_exchange({"operation":"reference_query", "key":self.key, "contexts":contexts, "ref":ref})

    def existing_locator_query(self, contexts, locator):
        return cdp_pool_exchange({"operation":"existing_locator_query", "key":self.key, "contexts":contexts, "locator":locator})

    def frame_values(self, kind, contexts, counter=None):
        return cdp_pool_exchange({"operation":"frame_values", "key":self.key, "kind":kind, "contexts":contexts, "counter":counter})

    def reference_routes(self, ref=None, updates=None):
        return cdp_pool_exchange({"operation":"reference_routes", "key":self.key, "ref":ref, "updates":updates})

    def reference_maps(self, requests, updates=None):
        return cdp_pool_exchange({"operation":"reference_maps", "key":self.key, "requests":requests, "updates":updates})

    def reference_backend(self, session_id, frame_id, document_id, ref, token):
        return cdp_pool_exchange({"operation":"reference_backend", "key":self.key, "sessionId":session_id, "frameId":frame_id, "documentId":document_id, "ref":ref, "token":token})

    def type_keys(self, text, delay=0.006):
        return cdp_pool_exchange({"operation": "type_keys", "key": self.key, "text": text, "delay": delay})

    def reconnect_observation(self):
        # Reconnect only for a fresh trusted read, never resend the failed input.
        self.key = cdp_pool_exchange({"operation": "connect", "endpoint": self.endpoint, "channel": self.channel})
        self.frame_context_cache = None

    def clear_events(self):
        cdp_pool_exchange({"operation": "clear_events", "key": self.key})

    def observations(self):
        return cdp_pool_exchange({"operation":"observations","key":self.key})

    def take_events(self):
        return cdp_pool_exchange({"operation": "take_events", "key": self.key})

    def pump_events(self, timeout=0.1):
        cdp_pool_exchange({"operation": "pump_events", "key": self.key, "timeout": timeout})

    def transport_identity(self):
        return cdp_pool_exchange({"operation": "identity", "key": self.key})

    def close(self):
        # Logical request completion, not Chrome session teardown. The worker
        # owns the transport until the browser closes or its idle lease expires.
        pass

def serve_cdp_pool():
    os.umask(0o077)
    connections = {}
    generations = {}
    targets = {}
    identities = {}
    def identity_token(key):
        connection = connections[key]
        return identities[key] + (":" + str(getattr(connection, "live_url_epoch", 0)) if getattr(connection, "viewer_channel", False) else "")
    def save_health():
        private_json(os.path.join(ROOT, "cdp-health.json"), {key:identity_token(key) for key in identities})
    save_health()
    idle_until = time.time() + 30
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(cdp_pool_path())
    os.chmod(cdp_pool_path(), 0o600)
    server.listen(8)
    server.settimeout(0.25)
    idle_cursor = 0
    def discard(key):
        connection = connections.pop(key, None)
        generations.pop(key, None)
        targets.pop(key, None)
        identities.pop(key, None)
        save_health()
        if connection:
            connection.close()
    try:
        while time.time() < idle_until:
            try:
                client, _ = server.accept()
            except socket.timeout:
                # Service WebSocket pings/events while the model or user thinks.
                # Yield promptly to tool calls, even with many busy connections.
                idle_deadline = time.monotonic() + 0.02
                idle_connections = list(connections.items())
                if idle_connections:
                    idle_cursor %= len(idle_connections)
                    idle_connections = idle_connections[idle_cursor:] + idle_connections[:idle_cursor]
                for key, connection in idle_connections:
                    if time.monotonic() >= idle_deadline or select.select([server], [], [], 0)[0]:
                        break
                    idle_cursor += 1
                    try:
                        for _ in range(32):
                            if time.monotonic() >= idle_deadline or select.select([server], [], [], 0)[0]:
                                break
                            prior_epoch = getattr(connection, "live_url_epoch", 0)
                            ready = connection.poll_idle()
                            if getattr(connection, "live_url_epoch", 0) != prior_epoch: save_health()
                            if not ready: break
                    except Exception:
                        discard(key)
                continue
            with client:
                client.settimeout(65)
                with client.makefile("rwb") as stream:
                    message = {}
                    try:
                        line = stream.readline(CDP_POOL_MESSAGE_LIMIT + 1)
                        if not line or len(line) > CDP_POOL_MESSAGE_LIMIT:
                            raise RuntimeError("Invalid persistent browser request")
                        message = json.loads(line)
                        if message.get("protocol") != CDP_POOL_PROTOCOL:
                            raise RuntimeError("Incompatible persistent browser connection")
                        operation = message.get("operation")
                        key = message.get("key")
                        if operation == "ping":
                            value = True
                        else:
                            idle_until = min(float(message.get("idleUntil", time.time())), time.time() + 900)
                            if operation == "connect":
                                endpoint = message["endpoint"]
                                browserless_url(endpoint)
                                parsed = urllib.parse.urlparse(endpoint)
                                generation = message.get("generation") or parsed.path
                                # Decoration and live-view creation use independent sockets.
                                # Input recovery must never retire the live URL creator.
                                channel = ":" + message["channel"] if message.get("channel") in ("visual", "diagnostic", "viewer") else ""
                                key = hashlib.sha256((str(generation) + ":" + parsed.netloc + "#" + parsed.fragment + channel).encode()).hexdigest()
                                if key not in connections:
                                    if len(connections) >= CDP_POOL_LIMIT:
                                        raise RuntimeError("Persistent browser connection limit reached")
                                    connections[key] = DirectCDP(endpoint)
                                    connections[key].optional_channel = bool(channel)
                                    connections[key].viewer_channel = message.get("channel") == "viewer"
                                    generations[key] = generation
                                    targets[key] = parsed.fragment
                                    identities[key] = os.urandom(16).hex()
                                    save_health()
                                value = key
                            else:
                                connection = connections.get(key)
                                if connection is None:
                                    raise RuntimeError("The persistent browser connection ended; inspect the page again. The action was not replayed")
                                if operation == "command":
                                    method = message["method"]
                                    value = connection.command(method, message.get("params"), timeout=min(60, max(0.1, float(message.get("timeout", 20)))), session_id=message.get("sessionId"))
                                    if method == "Browser.close":
                                        generation = generations[key]
                                        for closed_key in list(connections):
                                            if generations.get(closed_key) == generation:
                                                discard(closed_key)
                                        if not connections:
                                            idle_until = time.time()
                                    elif method == "Target.closeTarget" and value.get("success"):
                                        target = (message.get("params") or {}).get("targetId")
                                        for closed_key in list(connections):
                                            if targets.get(closed_key) == target:
                                                discard(closed_key)
                                elif operation == "read_commands":
                                    value = connection.read_commands(message.get("commands"), timeout=min(60, max(0.1, float(message.get("timeout", 20)))), session_id=message.get("sessionId"), settled=message.get("settled") is True)
                                elif operation == "reference_query":
                                    value = connection.reference_query(message.get("contexts"), message.get("ref"))
                                elif operation == "existing_locator_query":
                                    value = connection.existing_locator_query(message.get("contexts"),message.get("locator"))
                                elif operation == "frame_values":
                                    value = connection.frame_values(message.get("kind"), message.get("contexts"), message.get("counter"))
                                elif operation == "reference_routes":
                                    value = connection.reference_routes(message.get("ref"), message.get("updates"))
                                elif operation == "reference_maps":
                                    value = connection.reference_maps(message.get("requests", []), updates=message.get("updates"))
                                elif operation == "reference_backend":
                                    value = connection.reference_backend(message.get("sessionId"), message.get("frameId"), message.get("documentId"), message.get("ref"), message.get("token"))
                                elif operation == "type_keys":
                                    delay = message.get("delay", 0.006)
                                    if delay not in (0, 0.006): raise RuntimeError("Invalid ordinary key delay")
                                    value = connection.type_keys(message.get("text"), delay=delay)
                                elif operation == "frame_is_live":
                                    value = connection.frame_is_live(message["frameId"], message.get("sessionId"))
                                elif operation == "identity":
                                    value = {"key": key, "token": identity_token(key)}
                                elif operation == "clear_events":
                                    value = connection.clear_events()
                                elif operation == "observations":
                                    connection.pump_events(0.01)
                                    value = connection.observations()
                                elif operation == "take_events":
                                    value = connection.take_events()
                                elif operation == "pump_events":
                                    value = connection.pump_events(min(1, max(0, float(message.get("timeout", 0.1)))))
                                else:
                                    raise RuntimeError("Unsupported persistent browser request")
                        if operation not in ("ping", "connect") and key in connections and getattr(connections[key], "viewer_channel", False): save_health()
                        response = {"ok": True, "value": value}
                    except Exception as error:
                        # A command deadline does not mean the socket closed. Keep
                        # the main action transport, report the failure unchanged,
                        # and never resend the command. DirectCDP retains partial
                        # frames and ignores late replies by ID on the next read.
                        # Optional decoration channels may still be discarded.
                        timed_out = str(error).startswith("CDP command ") and " timed out" in str(error)
                        current = connections.get(message.get("key")) if isinstance(message, dict) else None
                        retain_timeout = timed_out and current is not None and not getattr(current, "optional_channel", False)
                        if isinstance(error, (OSError, EOFError)) or (not retain_timeout and str(error).startswith(("Cloud Chrome closed", "CDP command "))):
                            discard(message.get("key") if isinstance(message, dict) else None)
                        response = {"ok": False, "error": str(error).replace(os.environ.get("BROWSERLESS_API_TOKEN", "__no_token__"), "[redacted]")}
                    try:
                        stream.write(json.dumps(response, separators=(",", ":")).encode() + b"\n")
                        stream.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        pass  # The caller left; never repeat its command.
    finally:
        # Match the existing two-minute idle lease (or active takeover/session
        # cap). Keeping a CDP socket open must not keep a paid browser forever.
        closed_generations = set()
        for key, connection in list(connections.items()):
            generation = generations.get(key)
            if generation not in closed_generations:
                try:
                    connection.command("Browser.close", timeout=2)
                except Exception:
                    pass
                closed_generations.add(generation)
            connection.close()
        identities.clear()
        save_health()
        server.close()
        try:
            os.remove(cdp_pool_path())
        except FileNotFoundError:
            pass

# Embedded/offline evaluators can still use the direct transport. Production
# controller files share the account's private pool across Python processes.
CDP = PooledCDP if "__file__" in globals() else DirectCDP
`;
