import { redisSkipReason } from './helpers/redis-env';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { redis } from '../_lib/redis';
import { assertSafeRedisUrl } from './helpers/redis-rest-shim';

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
});
