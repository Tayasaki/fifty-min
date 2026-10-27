/**
 * The ticketing switch is the literal `process.env.REACT_APP_SHOW_TICKETING === 'true'`, written
 * inline where it gates code: a helper function in another chunk would stop the bundler from
 * removing the disabled branch (reservation copy, API paths, Turnstile URL) from the build.
 */

export function getTurnstileSiteKey(): string {
  return (process.env.REACT_APP_TURNSTILE_SITE_KEY ?? '').trim();
}
