import { withRequestBodyLimit } from "../../../../lib/request-body-limit";
import { handleResiaWebhook } from "../../../../lib/harness/resia-webhook";
export const runtime = "nodejs";
export const maxDuration = 60;
async function POSTHandler(request: Request) { return handleResiaWebhook(request); }

export const POST = withRequestBodyLimit(POSTHandler, 65536);
