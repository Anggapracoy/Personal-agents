import { Sandbox } from "@e2b/code-interpreter";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";

const existing = "artifacts/browser-capabilities/fixture.json";
const sandbox = existsSync(existing) ? await Sandbox.connect(JSON.parse(readFileSync(existing, "utf8")).sandboxId) : await Sandbox.create({ timeoutMs: 30 * 60_000 });
await sandbox.setTimeout(30 * 60_000);
await sandbox.files.write("/home/user/index.html", readFileSync("scripts/fixtures/browser-capabilities.html", "utf8"));
await sandbox.commands.run("python3 -m http.server 8000 --directory /home/user", { background: true, timeoutMs: 0 });
const url = `https://${sandbox.getHost(8000)}/index.html`;
mkdirSync("artifacts/browser-capabilities", { recursive: true });
writeFileSync("artifacts/browser-capabilities/fixture.json", JSON.stringify({ sandboxId: sandbox.sandboxId, url }, null, 2));
console.log(JSON.stringify({ sandboxId: sandbox.sandboxId, url }));
