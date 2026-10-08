import { withRequestBodyLimit } from "../../../lib/request-body-limit";
import { serve } from "inngest/next";
import { inngest } from "../../../lib/harness/inngest-client";
import { inngestFunctions } from "../../../lib/harness/inngest";

// Give individual durable steps enough room to checkpoint before Vercel stops
// the invocation. The scan itself remains resumable and continues server-side
// after the phone or browser closes.
export const maxDuration = 300;

const handlers = serve({
  client: inngest,
  functions: inngestFunctions,
});

export const GET = handlers.GET;
export const POST = withRequestBodyLimit(handlers.POST, 16 * 1024 * 1024);
export const PUT = withRequestBodyLimit(handlers.PUT, 16 * 1024 * 1024);
