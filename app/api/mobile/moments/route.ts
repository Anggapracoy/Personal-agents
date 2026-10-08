import { NextResponse } from 'next/server';
import { auth } from '../../../../auth';

// Older installed wrappers still post these events. Acknowledge retirement
// without storing location moments or triggering any notification.
export async function POST() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({error:'Authentication required.'},{status:401});
  return NextResponse.json({accepted:false},{headers:{'cache-control':'private, no-store'}});
}
