import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Template } from "e2b";
import { decisionFeedSandbox } from "./template";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    const separator = line.indexOf("=");
    if (!line || line.startsWith("#") || separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

const alias = process.env.E2B_TEMPLATE_ALIAS ?? "decision-feed-agent";
const build = await Template.build(decisionFeedSandbox, alias, { cpuCount: 2, memoryMB: 2048 });
console.log(JSON.stringify({ templateId: build.templateId, templateName: build.name }));
