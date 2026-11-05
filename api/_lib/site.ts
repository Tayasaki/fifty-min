import { SITE_URL } from '../../src/config/seo';

type Env = Record<string, string | undefined>;

const LOCAL_ORIGIN = 'http://localhost:3000';

/** Origin of an http(s) URL (path, query and trailing slash dropped), or null when it is not one. */
function parseOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

const hostOrigin = (host: string | undefined): string | null => (host ? parseOrigin(`https://${host.trim()}`) : null);

/** Base URL used in emailed links: never the production site unless the deployment is production. */
export function resolveBaseUrl(env: Env): string {
  const explicit = parseOrigin(env.PUBLIC_SITE_URL);
  if (explicit) return explicit;
  if (env.VERCEL_ENV === 'production') return parseOrigin(SITE_URL) ?? SITE_URL;
  return hostOrigin(env.VERCEL_URL) ?? LOCAL_ORIGIN;
}

/** Origins allowed to call the state-changing endpoints. */
export function allowedOrigins(env: Env): string[] {
  const candidates =
    env.VERCEL_ENV === 'production'
      ? [parseOrigin(SITE_URL), parseOrigin(env.PUBLIC_SITE_URL), hostOrigin(env.VERCEL_PROJECT_PRODUCTION_URL)]
      : [resolveBaseUrl(env), hostOrigin(env.VERCEL_URL), hostOrigin(env.VERCEL_BRANCH_URL), LOCAL_ORIGIN];
  return [...new Set(candidates.filter((origin): origin is string => origin !== null))];
}
