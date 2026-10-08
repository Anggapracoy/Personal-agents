"use client";
import { validSharedLocation, type SharedLocation } from "../lib/shared-location";
import { postNativeMessage, type NativeWindow } from "./native-bridge";

export function requestCurrentLocation(signal: AbortSignal): Promise<SharedLocation> {
  return new Promise((resolve, reject) => {
    const native = Boolean((window as NativeWindow).__decisionFeedNativeLocation);
    const requestId = crypto.randomUUID();
    let finished = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (location?: SharedLocation, error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      window.removeEventListener("decisionFeed:locationResult", receive);
      if (native) postNativeMessage({ version: 1, action: "cancelLocation", payload: { requestId } });
      if (error) reject(error);
      else if (validSharedLocation(location)) resolve(location);
      else reject(new Error("Your location could not be read. Try again."));
    };
    const abort = () => finish(undefined, new DOMException("Location sharing cancelled.", "AbortError"));
    const receive = (event: Event) => {
      const result = (event as CustomEvent<{ requestId: string; location?: SharedLocation; error?: string }>).detail;
      if (result?.requestId === requestId) finish(result.location, result.error ? new Error(result.error) : undefined);
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    timeout = setTimeout(() => finish(undefined, new Error("Finding your location took too long. Try again.")), 60_000);
    if (native) {
      window.addEventListener("decisionFeed:locationResult", receive);
      postNativeMessage({ version: 1, action: "requestLocation", payload: { requestId } });
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        ({ coords, timestamp }) => finish({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, capturedAt: new Date(timestamp).toISOString() }),
        (error) => finish(undefined, new Error(error.code === 1 ? "Location access is off. Allow location in your browser settings, then try again." : "Your location could not be found. Try again.")),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
      );
    } else finish(undefined, new Error("Location sharing is not available on this device."));
  });
}
