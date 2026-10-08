/** Runtime validation; a production build does not require deployment secrets. */
export function assertProductionAuthSecret(secret: string | undefined, environment = process.env.NODE_ENV) {
  if (environment !== 'production') return;
  const value = secret?.trim() ?? '';
  const placeholder = /^(replace-with-a-random-secret|your-generated-secret|change[-_ ]?me|your[-_ ]auth[-_ ]secret|placeholder|example)$/i.test(value);
  if (value.length < 32 || placeholder || /^(.)\1+$/.test(value)) {
    throw new Error('Configure AUTH_SECRET with a unique randomly generated secret of at least 32 characters before running production.');
  }
}
