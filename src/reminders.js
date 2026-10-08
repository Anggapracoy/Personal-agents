import fs from 'node:fs';
import path from 'node:path';

export function parseReminder(text, now = new Date(), timeZone = 'Asia/Jakarta') {
  const input = text.trim().toLowerCase();
  const match = input.match(/(?:ingatkan|ingetin|ingat|reminder)\s+(?:saya\s+|aku\s+)?(.+?)\s+(?:besok|hari ini|hari\s+ini)?\s*(?:jam|pukul)\s*(\d{1,2})(?::(\d{2}))?\s*(pagi|siang|sore|malam)?/i);
  if (!match) return null;
  const task = match[1].replace(/\s+(besok|hari ini)\s*$/i, '').trim();
  const dayWord = input.includes('besok') ? 'besok' : 'hari ini';
  let hour = Number(match[2]);
  const minute = Number(match[3] || 0);
  const period = match[4];
  if (period === 'malam' && hour < 12) hour += 12;
  if (period === 'siang' && hour < 11) hour += 12;
  if (period === 'sore' && hour < 11) hour += 12;
  if (hour > 23 || minute > 59) return null;
  const local = new Date(now);
  local.setDate(local.getDate() + (dayWord === 'besok' ? 1 : 0));
  local.setHours(hour, minute, 0, 0);
  return { task, dueAt: local, timeZone };
}

export class ReminderStore {
  #items = new Map();
  #nextId = 1;
  #filePath;
  constructor(filePath = null) {
    this.#filePath = filePath;
    if (!filePath || !fs.existsSync(filePath)) return;
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const item of saved.items || []) this.#items.set(item.id, { ...item, dueAt: new Date(item.dueAt), deliveredAt: item.deliveredAt ? new Date(item.deliveredAt) : null });
    this.#nextId = saved.nextId || this.#nextId;
  }
  #persist() {
    if (!this.#filePath) return;
    fs.mkdirSync(path.dirname(this.#filePath), { recursive: true });
    const temp = `${this.#filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ nextId: this.#nextId, items: [...this.#items.values()] }, null, 2));
    fs.renameSync(temp, this.#filePath);
  }
  create(userId, parsed) {
    const item = { id: `rem_${this.#nextId++}`, userId, task: parsed.task, dueAt: parsed.dueAt, timeZone: parsed.timeZone, status: 'pending', approved: false, deliveredAt: null, attempts: 0, nextAttemptAt: parsed.dueAt, lastError: null };
    this.#items.set(item.id, item);
    this.#persist();
    return item;
  }
  get(id) { return this.#items.get(id); }
  latest(userId) { return [...this.#items.values()].filter(x => x.userId === userId).at(-1) || null; }
  latestDelivered(userId) { return [...this.#items.values()].filter(x => x.userId === userId && x.status === 'delivered').at(-1) || null; }
  latestPending(userId) { return [...this.#items.values()].filter(x => x.userId === userId && x.status === 'pending' && !x.approved).at(-1) || null; }
  approve(id, userId) { const x = this.#items.get(id); if (!x || x.userId !== userId) return null; x.approved = true; this.#persist(); return x; }
  cancel(id, userId) { const x = this.#items.get(id); if (!x || x.userId !== userId || x.status === 'delivered') return null; x.status = 'cancelled'; this.#persist(); return x; }
  snooze(id, userId, minutes) { const x = this.#items.get(id); if (!x || x.userId !== userId || x.status !== 'delivered') return null; x.dueAt = new Date(x.dueAt.getTime() + minutes * 60000); x.status = 'pending'; x.deliveredAt = null; this.#persist(); return x; }
  due(now = new Date()) { return [...this.#items.values()].filter(x => x.approved && x.status === 'pending' && x.dueAt <= now && new Date(x.nextAttemptAt || x.dueAt) <= now); }
  attentionCount() { return [...this.#items.values()].filter(x => x.status === 'failed_needs_attention').length; }
  retry(id, error, now = new Date()) { const x = this.#items.get(id); if (!x) return null; x.attempts = (x.attempts || 0) + 1; x.lastError = String(error?.message || error); if (x.attempts >= 8) { x.status = 'failed_needs_attention'; x.nextAttemptAt = null; } else { const delay = Math.min(60 * 60 * 1000, 1000 * (2 ** Math.min(x.attempts - 1, 10))); x.nextAttemptAt = new Date(now.getTime() + delay); } this.#persist(); return x; }
  deliver(id, now = new Date()) { const x = this.#items.get(id); if (!x) return null; x.status = 'delivered'; x.deliveredAt = now; this.#persist(); return x; }
}

export class ReminderScheduler {
  constructor(store, deliver) { this.store = store; this.deliver = deliver; this.timer = null; }
  async tick(now = new Date()) {
    const jobs = this.store.due(now).map(async item => { try { await this.deliver(item); this.store.deliver(item.id, now); } catch (error) { this.store.retry(item.id, error, now); throw error; } });
    return Promise.allSettled(jobs);
  }
  start(intervalMs = 1000) { if (this.timer) return; this.timer = setInterval(() => this.tick().catch(() => {}), intervalMs); this.timer.unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

export function formatProposal(item) {
  return `Aku catat: “${item.task}” pada ${item.dueAt.toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short', timeZone: item.timeZone })}. Balas SETUJU untuk mengaktifkan atau BATAL untuk membatalkan. (${item.id})`;
}
