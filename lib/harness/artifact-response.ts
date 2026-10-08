import { videoMimeForArtifact } from "./video-format";

/** Called only after checking conversation ownership. Byte ranges allow video seeking in WebKit. */
export function artifactResponse(request: Request, artifact: { name: string; mimeType: string; bytesBase64: string }) {
  const bytes = Buffer.from(artifact.bytesBase64, "base64");
  const videoType = videoMimeForArtifact(artifact);
  const download = new URL(request.url).searchParams.get("download") === "1";
  const name = artifact.name.replace(/["\r\n\\]/g, "_");
  const headers = new Headers({
    "content-type": videoType ?? artifact.mimeType,
    "content-disposition": `${videoType && !download ? "inline" : "attachment"}; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-length": String(bytes.length),
  });
  if (videoType) headers.set("accept-ranges", "bytes");
  const range = request.headers.get("range");
  if (videoType && range && request.method !== "HEAD") {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= bytes.length || start > end) {
        headers.set("content-range", `bytes */${bytes.length}`);
        headers.set("content-length", "0");
        return new Response(null, { status: 416, headers });
      }
      headers.set("content-range", `bytes ${start}-${end}/${bytes.length}`);
      headers.set("content-length", String(end - start + 1));
      return new Response(bytes.subarray(start, end + 1), { status: 206, headers });
    }
    // Unsupported/multiple ranges are ignored and receive the complete representation.
  }
  return new Response(request.method === "HEAD" ? null : bytes, { headers });
}
