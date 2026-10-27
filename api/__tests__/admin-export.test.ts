import { redisSkipReason } from './helpers/redis-env';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { retentionExpiry } from '../../src/config/shows';
import { canonicalEmail } from '../_lib/guard';
import { ERR } from '../_lib/http';
import { claimAtomic, keys, redis } from '../_lib/redis';
import { GET } from '../reservations';
import { NOW, SYNTH_SHOW_ID, captureLogs, containsNone, redisDown, registerTestShow } from './helpers/flow';

const TOKEN = 'admin-token-value';
const shimFetch = globalThis.fetch;
let savedToken: string | undefined;
let showHandle: ReturnType<typeof registerTestShow>;

before(() => {
  showHandle = registerTestShow();
  savedToken = process.env.ADMIN_TOKEN;
});
after(() => {
  showHandle.unregister();
  if (savedToken === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = savedToken;
});

const exportRequest = (headers: Record<string, string> = {}, query = `show=${SYNTH_SHOW_ID}`): Request =>
  new Request(`http://localhost/api/reservations?${query}`, { headers });
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

describe('admin export authentication (no Redis)', () => {
  let redisCalls = 0;
  beforeEach(() => {
    process.env.ADMIN_TOKEN = TOKEN;
    redisCalls = 0;
    globalThis.fetch = async () => {
      redisCalls += 1;
      throw new Error('unexpected network call');
    };
  });
  afterEach(() => {
    globalThis.fetch = shimFetch;
  });

  it('A1 answers 401 with WWW-Authenticate when there is no header', async () => {
    const res = await GET(exportRequest());
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), 'Bearer');
    assert.equal(redisCalls, 0);
  });

  it('A2 answers 401 for a non-Bearer scheme', async () => {
    const res = await GET(exportRequest({ authorization: 'Basic abc' }));
    assert.equal(res.status, 401);
    assert.equal(redisCalls, 0);
  });

  it('A3 answers 403 for an empty Bearer value while a token is configured', async () => {
    const res = await GET(exportRequest({ authorization: 'Bearer ' }));
    assert.equal(res.status, 403);
    assert.equal(redisCalls, 0);
  });

  it('A4 answers 403 for a wrong token', async () => {
    assert.equal((await GET(exportRequest(bearer('wrong')))).status, 403);
    assert.equal(redisCalls, 0);
  });

  it('A6 never reads ?token=: the right token in the query without a header is 401', async () => {
    const res = await GET(exportRequest({}, `show=${SYNTH_SHOW_ID}&token=${TOKEN}`));
    assert.equal(res.status, 401);
  });

  it('A7 ?token= with the right value plus a wrong header is 403', async () => {
    const res = await GET(exportRequest(bearer('wrong'), `show=${SYNTH_SHOW_ID}&token=${TOKEN}`));
    assert.equal(res.status, 403);
  });

  it('A8 answers 503 and never 200 when ADMIN_TOKEN is unset or empty', async () => {
    for (const value of [undefined, '']) {
      if (value === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = value;
      for (const headers of [bearer('undefined'), bearer(''), { authorization: 'Bearer ' }, {}]) {
        const res = await GET(exportRequest(headers));
        assert.equal(res.status, 503, JSON.stringify(headers));
        assert.deepEqual(await res.json(), { error: ERR.UNAVAILABLE });
      }
    }
    assert.equal(redisCalls, 0);
  });

  it('A9 refuses a token that differs only in the last character', async () => {
    assert.equal((await GET(exportRequest(bearer(TOKEN.slice(0, -1) + 'X')))).status, 403);
  });

  it('A10 refuses tokens of another length without throwing', async () => {
    for (const token of ['a', TOKEN + 'x', 'z'.repeat(5000)]) {
      assert.equal((await GET(exportRequest(bearer(token)))).status, 403);
    }
  });

  it('answers 404 for an unknown show once authenticated', async () => {
    const res = await GET(exportRequest(bearer(TOKEN), 'show=nope'));
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Représentation inconnue' });
  });

  it('answers 503 with no name or address when Redis is down', async () => {
    globalThis.fetch = shimFetch;
    const down = redisDown();
    const logs = captureLogs();
    try {
      const res = await GET(exportRequest(bearer(TOKEN)));
      assert.equal(res.status, 503);
      const text = await res.text();
      assert.equal(text, JSON.stringify({ error: ERR.UNAVAILABLE }));
      assert.ok(containsNone(text + logs.lines(), ['@', 'Dupont', TOKEN]));
      assert.match(logs.lines(), /admin export error/);
    } finally {
      logs.restore();
      down.restore();
    }
  });
});

