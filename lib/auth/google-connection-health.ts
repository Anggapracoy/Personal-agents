/** Only a definitive authorization failure asks the user to reconnect. */
export function googleReconnectRequired(status: number, body: unknown): boolean {
  return status === 400 && typeof body === 'object' && body !== null
    && 'error' in body && body.error === 'invalid_grant';
}
