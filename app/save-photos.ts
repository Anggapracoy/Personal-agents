"use client";
import { postNativeMessage, type NativeWindow } from "./native-bridge";

export async function savePhotos(urls: string[]): Promise<string> {
  if ((window as NativeWindow).__decisionFeedNativeSavePhotos) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => { cleanup(); reject(new Error("Saving timed out. Please try again.")); }, 120_000);
      const listener = (event: Event) => {
        const result = (event as CustomEvent).detail;
        if (result?.requestId !== requestId) return;
        cleanup();
        if (result.ok) resolve("Saved to Photos");
        else reject(new Error(result.error || "Couldn’t save the photos."));
      };
      const cleanup = () => { clearTimeout(timeout); window.removeEventListener("decisionFeed:photosSaved", listener); };
      window.addEventListener("decisionFeed:photosSaved", listener);
      postNativeMessage({ version: 1, action: "savePhotos", payload: { requestId, paths: urls.map(url => new URL(url, location.origin).pathname) } });
    });
  }
  for (const [index, url] of urls.entries()) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Couldn’t download the photo. Please try again.");
    const blob = await response.blob();
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(blob.type)) throw new Error("This file isn’t a supported photo.");
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `dash-photo-${index + 1}.${blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1]}`;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
  return "Download started";
}
