import { TURNSTILE_SCRIPT_URL, loadTurnstile } from '../lib/turnstile';
import { createFakeTurnstile } from './helpers/turnstile';

function scripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>('script[src*="challenges.cloudflare.com"]'));
}

afterEach(() => {
  scripts().forEach((script) => {
    script.dispatchEvent(new Event('error'));
    script.remove();
  });
  delete window.turnstile;
});

describe('loadTurnstile', () => {
  test('resolves at once with an existing window.turnstile and adds no script', async () => {
    const fake = createFakeTurnstile();
    window.turnstile = fake.api;
    await expect(loadTurnstile()).resolves.toBe(fake.api);
    expect(scripts()).toHaveLength(0);
  });

  test('appends one explicit-render script and resolves when it loads', async () => {
    const promise = loadTurnstile();
    expect(scripts()).toHaveLength(1);
    const script = scripts()[0];
    expect(script.src).toBe(TURNSTILE_SCRIPT_URL);
    expect(TURNSTILE_SCRIPT_URL).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    expect(script.async).toBe(true);
    expect(script.defer).toBe(true);
    const fake = createFakeTurnstile();
    window.turnstile = fake.api;
    script.dispatchEvent(new Event('load'));
    await expect(promise).resolves.toBe(fake.api);
  });

  test('two concurrent calls share one script tag and one promise result', async () => {
    const first = loadTurnstile();
    const second = loadTurnstile();
    expect(scripts()).toHaveLength(1);
    const fake = createFakeTurnstile();
    window.turnstile = fake.api;
    scripts()[0].dispatchEvent(new Event('load'));
    await expect(Promise.all([first, second])).resolves.toEqual([fake.api, fake.api]);
  });

  test('rejects on a script error, removes the tag and lets a retry load again', async () => {
    const failed = loadTurnstile();
    scripts()[0].dispatchEvent(new Event('error'));
    await expect(failed).rejects.toBeInstanceOf(Error);
    expect(scripts()).toHaveLength(0);

    const retry = loadTurnstile();
    expect(scripts()).toHaveLength(1);
    const fake = createFakeTurnstile();
    window.turnstile = fake.api;
    scripts()[0].dispatchEvent(new Event('load'));
    await expect(retry).resolves.toBe(fake.api);
  });

  test('rejects when the script loads but defines no turnstile global', async () => {
    const promise = loadTurnstile();
    scripts()[0].dispatchEvent(new Event('load'));
    await expect(promise).rejects.toBeInstanceOf(Error);
  });
});