describe('admin export CSV', { skip: redisSkipReason }, () => {
  beforeEach(async () => {
    process.env.ADMIN_TOKEN = TOKEN;
    await redis('FLUSHDB');
  });

  let n = 0;
  async function claim(name: string, email: string, quantity = 1): Promise<string> {
    n += 1;
    const id = `D${String(n).padStart(7, '0')}`;
    const result = await claimAtomic(
      { id, showId: SYNTH_SHOW_ID, name, email, canonicalEmail: canonicalEmail(email) || email, quantity, capacity: 100, maxPerEmail: 4, maxPerDomain: 0, expireAt: retentionExpiry(showHandle.show) },
      { now: () => NOW }
    );
    assert.equal(result.status, 'claimed');
    return id;
  }
  const csv = async (): Promise<string> => (await (await GET(exportRequest(bearer(TOKEN)))).text()).replace(/^\uFEFF/, '');
  const rows = async (): Promise<string[]> => (await csv()).split('\n');

  it('A5 answers 200 with the unchanged header, BOM, disposition and security headers', async () => {
    await claim('Jean', 'jean@example.ch', 2);
    const res = await GET(exportRequest(bearer(TOKEN)));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.equal(res.headers.get('content-disposition'), `attachment; filename="reservations-${SYNTH_SHOW_ID}.csv"`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    // Response.text() drops a leading BOM, so the bytes are checked instead.
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.ok(bytes.subarray(3).toString('utf8').startsWith('date;reservation;statut;nom;email;places;reserve_le'));
  });

  it('prefixes formula-looking cells with an apostrophe in the name and the email', async () => {
    const prefixes = ['=1+1', '+33', '-1', '@SUM(A1)', '\tx', '\rx'];
    for (const [i, prefix] of prefixes.entries()) await claim(`${prefix}name`, `${i}${i}@example.ch`);
    await claim('Plus', '+a@x.ch');
    const out = await csv();
    for (const prefix of prefixes) {
      assert.ok(out.includes(`'${prefix}name`) || out.includes(`"'${prefix}name`), JSON.stringify(prefix));
    }
    assert.ok(out.includes(";'+a@x.ch;"), out);
    for (const line of out.split('\n').slice(1)) {
      for (const cell of line.split(';')) assert.ok(!/^[=+\-@]/.test(cell.replace(/^"/, '')) , cell);
    }
  });

  it('quotes cells holding quotes, semicolons and carriage returns', async () => {
    await claim('Jean "Jo"; Dupont', 'a@example.ch');
    await claim('line\rbreak', 'b@example.ch');
    const out = await csv();
    assert.ok(out.includes('"Jean ""Jo""; Dupont"'));
    assert.ok(out.includes('"line\rbreak"'));
  });

  it('labels statuses confirmée and annulée and never en attente', async () => {
    await claim('Present', 'p@example.ch');
    const gone = await claim('Gone', 'g@example.ch');
    const raw = (await redis<string>('GET', keys.reservation(gone)));
    const record = JSON.parse(raw);
    await redis('SET', keys.reservation(gone), JSON.stringify({ ...record, status: 'cancelled' }));
    await redis('SET', keys.reservation('D9999999'), JSON.stringify({ ...record, id: 'D9999999', status: 'weird' }));
    await redis('RPUSH', keys.reservations(SYNTH_SHOW_ID), 'D9999999');
    const out = await csv();
    assert.ok(out.includes(';confirmée;Present;'));
    assert.ok(out.includes(';annulée;Gone;'));
    assert.ok(out.includes(';inconnu;'));
    assert.ok(!out.includes('en attente'));
  });

  it('never exposes the cancel token or the canonical email', async () => {
    const id = await claim('Jean', 'jean+secret@example.ch');
    const record = JSON.parse(await redis<string>('GET', keys.reservation(id)));
    const out = await csv();
    assert.ok(!out.includes(record.token));
    assert.ok(!out.includes('canonical'));
  });

  it('skips a record that cannot be parsed, logs only its id and keeps the rest', async () => {
    await claim('Good', 'good@example.ch');
    await redis('SET', keys.reservation('DBAD0001'), '{not json');
    await redis('RPUSH', keys.reservations(SYNTH_SHOW_ID), 'DBAD0001');
    const logs = captureLogs();
    try {
      const out = await csv();
      assert.ok(out.includes('Good'));
      assert.equal(out.split('\n').length, 2);
      assert.match(logs.lines(), /export row skipped DBAD0001/);
      assert.ok(!logs.lines().includes('not json'));
    } finally {
      logs.restore();
    }
  });

  it('lists every show when no show is given', async () => {
    await claim('Jean', 'jean@example.ch');
    const res = await GET(new Request('http://localhost/api/reservations', { headers: bearer(TOKEN) }));
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes('Jean'));
  });
});
