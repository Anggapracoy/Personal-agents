import fs from 'node:fs';
import path from 'node:path';

export class IdempotencyStore {
  constructor(filePath = null, maxEntries = 10000) { this.filePath = filePath; this.maxEntries = maxEntries; this.ids = filePath && fs.existsSync(filePath) ? new Set(JSON.parse(fs.readFileSync(filePath, 'utf8'))) : new Set(); }
  has(id) { return this.ids.has(id); }
  add(id) { this.ids.add(id); while (this.ids.size > this.maxEntries) this.ids.delete(this.ids.values().next().value); this.#save(); }
  #save() { if (!this.filePath) return; fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); const tmp = `${this.filePath}.tmp`; fs.writeFileSync(tmp, JSON.stringify([...this.ids])); fs.renameSync(tmp, this.filePath); }
}
