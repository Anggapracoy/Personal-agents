const extensions: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
export const videoMimeTypes = new Set(Object.values(extensions));
export function videoMimeForName(name: string) { return extensions[name.split(".").at(-1)?.toLowerCase() ?? ""] ?? null; }
/** Retained videos from older runs were stored as generic binary files. */
export function videoMimeForArtifact(artifact: { name: string; mimeType: string }) {
  return videoMimeTypes.has(artifact.mimeType) ? artifact.mimeType : artifact.mimeType === "application/octet-stream" ? videoMimeForName(artifact.name) : null;
}
