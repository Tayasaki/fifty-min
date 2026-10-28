import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigins, resolveBaseUrl } from '../_lib/site';

describe('resolveBaseUrl', () => {
  it('uses the production site in production', () => {
    assert.equal(resolveBaseUrl({ VERCEL_ENV: 'production' }), 'https://melangedegenres.ch');
  });

  it('prefers a valid PUBLIC_SITE_URL in every environment', () => {
    assert.equal(resolveBaseUrl({ VERCEL_ENV: 'production', PUBLIC_SITE_URL: 'https://example.org' }), 'https://example.org');
    assert.equal(resolveBaseUrl({ VERCEL_ENV: 'preview', PUBLIC_SITE_URL: 'https://example.org' }), 'https://example.org');
  });

  it('strips a trailing slash and any path from PUBLIC_SITE_URL', () => {
    assert.equal(resolveBaseUrl({ PUBLIC_SITE_URL: 'https://example.org/' }), 'https://example.org');
    assert.equal(resolveBaseUrl({ PUBLIC_SITE_URL: 'https://example.org/billetterie/' }), 'https://example.org');
  });

  it('ignores a PUBLIC_SITE_URL that is not an http(s) URL', () => {
    for (const bad of ['', 'not a url', 'javascript:alert(1)', 'ftp://example.org', '//example.org']) {
      assert.equal(resolveBaseUrl({ VERCEL_ENV: 'production', PUBLIC_SITE_URL: bad }), 'https://melangedegenres.ch', bad);
    }
  });

  it('points a preview at its own deployment, never at production', () => {
    assert.equal(resolveBaseUrl({ VERCEL_ENV: 'preview', VERCEL_URL: 'preview-abc.vercel.app' }), 'https://preview-abc.vercel.app');
  });

  it('falls back to localhost when nothing identifies the deployment', () => {
    assert.equal(resolveBaseUrl({}), 'http://localhost:3000');
    assert.equal(resolveBaseUrl({ VERCEL_ENV: 'development' }), 'http://localhost:3000');
  });

  it('never returns the production site when VERCEL_ENV is unset', () => {
    assert.notEqual(resolveBaseUrl({ VERCEL_URL: 'x.vercel.app' }), 'https://melangedegenres.ch');
  });
});

describe('allowedOrigins', () => {
  it('allows the production origin and PUBLIC_SITE_URL in production', () => {
    assert.deepEqual(allowedOrigins({ VERCEL_ENV: 'production' }), ['https://melangedegenres.ch']);
    assert.deepEqual(
      allowedOrigins({ VERCEL_ENV: 'production', PUBLIC_SITE_URL: 'https://www.melangedegenres.ch', VERCEL_PROJECT_PRODUCTION_URL: 'melangedegenres.vercel.app' }),
      ['https://melangedegenres.ch', 'https://www.melangedegenres.ch', 'https://melangedegenres.vercel.app']
    );
  });

  it('does not allow localhost or preview hosts in production', () => {
    const origins = allowedOrigins({ VERCEL_ENV: 'production', VERCEL_URL: 'preview-abc.vercel.app', VERCEL_BRANCH_URL: 'b.vercel.app' });
    assert.ok(!origins.includes('http://localhost:3000'));
    assert.ok(!origins.includes('https://preview-abc.vercel.app'));
  });

  it('allows both hostnames of a preview and localhost, but not the production site', () => {
    const origins = allowedOrigins({ VERCEL_ENV: 'preview', VERCEL_URL: 'preview-abc.vercel.app', VERCEL_BRANCH_URL: 'feature-x.vercel.app' });
    assert.deepEqual(origins.sort(), ['http://localhost:3000', 'https://feature-x.vercel.app', 'https://preview-abc.vercel.app']);
  });

  it('allows only localhost when run locally', () => {
    assert.deepEqual(allowedOrigins({}), ['http://localhost:3000']);
  });

  it('rejects an apex that is not listed and an unknown origin', () => {
    const origins = allowedOrigins({ VERCEL_ENV: 'production' });
    assert.ok(!origins.includes('https://evil.example'));
    assert.ok(!origins.includes('https://melangedegenres.ch.evil.example'));
    assert.ok(!origins.includes('http://melangedegenres.ch'));
  });

  it('drops values that are not valid hosts and never lists duplicates', () => {
    const origins = allowedOrigins({ VERCEL_ENV: 'preview', VERCEL_URL: 'a b', VERCEL_BRANCH_URL: '', PUBLIC_SITE_URL: 'http://localhost:3000' });
    assert.deepEqual(origins, ['http://localhost:3000']);
  });
});
