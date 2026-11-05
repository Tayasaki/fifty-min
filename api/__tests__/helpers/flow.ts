// Shared fixtures for the flow tests: synthetic far-future show, injected deps, outbox, log capture, key snapshot.
import { format } from 'node:util';
import { SHOWS, type Show } from '../../../src/config/shows';
import { loadLinkSecrets, signLink } from '../../_lib/link';
import { redis } from '../../_lib/redis';
import type { Deps, Env } from '../../_lib/deps';
import type { TurnstileResult } from '../../_lib/turnstile';
import { SHIM_HOST } from './redis-rest-shim';

/** Redis EXPIREAT runs on the real clock, so every test show and clock lives in 2099-2100 (never expires, never past). */
export const SYNTH_SHOW_ID = '2100-06-15-monique';
export const SYNTH_START = new Date('2100-06-15T19:00:00+01:00').getTime();
export const NOW = Date.UTC(2099, 5, 1, 12, 0, 0);
export const ORIGIN = 'https://melangedegenres.ch';
export const LINK_SECRET = 'a-test-only-link-secret-of-at-least-32-chars';

export function registerTestShow(overrides: Partial<Show> = {}): { show: Show; unregister: () => void } {
  const show: Show = {
    id: SYNTH_SHOW_ID,
    venueId: 'monique',
    date: '2100-06-15T19:00',
    doorsOpen: '18h30',
    label: 'Mardi 15 juin 2100 — 19h',
    capacity: 100,
    ...overrides,
  };
  SHOWS.push(show);
  return {
    show,
    unregister: () => {
      const index = SHOWS.indexOf(show);
      if (index >= 0) SHOWS.splice(index, 1);
    },
  };
}

export function makeEnv(overrides: Env = {}): Env {
  return {
    VERCEL_ENV: 'production',
    RESERVATIONS_OPEN: 'true',
    LINK_SECRET,
    RESEND_API_KEY: 're_test_key',
    TURNSTILE_SECRET_KEY: 'ts_test_secret',
    ...overrides,
  };
}

export interface SentMail {
  to: string[];
  subject: string;
  text: string;
  html: string;
  authorization: string;
  attachments?: { filename: string }[];
}

export type ResendBehavior = 'ok' | 'hang' | { status: number; body: string };

export interface Harness {
  deps: Deps;
  outbox: SentMail[];
  resend: { behavior: ResendBehavior; calls: number };
  turnstile: { calls: number; spent: Set<string> };
  clock: { now: number };
}

/** Tokens: "ok-*" pass once, "bad" is rejected, "down" is an outage. Already used tokens are rejected. */
export function makeDeps(opts: { now?: number; env?: Env; emailTimeoutMs?: number } = {}): Harness {
  const harness: Harness = {
    outbox: [],
    resend: { behavior: 'ok', calls: 0 },
    turnstile: { calls: 0, spent: new Set() },
    clock: { now: opts.now ?? NOW },
    deps: undefined as unknown as Deps,
  };
  const fetchStub: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== 'https://api.resend.com/emails') throw new Error(`Unexpected host in test: ${url}`);
    harness.resend.calls += 1;
    const body = JSON.parse(String(init?.body)) as Omit<SentMail, 'authorization'>;
    harness.outbox.push({ ...body, authorization: new Headers(init?.headers).get('authorization') ?? '' });
    const behavior = harness.resend.behavior;
    if (behavior === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }
    if (behavior === 'ok') return Response.json({ id: 'msg_1' });
    return new Response(behavior.body, { status: behavior.status, headers: { 'content-type': 'application/json' } });
  };
  harness.deps = {
    now: () => harness.clock.now,
    env: opts.env ?? makeEnv(),
    fetch: fetchStub,
    emailTimeoutMs: opts.emailTimeoutMs,
    verifyTurnstile: async (token): Promise<TurnstileResult> => {
      harness.turnstile.calls += 1;
      if (!token) return { ok: false, reason: 'missing-token' };
      if (token === 'down') return { ok: false, reason: 'unavailable' };
      if (!token.startsWith('ok') || harness.turnstile.spent.has(token)) return { ok: false, reason: 'rejected' };
      harness.turnstile.spent.add(token);
      return { ok: true };
    },
  };
  return harness;
}

