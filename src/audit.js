import fs from 'node:fs';
import path from 'node:path';

export class AuditLog {
  constructor(filePath = null) { this.filePath = filePath; }
  record({ action, userId, resourceId = null, outcome = 'success', metadata = {} }) {
    if (!this.filePath) return;
    const safeMetadata = Object.fromEntries(Object.entries(metadata).filter(([key]) => !/(token|secret|password|otp|code)/i.test(key)));
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify({ at: new Date().toISOString(), action, userId, resourceId, outcome, metadata: safeMetadata })}\n`);
  }
}
