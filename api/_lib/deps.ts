import { createTurnstileVerifier, type TurnstileVerifier } from './turnstile';

export type Env = Record<string, string | undefined>;

/** Everything a flow handler needs from the outside world, injected so tests never touch the network. */
export interface Deps {
  now: () => number;
  env: Env;
  fetch: typeof fetch;
  verifyTurnstile: TurnstileVerifier;
  /** Resend timeout override, tests only */
  emailTimeoutMs?: number;
}

/** now and fetch are bound late so that tests replacing Date.now or globalThis.fetch keep working. */
export function defaultDeps(): Deps {
  const lateFetch: typeof fetch = (...args) => globalThis.fetch(...args);
  return {
    now: () => Date.now(),
    env: process.env,
    fetch: lateFetch,
    verifyTurnstile: createTurnstileVerifier({ env: process.env, fetch: lateFetch }),
  };
}
