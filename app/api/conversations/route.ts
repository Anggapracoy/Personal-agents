import { withRequestBodyLimit } from "../../../lib/request-body-limit";
import { NextResponse } from 'next/server';
import { currentUserEmail } from '../../../lib/auth/session';
import { conversationActionSchema } from '../../../lib/conversation-settings';
import { ConversationSettingsError, getConversationMessages, getConversationSettings, updateConversationSettings } from '../../../lib/conversation-settings-store';
const headers = { 'cache-control': 'private, no-store' };
export async function GET() {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const [settings, messages] = await Promise.all([getConversationSettings(email), getConversationMessages(email)]);
  return NextResponse.json({ settings, messages }, { headers });
}
async function PATCHHandler(request: Request) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const parsed = conversationActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Choose a valid name (1–120 characters) and chat icon.' }, { status: 400 });
  try { return NextResponse.json({ settings: await updateConversationSettings(email, parsed.data) }, { headers }); }
  catch (error) {
    if (error instanceof ConversationSettingsError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export const PATCH = withRequestBodyLimit(PATCHHandler, 1048576);
