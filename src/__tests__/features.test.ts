import { getTurnstileSiteKey } from '../config/features';

const FLAG = 'REACT_APP_SHOW_TICKETING';
const KEY = 'REACT_APP_TURNSTILE_SITE_KEY';
const saved = { flag: process.env[FLAG], key: process.env[KEY] };

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore(FLAG, saved.flag);
  restore(KEY, saved.key);
});

describe('getTurnstileSiteKey', () => {
  test('returns the configured key', () => {
    process.env[KEY] = '1x00000000000000000000AA';
    expect(getTurnstileSiteKey()).toBe('1x00000000000000000000AA');
  });

  test('trims surrounding whitespace', () => {
    process.env[KEY] = '  1x00000000000000000000AA\n';
    expect(getTurnstileSiteKey()).toBe('1x00000000000000000000AA');
  });

  test('returns an empty string for a blank value', () => {
    process.env[KEY] = '   ';
    expect(getTurnstileSiteKey()).toBe('');
  });

  test('returns an empty string when unset', () => {
    delete process.env[KEY];
    expect(getTurnstileSiteKey()).toBe('');
  });
});
