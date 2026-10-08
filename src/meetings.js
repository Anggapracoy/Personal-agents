export function parseMeetingRequest(text, now = new Date(), timeZone = 'Asia/Jakarta') {
  const input = text.trim();
  const match = input.match(/^(?:jadwalkan|buatkan|atur)\s+(?:meeting|rapat)\s+(?:dengan\s+)?(.+?)\s+(besok|hari ini)\s+jam\s+(\d{1,2})(?::(\d{2}))?\s*(?:sampai|hingga|-|ke)\s*(\d{1,2})(?::(\d{2}))?\s*(pagi|siang|sore|malam)?$/i);
  if (!match) return null;
  const title = match[1].trim(); const dayOffset = match[2].toLowerCase() === 'besok' ? 1 : 0;
  let startHour = Number(match[3]); let endHour = Number(match[5]); const startMinute = Number(match[4] || 0); const endMinute = Number(match[6] || 0); const period = match[7]?.toLowerCase();
  if (period === 'malam' || period === 'sore' || period === 'siang') { if (startHour < 12) startHour += 12; if (endHour < 12) endHour += 12; }
  if ([startHour, endHour].some(x => x > 23) || startMinute > 59 || endMinute > 59) return null;
  const start = new Date(now); start.setDate(start.getDate() + dayOffset); start.setHours(startHour, startMinute, 0, 0);
  const end = new Date(now); end.setDate(end.getDate() + dayOffset); end.setHours(endHour, endMinute, 0, 0);
  if (!(start < end)) return null;
  return { title, start, end, timeZone };
}

export function formatMeetingProposal(meeting, conflicts = []) {
  const when = meeting.start.toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short', timeZone: meeting.timeZone });
  if (conflicts.length) return `Jadwal ${when} bentrok dengan ${conflicts.length} acara di kalender. Pilih waktu lain atau ubah permintaannya.`;
  return `Aku bisa menjadwalkan “${meeting.title}” pada ${when}. Balas SETUJU setelah detailnya benar.`;
}
import fs from 'node:fs';
import path from 'node:path';


export class MeetingProposalStore {
  constructor(filePath = null) { this.filePath = filePath; this.items = filePath && fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {}; }
  get(id) { return this.items[id] || null; }
  set(id, value) { this.items[id] = value; this.#save(); }
  delete(id) { const existed = Boolean(this.items[id]); delete this.items[id]; if (existed) this.#save(); return existed; }
  prune(maxAgeMs = 10 * 60 * 1000, now = Date.now()) { let removed = 0; for (const [id, item] of Object.entries(this.items)) { if (!item.createdAt || now - item.createdAt > maxAgeMs) { delete this.items[id]; removed++; } } if (removed) this.#save(); return removed; }
  #save() { if (!this.filePath) return; fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); const tmp = `${this.filePath}.tmp`; fs.writeFileSync(tmp, JSON.stringify(this.items, null, 2)); fs.renameSync(tmp, this.filePath); }
}
