import { DAILY_REQUEST_EMAIL_BUDGET, SEND_COOLDOWN_SECONDS } from '../../src/config/shows';
import { ERR } from './http';
import { redis } from './redis';

export type SendKind = 'request' | 'recap' | 'cancellation';

export interface QuotaDeps {
  now?: () => number;
  cooldownSeconds?: number;
  requestBudget?: number;
}

export type QuotaResult =
  | { ok: true; used: number }
  | { ok: false; reason: 'cooldown' | 'budget' | 'unavailable' | 'invalid'; message: string; retryAfterSeconds?: number };

export const QUOTA_MESSAGES = {
  cooldown: 'Un email vous a déjà été envoyé. Patientez quelques minutes avant de refaire une demande et vérifiez vos courriers indésirables.',
  budget: 'Le service d’envoi d’emails est saturé pour aujourd’hui. Merci de réessayer demain.',
  invalid: 'Adresse email invalide',
} as const;

const DAY_MS = 86_400_000;

// Cooldown and daily budget in one round trip, so a refused request leaves no cooldown behind.
// Only 'request' mails are refused by the budget; recap and cancellation mails are counted only.
// Replies [code, value]: 1 ok (used), -1 cooldown (seconds left), -2 budget reached (used).
const QUOTA_SCRIPT = `
if ARGV[4] == 'request' then
  local ttl = redis.call('TTL', KEYS[1])
  if ttl > 0 then return {-1, ttl} end
  local used = tonumber(redis.call('GET', KEYS[2]) or '0')
  if used >= tonumber(ARGV[2]) then return {-2, used} end
  redis.call('SET', KEYS[1], '1', 'EX', ARGV[1])
end
local used = redis.call('INCR', KEYS[2])
if used == 1 then redis.call('EXPIREAT', KEYS[2], ARGV[3]) end
return {1, used}
`;

const refuse = (reason: 'cooldown' | 'budget' | 'unavailable' | 'invalid', message: string, retryAfterSeconds?: number): QuotaResult => ({
  ok: false,
  reason,
  message,
  ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
});

export async function checkSendQuota(kind: SendKind, canonicalEmail: string, deps: QuotaDeps = {}): Promise<QuotaResult> {
  const at = canonicalEmail.lastIndexOf('@');
  if (at < 1 || at === canonicalEmail.length - 1) return refuse('invalid', QUOTA_MESSAGES.invalid);

  const now = (deps.now ?? Date.now)();
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const day = new Date(dayStart).toISOString().slice(0, 10);
  const dayExpireAt = (dayStart + DAY_MS) / 1000;

  try {
    const [code, value] = await redis<[number, number]>(
      'EVAL',
      QUOTA_SCRIPT,
      2,
      `quota:cooldown:${canonicalEmail}`,
      `quota:sent:${day}`,
      deps.cooldownSeconds ?? SEND_COOLDOWN_SECONDS,
      deps.requestBudget ?? DAILY_REQUEST_EMAIL_BUDGET,
      dayExpireAt,
      kind === 'request' ? 'request' : 'counted'
    );
    if (code === 1) return { ok: true, used: value };
    if (code === -1) return refuse('cooldown', QUOTA_MESSAGES.cooldown, value);
    return refuse('budget', QUOTA_MESSAGES.budget);
  } catch (err) {
    console.error('send quota error', err);
    return refuse('unavailable', ERR.UNAVAILABLE);
  }
}
