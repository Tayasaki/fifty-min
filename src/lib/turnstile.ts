export interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  'error-callback'?: (errorCode?: string) => void | boolean;
  theme?: 'light' | 'dark' | 'auto';
  language?: string;
}

export interface TurnstileApi {
  render(container: HTMLElement | string, options: TurnstileRenderOptions): string;
  remove(widgetId: string): void;
  reset(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let pending: Promise<TurnstileApi> | null = null;

/** An existing `window.turnstile` short-circuits the load; a failed load clears the cache so a retry loads again. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (pending) return pending;

  pending = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;

    const fail = (message: string) => {
      pending = null;
      script.remove();
      reject(new Error(message));
    };

    script.addEventListener('load', () => {
      const api = window.turnstile;
      if (!api) {
        fail('Turnstile did not initialise');
        return;
      }
      pending = null;
      resolve(api);
    });
    script.addEventListener('error', () => fail('Turnstile failed to load'));
    document.head.appendChild(script);
  });
  return pending;
}
