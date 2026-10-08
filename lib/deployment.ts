/** Public installation settings. NEXT_PUBLIC values are fixed at build time. */
export const APP_ORIGIN = new URL(process.env.NEXT_PUBLIC_APP_ORIGIN || "http://localhost:3000").origin;
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "support@example.invalid";
