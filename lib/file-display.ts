/** Friendly labels shared by uploaded messages and draft attachments. */
export function uploadedFileName(name: string) {
  return name.replace(/^uploaded-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}

export function fileDescription(name: string, mimeType: string, size?: number) {
  const extension = name.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toUpperCase();
  const kind = mimeType.startsWith("image/") ? "Image" : extension ? `${extension} file` : "File";
  if (size === undefined) return kind;
  const bytes = size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${kind} · ${bytes}`;
}
