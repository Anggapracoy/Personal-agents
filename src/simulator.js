import { parseReminder, ReminderStore, formatProposal } from './reminders.js';

export class Simulator {
  constructor(now = new Date()) { this.now = now; this.store = new ReminderStore(); }
  receive(userId, text) {
    const upper = text.trim().toUpperCase();
    if (upper === 'SETUJU') {
      const item = this.store.latest(userId);
      if (!item) return 'Belum ada reminder yang menunggu persetujuan.';
      this.store.approve(item.id, userId); return `Siap, reminder “${item.task}” sudah aktif.`;
    }
    const parsed = parseReminder(text, this.now);
    if (!parsed) return 'Aku belum memahami waktunya. Contoh: “Ingatkan saya bayar listrik besok jam 9 pagi.”';
    const item = this.store.create(userId, parsed); return formatProposal(item);
  }
}
