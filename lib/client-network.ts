import { isIP } from 'node:net';

/** Only trust a header that the deployment's ingress overwrites. */
export function quotaClientAddress(request: Request) {
  const header = process.env.VERCEL === '1' ? 'x-vercel-forwarded-for' : process.env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!header || !/^[a-z0-9-]+$/.test(header)) return 'shared-ingress';
  const address = request.headers.get(header)?.split(',')[0].trim();
  return address && isIP(address) ? address : 'shared-ingress';
}