let tokenCounter = 0;
export const freshToken = (): string => `ok-${(tokenCounter += 1)}`;

export function reserveRequest(body: unknown, headers: Record<string, string> = {}, raw = false): Request {
  return new Request('http://localhost/api/reserve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

export function validReserve(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    showId: SYNTH_SHOW_ID,
    name: 'Jean Dupont',
    email: 'jean@example.ch',
    quantity: 2,
    turnstileToken: freshToken(),
    ...overrides,
  };
}

export function postJson(path: string, body: unknown, headers: Record<string, string> = {}, raw = false): Request {
  return new Request(`http://localhost/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

export function getRequest(path: string, query: Record<string, string> = {}, headers: Record<string, string> = {}): Request {
  const url = new URL(`http://localhost/api/${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return new Request(url, { headers });
}

/** Signs a confirmation link the way /api/reserve does. */
export function makeLink(
  fields: { email?: string; name?: string; quantity?: number; showId?: string } = {},
  opts: { now?: number; secret?: string; ttlSeconds?: number; kidSecrets?: Env } = {}
): { token: string; id: string; exp: number } {
  const env = opts.kidSecrets ?? { LINK_SECRET: opts.secret ?? LINK_SECRET };
  return signLink(
    {
      showId: fields.showId ?? SYNTH_SHOW_ID,
      name: fields.name ?? 'Jean Dupont',
      email: fields.email ?? 'jean@example.ch',
      quantity: fields.quantity ?? 2,
    },
    { secrets: loadLinkSecrets(env), now: () => opts.now ?? NOW, ttlSeconds: opts.ttlSeconds }
  );
}

/** Captures console output; every line is formatted like the real console would. */
export function captureLogs(): { lines: () => string; restore: () => void } {
  const captured: string[] = [];
  const names = ['error', 'warn', 'log', 'info'] as const;
  const originals = names.map((name) => console[name]);
  for (const name of names) console[name] = (...args: unknown[]) => void captured.push(format(...args));
  return {
    lines: () => captured.join('\n'),
    restore: () => names.forEach((name, i) => (console[name] = originals[i])),
  };
}

/** Every key with its type and value, sorted: a refusal must leave this unchanged. */
export async function snapshot(): Promise<string> {
  const found = (await redis<string[]>('KEYS', '*')).filter((key) => !key.startsWith('__')).sort();
  const entries: [string, unknown][] = [];
  for (const key of found) {
    const type = await redis<string>('TYPE', key);
    const value =
      type === 'string' ? await redis('GET', key) :
      type === 'hash' ? await redis('HGETALL', key) :
      type === 'list' ? await redis('LRANGE', key, 0, -1) : null;
    entries.push([key, { type, value }]);
  }
  return JSON.stringify(entries);
}

export const keyList = async (): Promise<string[]> =>
  (await redis<string[]>('KEYS', '*')).filter((key) => !key.startsWith('__')).sort();

/** Makes every Redis call answer HTTP 500. Returns the restore function and a call counter. */
export function redisDown(): { calls: () => number; restore: () => void } {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname !== SHIM_HOST) return original(input, init);
    count += 1;
    return Response.json({ error: 'upstream failure' }, { status: 500 });
  };
  return { calls: () => count, restore: () => void (globalThis.fetch = original) };
}

/** Every Redis command (name and arguments) issued while fn runs, in order. */
export async function redisCommandsOf(fn: () => Promise<unknown>): Promise<string[][]> {
  const real = globalThis.fetch;
  const commands: string[][] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname === SHIM_HOST) commands.push(JSON.parse(String(init?.body)) as string[]);
    return real(input, init);
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
  return commands;
}

export function containsNone(haystack: string, needles: string[]): boolean {
  return needles.every((needle) => !haystack.includes(needle));
}
