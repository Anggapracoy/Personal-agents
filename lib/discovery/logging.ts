import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscoveryRefreshAuditEvent } from "./types";

type RefreshLogEvent = DiscoveryRefreshAuditEvent | {
  stage: "refresh";
  status: "start" | "sources" | "complete" | "failed";
  details: Record<string, unknown>;
} | {
  stage: "source_email";
  emailId: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
};

export function createDiscoveryRefreshLogger(refreshId: string) {
  const directory = process.env.VERCEL
    ? join(tmpdir(), "decision-discovery", "logs")
    : join(process.cwd(), ".decision-discovery", "logs");
  const file = join(directory, `${refreshId}.jsonl`);
  const latest = join(directory, "latest.jsonl");
  let writable = true;
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(file, "", "utf8");
    writeFileSync(latest, "", "utf8");
  } catch (error) {
    writable = false;
    console.warn("[decision-discovery] local audit log unavailable", error instanceof Error ? error.message : String(error));
  }

  return {
    file,
    write(event: RefreshLogEvent) {
      if (!writable) return;
      const row = `${JSON.stringify({ at: new Date().toISOString(), refreshId, ...event })}\n`;
      try {
        appendFileSync(file, row, "utf8");
        appendFileSync(latest, row, "utf8");
      } catch (error) {
        writable = false;
        console.warn("[decision-discovery] local audit log stopped", error instanceof Error ? error.message : String(error));
      }
    },
  };
}
