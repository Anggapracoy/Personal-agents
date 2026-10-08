import { Sandbox } from "@e2b/code-interpreter";
import { CommandExitError } from "e2b";
import type { SandboxProvider } from "./types";

const ROOT = "/workspace";
const OUTPUT = `${ROOT}/out`;
const MAX_WALL_TIME_MS = 30 * 60_000;

function safePath(path: string) {
  const clean = path.replace(/^\/+/, "");
  if (!clean || clean.split("/").includes("..")) throw new Error("Sandbox paths must stay within /workspace");
  return `${ROOT}/${clean}`;
}

export class E2BSandboxProvider implements SandboxProvider {
  private sandbox: Sandbox | null = null;
  async create() {
    if (this.sandbox) return;
    if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY is not configured");
    if (!process.env.E2B_TEMPLATE_ID) throw new Error("E2B_TEMPLATE_ID is not configured");
    this.sandbox = await Sandbox.create(process.env.E2B_TEMPLATE_ID, {
      apiKey: process.env.E2B_API_KEY,
      allowInternetAccess: true,
      envs: {},
      timeoutMs: MAX_WALL_TIME_MS,
    });
    await this.sandbox.files.makeDir(OUTPUT);
  }
  async destroy() { if (this.sandbox) { await this.sandbox.kill(); this.sandbox = null; } }
  async exec(command: string, options: { timeoutMs?: number } = {}) {
    try {
      const timeoutMs = Math.min(MAX_WALL_TIME_MS, Math.max(1_000, options.timeoutMs ?? 120_000));
      const result = await this.require().commands.run(command, {
        cwd: ROOT,
        // The template installs browser/rendering packages globally. Expose
        // only that module path—never host credentials—to sandboxed Node.
        envs: {
          NODE_PATH: "/usr/local/lib/node_modules:/usr/lib/node_modules",
          PUPPETEER_EXECUTABLE_PATH: "/usr/bin/chromium",
        },
        timeoutMs,
      });
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      if (error instanceof CommandExitError) return { exitCode: error.exitCode, stdout: error.stdout, stderr: error.stderr || error.error || error.message };
      return { exitCode: 1, stdout: "", stderr: error instanceof Error ? error.message : "Sandbox command failed" };
    }
  }
  async writeFile(path: string, bytes: Uint8Array) { const data = new ArrayBuffer(bytes.byteLength); new Uint8Array(data).set(bytes); await this.require().files.write(safePath(path), data); }
  readFile(path: string) { return this.require().files.read(safePath(path), { format: "bytes" }); }
  async listOutputFiles() { const entries = await this.require().files.list(OUTPUT); return entries.filter((entry) => entry.type === "file").map((entry) => entry.name); }
  private require() { if (!this.sandbox) throw new Error("E2B sandbox has not been created"); return this.sandbox; }
}
