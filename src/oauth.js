import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const algorithm = 'aes-256-gcm';
function keyFromSecret(secret) { return crypto.createHash('sha256').update(secret).digest(); }

export function encryptSecret(value, secret) {
  if (!secret) throw new Error('ANAKBUAH_TOKEN_KEY is required');
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv(algorithm, keyFromSecret(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptSecret(value, secret) {
  if (!secret) throw new Error('ANAKBUAH_TOKEN_KEY is required');
  const [ivText, tagText, dataText] = value.split('.');
  const decipher = crypto.createDecipheriv(algorithm, keyFromSecret(secret), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
}

export class TokenStore {
  constructor(filePath, secret) { this.filePath = filePath; this.secret = secret; this.tokens = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {}; }
  set(userId, token) { this.tokens[userId] = encryptSecret(JSON.stringify(token), this.secret); this.#save(); }
  get(userId) { const value = this.tokens[userId]; return value ? JSON.parse(decryptSecret(value, this.secret)) : null; }
  delete(userId) { const existed = Boolean(this.tokens[userId]); delete this.tokens[userId]; if (existed) this.#save(); return existed; }
  #save() { fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); const tmp = `${this.filePath}.tmp`; fs.writeFileSync(tmp, JSON.stringify(this.tokens)); fs.renameSync(tmp, this.filePath); }
}

export function createOAuthSession({ state, codeVerifier, userId, createdAt = Date.now() }) { return { state, codeVerifier, userId, createdAt }; }
export function validOAuthSession(session, state, maxAgeMs = 10 * 60 * 1000) { return session && session.state === state && Date.now() - session.createdAt <= maxAgeMs; }
