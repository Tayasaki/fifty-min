---
type: runbook
status: current
review_trigger: "on file change"
created: 2026-10-27
last_updated: 2026-10-27
related: [documentation/milestones/_active/billetterie-claim-on-confirm/milestone-1.md, documentation/milestones/_active/billetterie-claim-on-confirm/milestone-2.md]
---

# API tests

Tests for the serverless API in `api/` (reservation handlers, Redis scripts, send quota, pure modules). They use `node:test`, need no new dependency and live in `api/__tests__/`.

## Run them

1. Start the throwaway Redis (once per session):

   ```bash
   pnpm run test:api:redis
   ```

2. Run the suite:

   ```bash
   pnpm run test:api
   ```

3. Typecheck the API only:

   ```bash
   pnpm run typecheck:api
   ```

4. Stop the container when done:

   ```bash
   docker stop fifty-min-test-redis
   ```

## What the runner does

`scripts/test-api.mjs`:

1. Compiles `api/` with `tsc` into a temp directory under `os.tmpdir()`.
2. Probes `REDIS_TEST_URL` (default `redis://127.0.0.1:6390`) with a 1 s timeout.
3. Runs every `*.test.js` file with `node --test --test-concurrency=1` (files run one after the other because they share Redis DB 15).
4. Removes the temp directory, whatever the outcome.

If Redis is unreachable the runner prints `Redis integration tests SKIPPED` with the start command, and the Redis-backed suites are skipped. Set `REDIS_TEST_REQUIRED=1` to make an unreachable Redis exit 1 instead (use it in CI).

| Variable | Default | Purpose |
|----------|---------|---------|
| `REDIS_TEST_URL` | `redis://127.0.0.1:6390` | Redis used by the tests |
| `REDIS_TEST_REQUIRED` | unset | `1` fails instead of skipping |

## Safety rails

The tests never call Upstash. `api/__tests__/helpers/redis-rest-shim.ts` replaces `fetch` and translates the Upstash REST calls from `api/_lib/redis.ts` into RESP on a local socket.

- Port 6379 is refused: another project's Redis listens there on the dev machine.
- Only `127.0.0.1` and `localhost` are accepted.
- Only database 15 is used. If DB 15 holds keys but not the marker key `__fifty_min_test_db__`, the shim aborts instead of flushing.
- `FLUSHALL`, `SELECT`, `CONFIG` and similar commands are blocked.
- `EVAL` and `EVALSHA` are rejected when the script body names `FLUSHALL`, `CONFIG`, `SELECT` and the other blocked commands (the first-token check alone would miss them).
- Any request to another host throws: no real network in tests.
- The rail tests in `redis-rest-shim.test.ts` run without Redis, so they still run when the suites are skipped.

## Test files

| File | Covers | Needs Redis |
|------|--------|-------------|
| `redis-scripts.test.ts` | `claimAtomic` (limits, idempotence, races, `closed`), `getReservation` | yes |
| `redis-lifecycle.test.ts` | `releaseAtomic`, tombstone, replay blocking, expiry, random-operation invariant | yes |
| `quota.test.ts` | `checkSendQuota` cooldown, daily budget, UTC day roll-over, fail closed | yes |
| `redis-rest-shim.test.ts` | Shim rails and marker check | partly |
| `limits.test.ts`, `guard.test.ts`, `http.test.ts`, `link.test.ts` | Pure modules and config limits | no |
| `handlers-smoke.test.ts` | Handler paths that return before Redis | no |

## Time-bomb rule

Redis uses the real clock and `EXPIREAT` with a past time deletes the key at once. Real shows are in 2027, so:

- Redis tests use a synthetic `expireAt` (`4102444800`, 2100-01-01 UTC) and injected clocks in 2030 (`deps.now`).
- Assert a TTL with `EXPIRETIME` (an absolute value), not `TTL`, except for the 600 s cooldown.
- Only pure helper tests may use real show dates.

## Count the HTTP requests

`helpers/fetch-count.ts` wraps `globalThis.fetch`. `fetchCallsOf(fn)` returns the number of requests `fn` issued. It proves each atomic operation costs one round trip and that validation failures cost none.

## Add a Redis test

1. Create `api/__tests__/<name>.test.ts`.
2. Import `./helpers/redis-env` first, before anything that imports `api/_lib/redis.ts` (it reads its environment at load time).
3. Wrap the suite with `describe('...', { skip: redisSkipReason }, ...)` and call `redis('FLUSHDB')` in `beforeEach`.

Tests that return before any Redis call (see `handlers-smoke.test.ts`) call `installNoNetwork()` from the shim helper instead.

## Known limits

- `pnpm test` runs the Create React App suite for `src/`. It is separate from `test:api` and currently fails on `main` (`Cannot find module react-router-dom`).
- No CI workflow exists yet.
