'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { compactRow } = require('../lib/propprofessor-shared-utils');

describe('compactRow', () => {
  it('strips null and empty-string fields by default', () => {
    const input = { id: 'abc', market: 'Moneyline', b: null, c: '', d: 'keep' };
    const out = compactRow(input);
    assert.equal(out.id, 'abc');
    assert.equal(out.market, 'Moneyline');
    assert.equal(out.d, 'keep');
    assert.equal('b' in out, false, 'null field should be stripped');
    assert.equal('c' in out, false, 'empty-string field should be stripped');
  });

  it('strips empty arrays and objects by default', () => {
    const input = { id: 'abc', arr: [], obj: {}, keep: [1] };
    const out = compactRow(input);
    assert.equal('arr' in out, false);
    assert.equal('obj' in out, false);
    assert.deepEqual(out.keep, [1]);
  });

  it('keeps fields explicitly listed in keepFields even when null/empty', () => {
    const input = { id: 'abc', odds: -110, line: null, extra: '' };
    const out = compactRow(input, ['id', 'odds', 'line']);
    assert.equal(out.id, 'abc');
    assert.equal(out.odds, -110);
    assert.equal(out.line, null, 'keepFields should preserve nulls for listed fields');
    assert.equal('extra' in out, false, 'fields not in keepFields are dropped');
  });

  it('handles zero as a real value (does not strip zeros)', () => {
    const input = { score: 0, count: 0, dropped: null };
    const out = compactRow(input);
    assert.equal(out.score, 0);
    assert.equal(out.count, 0);
    assert.equal('dropped' in out, false);
  });

  it('does not mutate the input row', () => {
    const input = { id: 'abc', b: null };
    const snapshot = JSON.stringify(input);
    compactRow(input);
    assert.equal(JSON.stringify(input), snapshot);
  });

  it('returns a new object reference', () => {
    const input = { id: 'abc' };
    const out = compactRow(input);
    assert.notEqual(out, input);
  });
});

describe('DEFAULT_LEAGUES', () => {
  const { DEFAULT_LEAGUES } = require('../lib/propprofessor-shared-utils');

  it('exports every league the PropProfessor backend supports', () => {
    const expected = ['NBA', 'MLB', 'NFL', 'NHL', 'WNBA', 'NCAAB', 'NCAAF', 'Soccer', 'Tennis', 'UFC'];
    assert.deepEqual([...DEFAULT_LEAGUES], expected);
  });

  it('is frozen so callers cannot accidentally mutate the source of truth', () => {
    assert.ok(Object.isFrozen(DEFAULT_LEAGUES), 'DEFAULT_LEAGUES should be frozen');
  });

  it('covers both the main US sports and the international / niche leagues', () => {
    // Sanity guards — if a league is added or removed, update the test on the
    // line above and re-verify the propprofessor backend actually supports it.
    assert.ok(DEFAULT_LEAGUES.includes('NBA'), 'must include NBA');
    assert.ok(DEFAULT_LEAGUES.includes('NFL'), 'must include NFL');
    assert.ok(DEFAULT_LEAGUES.includes('Soccer'), 'must include Soccer');
    assert.ok(DEFAULT_LEAGUES.includes('Tennis'), 'must include Tennis');
    assert.ok(!DEFAULT_LEAGUES.includes(''), 'must not contain empty string');
  });
});
