import { withRequestBodyLimit } from "../../../../lib/request-body-limit";

import { ICloudConnectionError } from "../../../../lib/mail/icloud-client";
import { enqueueManualScan } from "../../../../lib/discovery/manual-scan-jobs";
import { requestInitialSignupScan } from "../../../../lib/workspace-state";
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUserEmail } from '../../../../lib/auth/session';
import { sameOrigin } from '../../../../lib/http-security';
import { enforceApiQuota } from '../../../../lib/api-quota';
import { listICloudAccounts, connectICloudAccount, disconnectICloudAccount } from '../../../../lib/mail/icloud-store';
import { inngest } from '../../../../lib/harness/inngest-client';
export const maxDuration = 90;
const connect = z.object({ ownerEmail: z.string().email().max(254), email: z.string().max(254), password: z.string().max(64) }).strict();
export async function GET() {
  const owner = await currentUserEmail();
  if (!owner) return NextResponse.json({ error: 'Sign in to Dash first.' }, { status: 401 });
  return NextResponse.json({ accounts: await listICloudAccounts(owner) }, { headers: { 'cache-control': 'private, no-store' } });
}
async function POSTHandler(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Connection blocked.' }, { status: 403 });
  const owner = await currentUserEmail();
  if (!owner) return NextResponse.json({ error: 'Sign in to Dash first.' }, { status: 401 });
  const limited = await enforceApiQuota(owner, 'run'); if (limited) return limited;
  const raw = await request.text(); if (raw.length > 2048) return NextResponse.json({ error: 'Invalid connection.' }, { status: 400 });
  let value: unknown; try { value = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid connection.' }, { status: 400 }); }
  const parsed = connect.safeParse(value); if (!parsed.success) return NextResponse.json({ error: 'Enter your iCloud email and app-specific password.' }, { status: 400 });
  if (parsed.data.ownerEmail.trim().toLowerCase() !== owner.trim().toLowerCase()) return NextResponse.json({ error: "Your account changed. Open Connected apps again." }, { status: 409 });
  try {
    const account = await connectICloudAccount(owner, parsed.data.email, parsed.data.password);
    let scanQueued = true;
    try {
      await requestInitialSignupScan(owner);
      const queued = await enqueueManualScan({ ownerEmail: owner, forceFullScan: false });
      if (queued.created) await inngest.send({ name: 'decision-feed/manual.scan.requested', data: { ownerEmail: owner, jobId: queued.job.id } });
      else await inngest.send({ name: 'decision-feed/icloud.scan.requested', data: { ownerEmail: owner, accountId: account.id } });
    }
    catch { scanQueued = false; }

    return NextResponse.json({ account, scanQueued }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) { return NextResponse.json({ error: error instanceof ICloudConnectionError ? error.message : 'Couldn’t save this connection. Try again in a moment.' }, { status: 400 }); }
}
async function DELETEHandler(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Connection blocked.' }, { status: 403 });
  const owner = await currentUserEmail(); if (!owner) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id'); if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid account.' }, { status: 400 });
  await disconnectICloudAccount(owner, id!);  return NextResponse.json({ disconnected: true });
}

export const POST = withRequestBodyLimit(POSTHandler, 2048);

export const DELETE = withRequestBodyLimit(DELETEHandler, 2048);
