import { pathToFileURL } from "node:url";

/** Run after the deployment is ready, never in an interactive message request. */
export async function syncInngest(origin, fetcher = fetch) {
  const url = new URL("/api/inngest", origin);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Use HTTPS or a local development server.");
  const response = await fetcher(url, { method: "PUT", headers: { "cache-control": "no-store" }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Inngest registration failed (${response.status}).`);
  const result = await response.json();
  if (result.error) throw new Error("Inngest registration was rejected.");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/sync-inngest.mjs https://your-deployment.example");
  await syncInngest(process.argv[2]);
  console.log("Inngest functions registered successfully.");
}
