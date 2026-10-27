import { redisSkipReason } from './helpers/redis-env';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { redis } from '../_lib/redis';
import { MARKER_KEY, assertSafeRedisUrl, checkDatabase, installRedisShim } from './helpers/redis-rest-shim';

describe('assertSafeRedisUrl', () => {
  it('rejects the shared default port 6379', () => {
    assert.throws(() => assertSafeRedisUrl('redis://127.0.0.1:6379'), /6379/);
    assert.throws(() => assertSafeRedisUrl('redis://127.0.0.1'), /6379/);
  });

  it('rejects non-loopback hosts', () => {
    assert.throws(() => assertSafeRedisUrl('redis://10.0.0.5:6390'), /Refusing/);
    assert.throws(() => assertSafeRedisUrl('redis://redis.example.com:6390'), /Refusing/);
  });

  it('accepts the throwaway container address', () => {
    assert.deepEqual(assertSafeRedisUrl('redis://127.0.0.1:6390'), { host: '127.0.0.1', port: 6390 });
  });
});

const TARGET = { host: '127.0.0.1', port: 6390 };

describe('redis REST shim rails (no Redis needed)', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    installRedisShim('redis://127.0.0.1:6390');
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  for (const name of ['FLUSHALL', 'SELECT', 'CONFIG', 'SHUTDOWN', 'SLAVEOF', 'REPLICAOF', 'MIGRATE', 'flushall']) {
    it(`rejects ${name} before any connection`, async () => {
      await assert.rejects(redis(name, 'x'), /not allowed in the test shim/);
    });
  }

  it('rejects an EVAL whose body calls FLUSHALL', async () => {
    await assert.rejects(redis('EVAL', "return redis.call('FLUSHALL')", 0), /not allowed in the test shim/);
  });

  it('rejects an EVALSHA naming a forbidden command', async () => {
    await assert.rejects(redis('EVALSHA', "redis.call('config','get','*')", 0), /not allowed in the test shim/);
  });

  it('refuses any host other than the shim host', async () => {
    await assert.rejects(fetch('https://api.resend.com/emails'), /Network access is disabled in tests/);
  });
});

describe('redis REST shim', { skip: redisSkipReason }, () => {
  beforeEach(async () => {
    await redis('FLUSHDB');
  });

  it('round-trips SET and GET strings', async () => {
    assert.equal(await redis('SET', 'k', 'valeur é'), 'OK');
    assert.equal(await redis('GET', 'k'), 'valeur é');
  });

  it('returns integers as numbers', async () => {
    assert.equal(await redis('INCR', 'counter'), 1);
    assert.equal(await redis('INCR', 'counter'), 2);
  });

  it('returns null for a missing key', async () => {
    assert.equal(await redis('GET', 'missing'), null);
  });

  it('returns arrays', async () => {
    await redis('RPUSH', 'l', 'a', 'b', 'c');
    assert.deepEqual(await redis('LRANGE', 'l', 0, -1), ['a', 'b', 'c']);
  });

  it('maps an EVAL table reply to an array of numbers', async () => {
    assert.deepEqual(await redis('EVAL', 'return {1, 7}', 0), [1, 7]);
  });

  it('throws an Error for a redis error reply', async () => {
    await assert.rejects(redis('EVAL', 'this is not lua', 0), Error);
  });

  it('isolates tests with FLUSHDB', async () => {
    await redis('SET', 'a', '1');
    await redis('FLUSHDB');
    assert.equal(await redis('GET', 'a'), null);
  });

  it('runs commands in DB 15 only', async () => {
    await redis('SET', 'where', 'here');
    assert.equal(await redis('GET', '__fifty_min_test_db__'), '1');
  });

  it('runs a benign EVAL', async () => {
    assert.equal(await redis('EVAL', 'return 1', 0), 1);
  });

  it('refuses a database that holds foreign keys without the marker', async () => {
    try {
      await redis('FLUSHDB');
      await redis('DEL', MARKER_KEY);
      await redis('SET', 'foreign', '1');
      await assert.rejects(checkDatabase(TARGET), /Refusing to flush a non-test database/);
    } finally {
      await redis('SET', MARKER_KEY, '1');
      await redis('FLUSHDB');
    }
  });

  it('accepts an empty database', async () => {
    await redis('FLUSHDB');
    await redis('DEL', MARKER_KEY);
    await assert.doesNotReject(checkDatabase(TARGET));
  });

  it('accepts a database that holds the marker', async () => {
    await redis('FLUSHDB');
    await redis('SET', 'other', '1');
    await assert.doesNotReject(checkDatabase(TARGET));
  });
});
