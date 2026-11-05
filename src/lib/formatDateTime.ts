/** Formats an instant for display in Geneva time, whatever the runtime time zone. */
export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('fr-CH', {
    timeZone: 'Europe/Zurich',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}
