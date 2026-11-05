import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { formatDateTime } from '../../src/lib/formatDateTime';

describe('formatDateTime', () => {
  const instant = Date.UTC(2027, 1, 20, 18);

  it('prints the instant in Geneva time', () => {
    assert.equal(formatDateTime(instant), 'samedi 20 février à 19:00');
  });

  it('switches to summer time in Geneva', () => {
    assert.equal(formatDateTime(Date.UTC(2027, 6, 14, 17)), 'mercredi 14 juillet à 19:00');
  });

  it('is stable under other process time zones', () => {
    const script = `import('${require.resolve('../../src/lib/formatDateTime')}').then((m) => console.log(m.formatDateTime(${instant})))`;
    for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
      const run = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
      assert.equal(run.stdout.trim(), 'samedi 20 février à 19:00', tz);
    }
  });

  it('takes epoch milliseconds, not seconds', () => {
    assert.notEqual(formatDateTime(instant / 1000), formatDateTime(instant));
  });
});
