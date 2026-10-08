import { browserSessionExpired } from "./browser/takeover-recovery";

/** Transferring a session and observing the redirected page are separate outcomes. */
export async function transferSignInSession<T>(importSession: () => Promise<unknown>, observePage: () => Promise<T>, releaseControl: () => Promise<unknown>): Promise<{ sessionTransferred: true; page?: T; observationPending: boolean }> {
  // Completing phone sign-in returns this run to automation. Await release so
  // the controller does not reject cookie import under an active takeover lease.
  try {
    await releaseControl();
  } catch (error) {
    // An expired browser has no active takeover to release. Cookie import is
    // already allowed to create a fresh browser and restore this user's profile.
    // All other release failures still block import into a controlled session.
    if (!browserSessionExpired(error)) throw error;
  }
  await importSession();
  try {
    return { sessionTransferred: true, page: await observePage(), observationPending: false };
  } catch {
    // Redirects can invalidate a page context after cookies were already applied.
    return { sessionTransferred: true, observationPending: true };
  }
}
