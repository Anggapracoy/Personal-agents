import { createHash } from 'node:crypto';

/** Stable per installation and environment; never expose the session secret. */
export function installationNamespace() {
  const explicit = process.env.DASH_INSTALLATION_ID?.trim();
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() || 'http://localhost:3000';
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!explicit && !secret && process.env.NODE_ENV === 'production') throw new Error('DASH_INSTALLATION_ID or AUTH_SECRET is required for browser isolation.');
  return createHash('sha256').update(JSON.stringify([explicit || secret || 'local-development', origin, process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'])).digest('hex').slice(0, 20);
}
