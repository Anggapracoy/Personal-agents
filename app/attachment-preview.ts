// Keep a File's preview stable across composer and optimistic-message mounts.
const previews = new Map<File, string>();
const aliases = new Map<string, string>();
const warmed = new Map<string, HTMLImageElement>();
export function attachmentPreview(file: File): string {
  let url = previews.get(file);
  if (!url) {
    url = URL.createObjectURL(file); previews.set(file, url);
    if (previews.size > 48) {
      const [old, expired] = previews.entries().next().value!;
      previews.delete(old);
      for (const [remote, local] of aliases) if (local === expired) aliases.delete(remote);
      URL.revokeObjectURL(expired);
    }
  }
  return url;
}
export function retainPhotoPreview(remote: string, file: File) { aliases.set(remote, attachmentPreview(file)); }
export function photoSource(url: string) { return aliases.get(url) ?? url; }
export function warmPhoto(url: string) {
  if (typeof Image === 'undefined' || warmed.has(url)) return;
  const image = new Image(); image.src = photoSource(url); warmed.set(url, image);
  if (warmed.size > 64) warmed.delete(warmed.keys().next().value!);
}
export function clearPhotoPreviews() {
  for (const url of previews.values()) URL.revokeObjectURL(url);
  previews.clear(); aliases.clear(); warmed.clear();
}
const thumbnails = new WeakMap<File, Promise<string>>();
export function attachmentThumbnail(file: File): Promise<string> {
  const existing = thumbnails.get(file); if (existing) return existing;
  const result = (async () => {
    const image = new Image(); image.src = attachmentPreview(file); await image.decode();
    const scale = Math.min(1, 240 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  })();
  thumbnails.set(file, result); return result;
}
