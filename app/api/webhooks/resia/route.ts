import { handleResiaWebhook } from "../../../../lib/harness/resia-webhook";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) { return handleResiaWebhook(request); }
