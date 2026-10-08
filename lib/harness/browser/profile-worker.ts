// Account-local save queue. This worker owns separate read-only CDP sockets and
// never holds the foreground controller lock while capturing or uploading state.
export const PROFILE_WORKER = String.raw`
PROFILE_DIAGNOSTIC_KEYS = (
    "skippedMalformedCookies", "skippedPrivateCookies", "skippedMalformedOrigins",
    "skippedPrivateOrigins", "truncatedOrigins", "skippedMalformedIdbDatabases",
    "truncatedIdbDatabases", "skippedMalformedIdbStores", "truncatedIdbEntries",
    "skippedMalformedLocalStorageEntries", "skippedMalformedIdbIndexes",
)

def profile_file(name):
    return os.path.join(ROOT, "profile-" + name + ".json")

def read_profile_json(path):
    try:
        with open(path, encoding="utf-8") as handle: return json.load(handle)
    except (FileNotFoundError, ValueError): return {}

def safe_profile_diagnostics(value):
    return {key: value[key] for key in PROFILE_DIAGNOSTIC_KEYS
            if type(value.get(key)) is int and value[key] > 0}

def queue_profile_save():
    generation = BROWSER_STATE.get("generation")
    if not generation: return
    now = time.time()
    prior = read_profile_json(profile_file("pending"))
    status = read_profile_json(profile_file("status"))
    pending = prior.get("generation") == generation and prior.get("id") != status.get("savedRequest")
    private_json(profile_file("pending"), {"generation":generation, "id":os.urandom(16).hex(),
                 "requestedAt":now, "firstRequestedAt":prior.get("firstRequestedAt",now) if pending else now})
    # Queue writes are serialized by the normal account controller lock. The
    # launch lock also closes the worker-exit / new-request race.
    if "__file__" not in globals(): return
    with open(os.path.join(ROOT,"profile-launch.lock"),"a") as launch:
        fcntl.flock(launch,fcntl.LOCK_EX)
        with open(os.path.join(ROOT,"profile-worker.lock"),"a") as worker:
            try: fcntl.flock(worker,fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: return
            subprocess.Popen([sys.executable,os.path.abspath(__file__),"--profile-worker",ROOT],
                             stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                             start_new_session=True,close_fds=True)

def profile_save_due(request, status, now):
    if status.get("generation") != request.get("generation"): status = {}
    if status.get("savedRequest") == request.get("id"): return None
    # Debounce rapid actions, but do not starve saving during continuous input.
    debounce = min(request.get("requestedAt",now)+2,request.get("firstRequestedAt",now)+10)
    return max(debounce,status.get("nextAttemptAt",0))

def save_profile_request(request):
    global BROWSER_STATE, BROWSER_CONNECTION, CDP
    state = read_profile_json(BROWSER_STATE_PATH)
    if state.get("generation") != request.get("generation") or state.get("expiresAt",0) <= time.time(): return
    status = read_profile_json(profile_file("status"))
    if status.get("generation") != state.get("generation"): status = {}
    BROWSER_STATE = state
    BROWSER_STATE["profileExists"] = bool(state.get("profileExists") or status.get("profileExists"))
    # Private sockets: uploads and long storage reads cannot block the action
    # pool. No navigation, input, lease extension, or new browser is allowed.
    CDP = DirectCDP
    BROWSER_CONNECTION = None
    updated = {"generation":state["generation"],"attemptedRequest":request["id"],"attemptedAt":time.time()}
    try:
        BROWSER_CONNECTION = CDP(browserless_url(state["ws"]))
        checkpoint_profile(BROWSER_CONNECTION, True, persist=False)
        updated.update(savedRequest=request["id"],savedAt=time.time(),failures=0,nextAttemptAt=time.time()+30)
    except Exception as error:
        failures = min(8,status.get("failures",0)+1)
        updated.update(failures=failures,errorCode=profile_failure_code(error),
                       diagnostics=safe_profile_diagnostics(getattr(error,"profile_diagnostics",{})),
                       nextAttemptAt=time.time()+min(300,30*2**(failures-1)))
    finally:
        updated["profileExists"] = bool(BROWSER_STATE.get("profileExists"))
        if BROWSER_CONNECTION: BROWSER_CONNECTION.close()
        BROWSER_CONNECTION = None
    # Never overwrite browserless.json: the foreground may have changed viewer
    # leases, tabs, or the reconnect URL during the upload.
    private_json(profile_file("status"),updated)

def serve_profile_worker():
    global BROWSER_STATE_PATH
    BROWSER_STATE_PATH = os.path.join(ROOT,"browserless.json")
    worker = open(os.path.join(ROOT,"profile-worker.lock"),"a")
    try:
        fcntl.flock(worker,fcntl.LOCK_EX)
        while True:
            request = read_profile_json(profile_file("pending"))
            status = read_profile_json(profile_file("status"))
            state = read_profile_json(BROWSER_STATE_PATH)
            due = profile_save_due(request,status,time.time()) if request else None
            stopped = read_profile_json(profile_file("stop")).get("generation") == request.get("generation")
            inactive = stopped or state.get("generation") != request.get("generation") or state.get("expiresAt",0) <= time.time()
            unchanged_failure = status.get("attemptedRequest") == request.get("id") and (
                status.get("errorCode") == "profile_partial_save" or status.get("failures",0) >= 3)
            if due is None or inactive or unchanged_failure:
                with open(os.path.join(ROOT,"profile-launch.lock"),"a") as launch:
                    fcntl.flock(launch,fcntl.LOCK_EX)
                    if read_profile_json(profile_file("pending")) != request: continue
                    fcntl.flock(worker,fcntl.LOCK_UN)
                    return
            if time.time() < due:
                time.sleep(min(1,due-time.time()))
                continue
            save_profile_request(request)
    finally: worker.close()

def flush_profile_before_close():
    # Closing is the one foreground checkpoint boundary. Stop the worker before
    # final capture/deletion, so a late upload cannot resurrect a deleted profile.
    generation = BROWSER_STATE.get("generation")
    if not generation: return
    private_json(profile_file("stop"),{"generation":generation})
    with open(os.path.join(ROOT,"profile-worker.lock"),"a") as worker:
        deadline = time.monotonic()+60
        while True:
            try:
                fcntl.flock(worker,fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline: raise RuntimeError("Profile save is still finishing")
                time.sleep(.05)
        request = read_profile_json(profile_file("pending"))
        status = read_profile_json(profile_file("status"))
        if request.get("generation") == generation and request.get("id") != status.get("savedRequest"):
            BROWSER_STATE["profileExists"] = bool(BROWSER_STATE.get("profileExists") or status.get("profileExists"))
            try: checkpoint_profile(BROWSER_CONNECTION,True)
            except Exception as error: profile_failure_diagnostic(error)

def profile_save_warning():
    status = read_profile_json(profile_file("status"))
    if status.get("generation") == BROWSER_STATE.get("generation") and status.get("errorCode"):
        if globals().get("DIAGNOSTICS_ENABLED",False):
            print("DASH_DIAGNOSTIC " + json.dumps({"stage":"profile_save_background", "errorCode":status["errorCode"]},separators=(",",":")),flush=True)
            for name,count in safe_profile_diagnostics(status.get("diagnostics",{})).items():
                print("DASH_DIAGNOSTIC " + json.dumps({"stage":"profile_save_background", "name":name,"dropped":count},separators=(",",":")),flush=True)
        return "Background login-state saving is incomplete; the current browser remains usable."
    return None
`;
