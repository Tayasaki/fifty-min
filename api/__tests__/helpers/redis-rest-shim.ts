// Test-side stand-in for the Upstash REST API: translates the JSON command array
// that api/_lib/redis.ts posts into RESP over a plain TCP socket to a local redis.
import net from 'node:net';

export const SHIM_HOST = 'upstash-shim.test';
export const SHIM_URL = `http://${SHIM_HOST}`;
export const SHIM_TOKEN = 'test-token';
export const TEST_DB = 15;
export const MARKER_KEY = '__fifty_min_test_db__';

type Reply = string | number | null | Reply[] | Error;

export interface RedisTarget {
  host: string;
  port: number;
}

/** Throws unless the URL points at a loopback redis that is not the default port 6379. */
export function assertSafeRedisUrl(raw: string): RedisTarget {
  const url = new URL(raw);
  const host = url.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Refusing REDIS_TEST_URL host "${host}": only 127.0.0.1 or localhost are allowed`);
  }
  const port = url.port ? Number(url.port) : 6379;
  if (port === 6379) {
    throw new Error('Refusing REDIS_TEST_URL port 6379: it is reserved for other projects, use the throwaway container on 6390');
  }
  return { host, port };
}

function encodeCommand(command: string[]): Buffer {
  const parts = [`*${command.length}\r\n`];
  for (const arg of command) parts.push(`$${Buffer.byteLength(arg)}\r\n${arg}\r\n`);
  return Buffer.from(parts.join(''));
}

function parseReply(buf: Buffer, offset: number): { value: Reply; next: number } | null {
  if (offset >= buf.length) return null;
  const lineEnd = buf.indexOf('\r\n', offset);
  if (lineEnd === -1) return null;
  const type = String.fromCharCode(buf[offset]);
  const line = buf.toString('utf8', offset + 1, lineEnd);
  const afterLine = lineEnd + 2;
  switch (type) {
    case '+':
      return { value: line, next: afterLine };
    case '-':
      return { value: new Error(line), next: afterLine };
    case ':':
      return { value: Number(line), next: afterLine };
    case '$': {
      const len = Number(line);
      if (len === -1) return { value: null, next: afterLine };
      if (buf.length < afterLine + len + 2) return null;
      return { value: buf.toString('utf8', afterLine, afterLine + len), next: afterLine + len + 2 };
    }
    case '*': {
      const count = Number(line);
      if (count === -1) return { value: null, next: afterLine };
      const items: Reply[] = [];
      let cursor = afterLine;
      for (let i = 0; i < count; i++) {
        const item = parseReply(buf, cursor);
        if (!item) return null;
        items.push(item.value);
        cursor = item.next;
      }
      return { value: items, next: cursor };
    }
    default:
      throw new Error(`Unexpected RESP type "${type}"`);
  }
}

/** Opens a fresh connection, sends the pipelined commands and resolves with one reply per command. */
function exchange(target: RedisTarget, commands: string[][]): Promise<Reply[]> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(target);
    let buffer = Buffer.alloc(0);
    const replies: Reply[] = [];
    let settled = false;
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(replies);
    };
    socket.setTimeout(5000, () => finish(new Error('Redis test connection timed out')));
    socket.once('error', (err) => finish(err));
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      let offset = 0;
      for (;;) {
        const parsed = parseReply(buffer, offset);
        if (!parsed) break;
        replies.push(parsed.value);
        offset = parsed.next;
        if (replies.length === commands.length) break;
      }
      buffer = buffer.subarray(offset);
      if (replies.length === commands.length) finish(null);
    });
    socket.once('connect', () => {
      socket.write(Buffer.concat(commands.map(encodeCommand)));
    });
  });
}

function firstError(replies: Reply[]): Error | null {
  return (replies.find((r) => r instanceof Error) as Error | undefined) ?? null;
}

let guard: Promise<void> | null = null;

function ensureTestDatabase(target: RedisTarget): Promise<void> {
  if (!guard) {
    guard = (async () => {
      const [select, size, marker] = await exchange(target, [
        ['SELECT', String(TEST_DB)],
        ['DBSIZE'],
        ['EXISTS', MARKER_KEY],
      ]);
      if (select instanceof Error) throw select;
      if (size !== 0 && marker !== 1) {
        throw new Error(`Refusing to flush a non-test database: DB ${TEST_DB} holds ${String(size)} keys and lacks ${MARKER_KEY}`);
      }
      await exchange(target, [['SELECT', String(TEST_DB)], ['SET', MARKER_KEY, '1']]);
    })();
  }
  return guard;
}

const FORBIDDEN = new Set(['FLUSHALL', 'SELECT', 'CONFIG', 'SHUTDOWN', 'SLAVEOF', 'REPLICAOF', 'MIGRATE']);

async function runCommand(target: RedisTarget, command: string[]): Promise<Reply> {
  const name = (command[0] ?? '').toUpperCase();
  if (FORBIDDEN.has(name)) throw new Error(`Command ${name} is not allowed in the test shim`);
  await ensureTestDatabase(target);
  if (name === 'FLUSHDB') {
    const replies = await exchange(target, [['SELECT', String(TEST_DB)], ['FLUSHDB'], ['SET', MARKER_KEY, '1']]);
    return firstError(replies) ?? replies[1];
  }
  const replies = await exchange(target, [['SELECT', String(TEST_DB)], command]);
  return replies[0] instanceof Error ? replies[0] : replies[1];
}

function headerValue(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

/** Replaces globalThis.fetch: shim host goes to the local redis, every other host throws. */
export function installRedisShim(redisUrl: string): RedisTarget {
  const target = assertSafeRedisUrl(redisUrl);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname !== SHIM_HOST) throw new Error(`Network access is disabled in tests: ${url.hostname}`);
    if (headerValue(init, 'authorization') !== `Bearer ${SHIM_TOKEN}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const command = JSON.parse(String(init?.body)) as string[];
    try {
      const result = await runCommand(target, command);
      if (result instanceof Error) return Response.json({ error: result.message }, { status: 400 });
      return Response.json({ result });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Refusing')) throw err;
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  };
  return target;
}

export function installNoNetwork(): void {
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    throw new Error(`Network access is disabled in tests: ${url}`);
  };
}
