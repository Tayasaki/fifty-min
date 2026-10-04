// Suggests a correction when an email domain looks like a typo of a common provider
// (e.g. "gmial.com" → "gmail.com", "hotmail.con" → "hotmail.com").

const COMMON_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.fr',
  'hotmail.ch',
  'outlook.com',
  'outlook.fr',
  'live.com',
  'live.fr',
  'msn.com',
  'yahoo.com',
  'yahoo.fr',
  'icloud.com',
  'me.com',
  'protonmail.com',
  'proton.me',
  'bluewin.ch',
  'sunrise.ch',
  'gmx.ch',
  'gmx.net',
  'hispeed.ch',
  'netplus.ch',
  'orange.fr',
  'free.fr',
  'sfr.fr',
  'wanadoo.fr',
  'laposte.net',
];

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Returns the corrected email, or null if the domain looks fine. */
export function suggestEmail(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (domain.length < 4 || COMMON_DOMAINS.includes(domain)) return null;

  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of COMMON_DOMAINS) {
    const d = distance(domain, candidate);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best && bestDistance <= 2 ? `${local}@${best}` : null;
}
