/** Evaluation-only timing wrappers; production code and browser behavior stay unchanged. */
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { ONE_SHOT_INSTRUMENTATION } from './browser-one-shot-instrumentation';

const output = process.env.COMPARISON_OUTPUT_DIR;
const database = process.env.COMPARISON_DATABASE_URL;
if (!output || !database || new URL(database).hostname !== "127.0.0.1") throw new Error("Isolated profiling configuration required");
process.env.DATABASE_URL = database;
delete process.env.INNGEST_EVENT_KEY;
mkdirSync(output, { recursive: true });
const spans: Array<{ id: number; parent?: number; name: string; startMs: number; elapsedMs?: number; error?: boolean }> = [];
const controllers: Array<{ span?: number; data: unknown }> = [];
const profileWorkers: unknown[] = [];
const oneShot: unknown[] = [];
const commandStreams: Array<{span?:number;firstStdoutMs?:number;lastStdoutMs?:number;finishedMs?:number;stdoutBytes:number}> = [];
const context = new AsyncLocalStorage<number>();
const epoch = performance.now();
const epochAt = Date.now();
async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const row = { id: spans.length, parent: context.getStore(), name, startMs: performance.now() - epoch, elapsedMs: undefined as number | undefined, error: undefined as boolean | undefined };
  spans.push(row);
  try { return await context.run(row.id, fn); }
  catch (error) { row.error = true; throw error; }
  finally { row.elapsedMs = performance.now() - epoch - row.startMs; }
}
const pythonTiming = String.raw`
# Evaluation-only measurements: aggregate names/counts/times, never arguments.
if not (len(sys.argv) == 3 and sys.argv[1] == "--cdp-pool"):
    import atexit
    _profile_worker = len(sys.argv) == 3 and sys.argv[1] == "--profile-worker"
    if _profile_worker: CDP = DirectCDP
    _profile_stats = {}
    _profile_stack = []
    def _profile_wrap(label, original):
        def measured(*args, **kwargs):
            started = time.perf_counter()
            started_at = time.time()
            frame = {"children": 0.0, "label": label}
            _profile_stack.append(frame)
            try:
                return original(*args, **kwargs)
            finally:
                elapsed = time.perf_counter() - started
                _profile_stack.pop()
                if _profile_stack:
                    _profile_stack[-1]["children"] += elapsed
                row = _profile_stats.setdefault(label, {"count": 0, "totalMs": 0.0, "selfMs": 0.0})
                row["count"] += 1
                row["totalMs"] += elapsed * 1000
                row["selfMs"] += (elapsed - frame["children"]) * 1000
                if _profile_worker and label == "save_profile_request":
                    private_json(os.path.join(ROOT, "profile-timing-" + str(os.getpid()) + ".json"), {"startedAtMs":started_at*1000, "elapsedMs":elapsed*1000, "stats":_profile_stats})
        return measured
    for _name in ("main", "connect_browser", "choose_target", "execute_request", "finish_browser", "checkpoint_profile", "capture_profile_state", "capture_profile_state_once", "save_profile_request", "browserless_api", "frame_contexts", "extended_query", "find_ref", "describe", "preflight_ref", "accessibility_identity", "prefetch_accessibility", "dom_ref_map", "accessibility_ref_identity", "accessibility_rows", "accessibility_text", "snapshot", "ready", "replace_field_text", "set_secret_mask", "evaluate", "evaluate_context", "inspect_ref", "recover_missing_hosted_fields", "browser_diagnostic", "visual_cursor", "wait_for_input_ready", "assert_frame_uncovered"):
        if _name in globals():
            globals()[_name] = _profile_wrap(_name, globals()[_name])
    _profile_command = CDP.command
    def _measured_command(self, method, *args, **kwargs):
        caller = next((frame["label"] for frame in reversed(_profile_stack) if frame["label"] not in ("evaluate", "evaluate_context")), "unattributed")
        return _profile_wrap("CDP." + method + "@" + caller, _profile_command)(self, method, *args, **kwargs)
    CDP.command = _measured_command
    _profile_reads = CDP.read_commands
    def _measured_reads(self, commands, *args, **kwargs):
        label = "CDP.frame_discovery_batch" if commands and commands[0].get("method") == "Page.getFrameTree" else "CDP.observation_batch"
        return _profile_wrap(label, _profile_reads)(self, commands, *args, **kwargs)
    CDP.read_commands = _measured_reads
    CDP.reference_query = _profile_wrap("CDP.reference_query", CDP.reference_query)
    CDP.reference_backend = _profile_wrap("CDP.reference_backend", CDP.reference_backend)
    CDP.frame_values = _profile_wrap("CDP.frame_values", CDP.frame_values)
    CDP.reference_maps = _profile_wrap("CDP.reference_map_cache", CDP.reference_maps)
    _profile_sleep = time.sleep
    def _measured_sleep(*args, **kwargs):
        caller = _profile_stack[-1]["label"] if _profile_stack else "unattributed"
        return _profile_wrap("sleep", _profile_wrap("sleep@" + caller, _profile_sleep))(*args, **kwargs)
    time.sleep = _measured_sleep
    atexit.register(lambda: sys.stderr.write("DASH_TIMING " + json.dumps(_profile_stats, separators=(",", ":")) + "\n"))
`;

