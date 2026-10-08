import { getProfilePhoto } from "../lib/profile-photo";
import { auth } from "../auth";
import { headers } from "next/headers";
import Landing from "./landing";
import Workspace from "./workspace";
import { listConnectedGoogleAccounts } from "../lib/auth/google-connections";
import { proactiveEngineEnabled } from "../lib/proactive/engine/candidates";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requestHeaders = await headers();
  const params = await searchParams;
  const localUiPreview = process.env.NODE_ENV !== "production" && params.uiPreview === "1";
  const isNativeApp = /\bDecisionFeed-iOS\/\d+\b/.test(requestHeaders.get("user-agent") || "");
  const session = await auth();
  const email = session?.user?.email;
  if (localUiPreview) return <Workspace user={{ email: "michael@example.com", name: "Michael" }} googleConnected previewMode previewScanState={params.scanPreview === "arriving" ? "arriving" : params.scanPreview === "empty" ? "empty" : params.scanPreview === "first" ? "first" : params.scanPreview === "confirm" ? "confirm" : params.scanPreview === "scanning" ? "scanning" : "idle"} />;
  if (!isNativeApp || !email) return <Landing />;
  const [storedConnections, proactiveV2, profilePhoto] = await Promise.all([
    listConnectedGoogleAccounts(email).catch(() => []),
    proactiveEngineEnabled(email).catch(() => false),
    getProfilePhoto(email).catch(() => null),
  ]);
  return <Workspace user={{ email, name: session.user?.name?.trim() || email.split("@")[0], image: session.user?.image ?? null, profilePhoto }} googleConnections={storedConnections} googleConnected={storedConnections.some((connection) => connection.enabled && !connection.needsReconnect)} proactiveV2={proactiveV2} />;
}
