import { serve } from "inngest/next";
import { inngest } from "../../../lib/harness/inngest-client";
import { inngestFunctions } from "../../../lib/harness/inngest";

// Give individual durable steps enough room to checkpoint before Vercel stops
// the invocation. The scan itself remains resumable and continues server-side
// after the phone or browser closes.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
