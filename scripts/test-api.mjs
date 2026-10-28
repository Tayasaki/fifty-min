// Compiles api/ to a temp dir and runs the node:test suites under api/__tests__.
// Redis-backed tests need a local redis on REDIS_TEST_URL (default 127.0.0.1:6390).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function probe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function listTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'helpers') out.push(...listTests(full));
    } else if (entry.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out.sort();
}

async function main() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fifty-min-api-'));
  try {
    const tsc = require.resolve('typescript/bin/tsc', { paths: [root] });
    const compile = spawnSync(process.execPath, [tsc, '-p', 'api/tsconfig.json', '--noEmit', 'false', '--outDir', tmp], {
      cwd: root,
      encoding: 'utf8',
    });
    if (compile.status !== 0) {
      process.stderr.write(compile.stdout + compile.stderr);
      return 1;
    }

    const env = { ...process.env };
    const redisUrl = env.REDIS_TEST_URL || 'redis://127.0.0.1:6390';
    env.REDIS_TEST_URL = redisUrl;
    let parsed;
    try {
      parsed = new URL(redisUrl);
    } catch {
      process.stderr.write(`Invalid REDIS_TEST_URL: ${redisUrl}\n`);
      return 1;
    }
    const reachable = await probe(parsed.hostname, Number(parsed.port || 6379), 1000);
    if (!reachable) {
      const reason = `cannot reach ${parsed.hostname}:${parsed.port || 6379}`;
      console.log(`Redis integration tests SKIPPED: ${reason} (start it with: pnpm run test:api:redis)`);
      if (env.REDIS_TEST_REQUIRED === '1') {
        process.stderr.write('REDIS_TEST_REQUIRED=1: refusing to skip Redis tests\n');
        return 1;
      }
      env.REDIS_TEST_SKIP_REASON = reason;
    }

    const files = listTests(path.join(tmp, 'api', '__tests__'));
    if (files.length === 0) {
      process.stderr.write('No test files found\n');
      return 1;
    }
    const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { cwd: root, env, stdio: 'inherit' });
    return run.status ?? 1;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  }
);
