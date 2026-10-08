export type ChatUpload = { name: string; mimeType: string; dataBase64: string };
export const CHAT_FILE_LIMIT = 3 * 1024 * 1024;
export const CHAT_FILE_COUNT = 6;

// Camera photos commonly exceed the request-body budget after base64 encoding.
// Resize them before they become draft attachments, leaving other files intact.
export async function prepareChatFiles(files: File[], availableBytes = CHAT_FILE_LIMIT): Promise<File[]> {
  const images = files.filter(file => file.type.startsWith('image/')).length;
  const otherBytes = files.filter(file => !file.type.startsWith('image/')).reduce((sum, file) => sum + file.size, 0);
  const imageBudget = Math.min(2 * 1024 * 1024, Math.floor((availableBytes - otherBytes) / Math.max(1, images)));
  if (otherBytes > availableBytes) throw new Error('Other files can total up to 3 MB per message.');
  if (images && imageBudget < 32 * 1024) throw new Error('These attachments are too large. Try fewer files.');
  return Promise.all(files.map(async file => file.type.startsWith('image/') && file.size > imageBudget ? resizeChatPhoto(file, imageBudget) : file));
}

async function resizeChatPhoto(file: File, maxBytes: number): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    for (const maxSide of [2048, 1600, 1280, 1024, 768]) {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) break;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.72, 0.58]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.type === 'image/jpeg' && blob.size <= maxBytes) {
          return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
        }
      }
    }
  } catch { /* The format may not be decodable by this browser. */ }
  finally { URL.revokeObjectURL(url); }
  throw new Error('Couldn’t prepare that photo. Try a different image.');
}
export async function encodeChatFiles(files: File[] = []): Promise<ChatUpload[]> {
  if (files.length > CHAT_FILE_COUNT || files.reduce((total, file) => total + file.size, 0) > CHAT_FILE_LIMIT) throw new Error('Attach up to 6 files, 3 MB total.');
  return Promise.all(files.map(async file => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return {name: file.name, mimeType: file.type || 'application/octet-stream', dataBase64: btoa(binary)};
  }));
}
export function attachmentReplyText(text: string, files: File[]) {
  return [text.trim(), files.length ? `Attached: ${files.map(file => file.name).join(', ')}` : ''].filter(Boolean).join('\n\n');
}
