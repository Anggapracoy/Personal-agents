import type { SharedIntakeFile } from './shared-intake';

export const MAX_SHARED_FILE_BYTES = 3 * 1024 * 1024;
export const MAX_SHARED_FILES = 6;

export function parseSharedIntakeFiles(value: unknown): SharedIntakeFile[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SHARED_FILES) throw new Error('Share up to 6 files.');
  let total = 0;
  return value.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('A shared file is invalid.');
    const file = raw as Record<string, unknown>;
    const dataBase64 = typeof file.dataBase64 === 'string' ? file.dataBase64 : '';
    if (!dataBase64 || dataBase64.length > Math.ceil(MAX_SHARED_FILE_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)) throw new Error('A shared file is invalid or larger than 3 MB.');
    const bytes = Buffer.from(dataBase64, 'base64');
    if (bytes.toString('base64').replace(/=+$/, '') !== dataBase64.replace(/=+$/, '')) throw new Error('A shared file is invalid.');
    total += bytes.byteLength;
    if (total > MAX_SHARED_FILE_BYTES) throw new Error('Shared files are larger than 3 MB in total.');
    return { name: String(file.name ?? 'Shared item').slice(0, 180), mimeType: String(file.mimeType ?? 'application/octet-stream').slice(0, 160), size: bytes.byteLength, dataBase64 };
  });
}
