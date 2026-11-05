import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_REQUEST_EMAIL_BUDGET,
  MAJOR_EMAIL_DOMAINS,
  MAX_TICKETS_PER_DOMAIN,
  RECORD_RETENTION_DAYS,
  SEND_COOLDOWN_SECONDS,
  domainSeatCap,
  getShow,
  retentionExpiry,
} from '../../src/config/shows';

describe('reservation limits', () => {
  it('retentionExpiry is the show start plus the retention window, in epoch seconds', () => {
    const show = getShow('2027-02-20-monique');
    assert.ok(show);
    assert.equal(retentionExpiry(show), Date.UTC(2027, 1, 20, 18, 0, 0) / 1000 + 30 * 86400);
  });

  it('retentionExpiry is an integer for every show', () => {
    for (const id of ['2027-02-21-monique', '2027-03-14-julienne']) {
      const show = getShow(id);
      assert.ok(show);
      assert.ok(Number.isInteger(retentionExpiry(show)));
    }
  });

  it('domainSeatCap is 0 for a major provider whatever the case', () => {
    assert.equal(domainSeatCap('GMAIL.com'), 0);
    assert.equal(domainSeatCap('bluewin.ch'), 0);
  });

  it('domainSeatCap is the domain maximum otherwise, empty string included', () => {
    assert.equal(domainSeatCap('example.ch'), 12);
    assert.equal(domainSeatCap(''), 12);
  });

  it('every major domain is lower-case, unique and free of @', () => {
    assert.equal(new Set(MAJOR_EMAIL_DOMAINS).size, MAJOR_EMAIL_DOMAINS.length);
    for (const domain of MAJOR_EMAIL_DOMAINS) {
      assert.equal(domain, domain.toLowerCase());
      assert.ok(!domain.includes('@'));
    }
  });

  it('constants hold their agreed values', () => {
    assert.equal(MAX_TICKETS_PER_DOMAIN, 12);
    assert.equal(SEND_COOLDOWN_SECONDS, 600);
    assert.equal(DAILY_REQUEST_EMAIL_BUDGET, 60);
    assert.equal(RECORD_RETENTION_DAYS, 30);
  });
});
