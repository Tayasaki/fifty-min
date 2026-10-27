import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// test:api runs from the repository root, where vercel.json lives.
interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}
const config = JSON.parse(readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')) as {
  installCommand?: string;
  headers?: HeaderRule[];
};

const all = (config.headers ?? []).find((rule) => rule.source === '/(.*)');
const header = (key: string): string | undefined => all?.headers.find((h) => h.key === key)?.value;
const csp = header('Content-Security-Policy-Report-Only') ?? header('Content-Security-Policy') ?? '';
const directive = (name: string): string => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';
const TURNSTILE = 'https://challenges.cloudflare.com';

describe('vercel.json', () => {
  it('installs from the committed lockfile', () => {
    assert.match(config.installCommand ?? '', /--frozen-lockfile/);
    assert.doesNotMatch(config.installCommand ?? '', /--no-frozen-lockfile/);
  });

  it('sends the security headers on every path', () => {
    assert.ok(all, 'a rule with source /(.*) must exist');
    assert.equal(header('Referrer-Policy'), 'no-referrer', 'confirm and cancel links carry a signed token');
    assert.equal(header('X-Content-Type-Options'), 'nosniff');
    assert.equal(header('X-Frame-Options'), 'DENY');
    assert.ok(csp.length > 0, 'a Content-Security-Policy (report-only until the launch checklist flips it) must exist');
  });

  it('lets the Turnstile script load', () => {
    assert.ok(directive('script-src').includes(TURNSTILE), 'removing this blocks the booking captcha');
  });

  it('lets the Turnstile challenge iframe load', () => {
    assert.ok(directive('frame-src').includes(TURNSTILE), 'removing this blocks the booking captcha');
  });

  it('keeps Google Fonts reachable', () => {
    assert.ok(directive('font-src').includes('https://fonts.gstatic.com'), 'removing this drops the site fonts');
    assert.ok(directive('style-src').includes('https://fonts.googleapis.com'), 'removing this drops the site fonts');
  });

  it('forbids plugins and eval, and inline scripts', () => {
    assert.ok(directive('object-src').includes("'none'"));
    assert.doesNotMatch(csp, /'unsafe-eval'/);
    assert.doesNotMatch(directive('script-src'), /'unsafe-inline'/);
  });

  it('is valid JSON with only headers rules that carry a source', () => {
    for (const rule of config.headers ?? []) {
      assert.equal(typeof rule.source, 'string');
      assert.ok(rule.headers.length > 0);
    }
  });
});