const { BrowserlessCloudBrowserProvider } = await import("../lib/harness/browser/cloud");
// Instrument private methods only in this diagnostic process.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prototype = BrowserlessCloudBrowserProvider.prototype as any;
if (process.env.BROWSER_COLOCATION_PROBE === "1") (await import("./browser-colocation-profile")).installColocationProfile(prototype);
const seen = new WeakSet<object>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attachIO(sandbox: any) {
  if (!sandbox || seen.has(sandbox)) return;
  seen.add(sandbox);
  for (const method of ["write", "read", "remove"]) {
    const original = sandbox.files[method].bind(sandbox.files);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sandbox.files[method] = (...args: any[]) => timed(`files.${method}`, async () => {
      if (method === "write" && typeof args[1] === "string" && args[1].startsWith("#!/usr/bin/env python3") && args[1].includes('def execute_request(request, target):')) {
        if (process.env.BROWSER_PROFILE_CONTROLLER_BASELINE === "1") {
          args[1] = args[1].replace('if hasattr(cdp, "read_commands"):\n        try:\n            cdp.snapshot_native_reads', 'if False:\n        try:\n            cdp.snapshot_native_reads').replace('if refs is None and hasattr(cdp, "read_commands"):', 'if False:')
            .replace('if stage in ("before_reconnect", "after_reconnect") or (stage == "operation_end" and getattr(cdp, "diagnostic_after_operation", False)):', 'if False:');
        }
        args[1] = args[1].replace('if __name__ == "__main__":', pythonTiming + (process.env.BROWSER_ONE_SHOT === '1' ? ONE_SHOT_INSTRUMENTATION : '') + '\nif __name__ == "__main__":');
      }
      return original(...args);
    });
  }
  const command = sandbox.commands.run.bind(sandbox.commands);
  sandbox.commands.run = (...args: any[]) => timed("sandbox.commands.run", async () => {
    const stream: typeof commandStreams[number] = {span:context.getStore(),stdoutBytes:0};
    commandStreams.push(stream);
    const onStdout=args[1]?.onStdout;
    args[1]={...args[1],onStdout:(chunk:string)=>{
      const now=performance.now()-epoch;
      stream.firstStdoutMs ??= now;stream.lastStdoutMs=now;stream.stdoutBytes+=Buffer.byteLength(chunk);
      return onStdout?.(chunk);
    }};
    const collect = (stderr: unknown) => {
      for (const line of String(stderr ?? '').split('\n')) {
        if (line.startsWith('DASH_TIMING ')) controllers.push({span:context.getStore(),data:JSON.parse(line.slice(12))});
        if (line.startsWith('DASH_ONESHOT ')) oneShot.push({span:context.getStore(),data:JSON.parse(line.slice(13))});
      }
    };
    try {
      const value = await command(...args);
      collect(value.stderr);
      return value;
    } catch (error) {
      collect((error as {stderr?:string;result?:{stderr?:string}})?.stderr ?? (error as {result?:{stderr?:string}})?.result?.stderr);
      throw error;
    } finally {stream.finishedMs=performance.now()-epoch;}
  });
  const timeout = sandbox.setTimeout.bind(sandbox);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox.setTimeout = (...args: any[]) => timed("sandbox.setTimeout", () => timeout(...args));
}
// Controlled transport baseline: identical script API and guards, separate
// query/preflight controller trips as before consolidation. Diagnostic only.
if (process.env.BROWSER_SEPARATE_PREFLIGHT === "1") {
  prototype.preflightLocator = async function (locator: Record<string, unknown>, fullPage: boolean) {
    const { matches } = await this.extended({ action: "query", locator });
    if (matches.length > 1) throw new Error(`Locator matched ${matches.length} elements; refine it`);
    if (!matches.length) return { matches };
    const ref = matches[0].ref;
    return { matches, ref, ...await this.preflightRef(ref, fullPage) };
  };
}
for (const name of ["warm", "open", "navigate", "snapshot", "inspect", "describeRef", "preflightRef", "preflightLocator", "type", "select", "setChecked", "screenshot", "initializeAccount", "attachProvider", "run", "runControllerCommand"]) {
  const original = prototype[name];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prototype[name] = function (...args: any[]) {
    return timed(name + (name === "run" ? `:${args[0]}` : name === "runControllerCommand" ? `:${args[1]}` : ""), async () => {
      if (name === "attachProvider" || name === "runControllerCommand") attachIO(this.account.sandbox);
      const value = await original.apply(this, args);
      if (name === "runControllerCommand" && args[1] === "close_browser") {
        try {
          const sandbox = args[0];
          for (const entry of await sandbox.files.list("/home/user/.decision-feed")) {
            if (/^profile-timing-\d+\.json$/.test(entry.name)) profileWorkers.push(JSON.parse(await sandbox.files.read(`/home/user/.decision-feed/${entry.name}`)));
          }
        } catch { profileWorkers.push({ timingReadFailed: true }); }
      }
      return value;
    });
  };
}
process.on("exit", () => writeFileSync(`${output}/timings.json`, JSON.stringify({ epochAt, spans, controllers, profileWorkers, commandStreams, oneShot, note: "Nested spans overlap; sum self time or disjoint roots, never all inclusive durations. Python CDP timings include pooled transport/network wait. Instrumentation is diagnostic only." }, null, 2)));
if (process.env.LIVE_BROWSER_PROFILE === "1") await import("./browser-live-speed-profile");
else await import("./browser-three-way-comparison");
